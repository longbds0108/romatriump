// Triumph's dual-lane client. Every write goes through the Rome SDK:
//   EVM lane (MetaMask)      → submitRomeTx
//   Solana lane (any Wallet Standard Solana wallet, no EVM key) → submitRomeTxV1
// Both lanes call the same contract and trade against the same curves. Reads are plain viem.
import {
  submitRomeTx,
  submitRomeTxV1,
  syntheticAddress,
  buildFundLeg,
  buildSweepLeg,
  buildCreatePdaCall,
  isSyntheticProvisioned,
  submitSolanaInstructionsV1,
  toLaneSigner,
  type SignerLike,
} from "@rome-protocol/sdk";
import { createPublicClient, encodeFunctionData, erc20Abi, http, parseAbi, type Hex } from "viem";
import { Connection, PublicKey } from "@solana/web3.js";
import { TRIUMPH_ABI } from "./triumphAbi.js";
import { bytes32ToPubkey, poolInitAccounts, triumphAuthority, vaultInitAccounts } from "./meteora.js";
import type { TriumphConfig } from "./config.js";

export { TRIUMPH_ABI };

const HELPER = "0xff00000000000000000000000000000000000009" as const;
const WITHDRAW = "0x4200000000000000000000000000000000000016" as const;
const HELPER_ABI = parseAbi([
  "function approve_spl(address spender, uint64 amount, bytes32 mint)",
  "function user_balance(address account, bytes32 mint) view returns (uint64)",
  "function allowance_of(address owner, address spender, bytes32 mint) view returns (uint64)",
]);
const WITHDRAW_ABI = parseAbi(["function withdraw_to_ata(uint256 wei_)"]);
export const U64_MAX = 2n ** 64n - 1n;

export type Status = "None" | "Trading" | "Completed" | "Graduated";
const STATUS: Status[] = ["None", "Trading", "Completed", "Graduated"];

export interface LaunchView {
  id: number;
  mint: Hex;
  mintBase58: string;
  creator: Hex;
  createdAt: number;
  status: Status;
  sold: bigint;
  raised: bigint;
  wrapper: Hex;
  vaultReady: boolean;
  pool: Hex;
  poolBase58: string | null;
  lpMint: Hex;
  name: string;
  symbol: string;
}

export interface CurveParams {
  totalSupply: bigint;
  curveSupply: bigint;
  lpSupply: bigint;
  virtualUsdc: bigint;
  graduationUsdc: bigint;
  virtualTokens0: bigint;
  k: bigint;
  poolFeeBps: bigint;
  feeBps: bigint;
}

/** A signed write, normalized across lanes. */
export interface TxResult {
  hash: Hex;
  signature?: string; // Solana signature (Solana lane, atomic route)
  route: "evm" | "atomic" | "relay";
}

/** Either lane, behind one interface. `address` is the EVM identity the contract sees. */
export interface Lane {
  kind: "evm" | "solana";
  address: Hex;
  send(to: Hex, data: Hex, value?: bigint): Promise<TxResult>;
}

type Eip1193 = { request: (args: { method: string; params?: any[] }) => Promise<any> };

export function publicClient(cfg: TriumphConfig) {
  return createPublicClient({ transport: http(cfg.proxyUrl) });
}

export function evmLane(cfg: TriumphConfig, provider: Eip1193, from: Hex): Lane {
  const pub = publicClient(cfg);
  return {
    kind: "evm",
    address: from,
    async send(to, data, value) {
      const hash = await submitRomeTx(provider, { from, to, data, value });
      const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
      if (r.status !== "success") throw new Error(`transaction reverted: ${hash}`);
      return { hash, route: "evm" };
    },
  };
}

export function solanaLane(cfg: TriumphConfig, signer: SignerLike): Lane {
  const payer = toLaneSigner(signer).payer;
  const deps = {
    connection: new Connection(cfg.solanaRpc, "confirmed"),
    proxyUrl: cfg.proxyUrl,
    chainId: cfg.chainId,
    programId: cfg.romeEvmProgramId,
    signer,
  };
  return {
    kind: "solana",
    address: syntheticAddress(payer),
    async send(to, data, value) {
      const r = await submitRomeTxV1(deps, { to, data, value });
      if (r.receipt?.status !== "0x1") {
        throw new Error(r.receipt ? `transaction reverted: ${r.hash}` : `no receipt in time for ${r.hash}`);
      }
      return { hash: r.hash, signature: r.signature, route: r.route };
    },
  };
}

// ─── reads ──────────────────────────────────────────────────────────────────

export async function readParams(cfg: TriumphConfig, triumph: Hex): Promise<CurveParams> {
  const pub = publicClient(cfg);
  const names = ["TOTAL_SUPPLY", "curveSupply", "lpSupply", "virtualUsdc", "graduationUsdc", "virtualTokens0", "k", "poolFeeBps", "TRADE_FEE_BPS"] as const;
  const v = await Promise.all(names.map((functionName) => pub.readContract({ address: triumph, abi: TRIUMPH_ABI, functionName } as any))) as bigint[];
  return {
    totalSupply: BigInt(v[0]),
    curveSupply: BigInt(v[1]),
    lpSupply: BigInt(v[2]),
    virtualUsdc: BigInt(v[3]),
    graduationUsdc: BigInt(v[4]),
    virtualTokens0: BigInt(v[5]),
    k: BigInt(v[6]),
    poolFeeBps: BigInt(v[7]),
    feeBps: BigInt(v[8]),
  };
}

const ZERO32 = `0x${"0".repeat(64)}` as Hex;

function toView(id: number, l: any): LaunchView {
  return {
    id,
    mint: l.mint,
    mintBase58: bytes32ToPubkey(l.mint).toBase58(),
    creator: l.creator,
    createdAt: Number(l.createdAt),
    status: STATUS[Number(l.status)] ?? "None",
    sold: BigInt(l.sold),
    raised: BigInt(l.raised),
    wrapper: l.wrapper,
    vaultReady: l.vaultReady,
    pool: l.pool,
    poolBase58: l.pool === ZERO32 ? null : bytes32ToPubkey(l.pool).toBase58(),
    lpMint: l.lpMint,
    name: l.name,
    symbol: l.symbol,
  };
}

export async function readLaunch(cfg: TriumphConfig, triumph: Hex, id: number): Promise<LaunchView> {
  const l = await publicClient(cfg).readContract({ address: triumph, abi: TRIUMPH_ABI, functionName: "getLaunch", args: [BigInt(id)] });
  return toView(id, l);
}

export async function readLaunches(cfg: TriumphConfig, triumph: Hex): Promise<LaunchView[]> {
  const n = Number(await publicClient(cfg).readContract({ address: triumph, abi: TRIUMPH_ABI, functionName: "launchCount" }));
  const ids = Array.from({ length: n }, (_, i) => n - 1 - i);
  return Promise.all(ids.map((id) => readLaunch(cfg, triumph, id)));
}

/** SPL balance of the user's Rome account for any mint (raw units). */
export async function splBalance(cfg: TriumphConfig, who: Hex, mint: Hex): Promise<bigint> {
  return publicClient(cfg).readContract({ address: HELPER, abi: HELPER_ABI, functionName: "user_balance", args: [who, mint] });
}

/** How much of `owner`'s `mint` Triumph may move (0 unless Triumph is the SPL delegate). */
export async function delegatedTo(cfg: TriumphConfig, owner: Hex, triumph: Hex, mint: Hex): Promise<bigint> {
  return publicClient(cfg).readContract({ address: HELPER, abi: HELPER_ABI, functionName: "allowance_of", args: [owner, triumph, mint] });
}

export async function nativeBalance(cfg: TriumphConfig, who: Hex): Promise<bigint> {
  return publicClient(cfg).getBalance({ address: who });
}

export async function wusdcBalance(cfg: TriumphConfig, who: Hex): Promise<bigint> {
  return publicClient(cfg).readContract({ address: cfg.wusdc, abi: erc20Abi, functionName: "balanceOf", args: [who] });
}

export function usdcMintHex(cfg: TriumphConfig): Hex {
  return `0x${Buffer.from(new PublicKey(cfg.usdcMint).toBytes()).toString("hex")}` as Hex;
}

// ─── curve math (mirrors Triumph._buyMath/_sellMath, for live previews) ───────

const ceilDiv = (a: bigint, b: bigint) => (a === 0n ? 0n : (a - 1n) / b + 1n);

export function quoteBuy(p: CurveParams, l: Pick<LaunchView, "sold" | "raised">, usdcIn: bigint) {
  const remaining = p.graduationUsdc - l.raised;
  let net = (usdcIn * (10_000n - p.feeBps)) / 10_000n;
  if (net >= remaining) {
    net = remaining;
    const fee = ceilDiv(net * p.feeBps, 10_000n - p.feeBps);
    return { tokensOut: p.curveSupply - l.sold, charged: net + fee, fee, completes: true };
  }
  const x = p.virtualUsdc + l.raised;
  const y = p.virtualTokens0 - l.sold;
  let out = y - ceilDiv(p.k, x + net);
  const left = p.curveSupply - l.sold;
  if (out > left) out = left;
  return { tokensOut: out, charged: usdcIn, fee: usdcIn - net, completes: false };
}

export function quoteSell(p: CurveParams, l: Pick<LaunchView, "sold" | "raised">, tokensIn: bigint) {
  if (tokensIn > l.sold) return { usdcOut: 0n, fee: 0n };
  const x = p.virtualUsdc + l.raised;
  const y = p.virtualTokens0 - l.sold;
  let gross = x - ceilDiv(p.k, y + tokensIn);
  if (gross > l.raised) gross = l.raised;
  const fee = ceilDiv(gross * p.feeBps, 10_000n);
  return { usdcOut: gross - fee, fee };
}

/** Price in USDC per whole token, as a JS number for display. */
export function priceOf(p: CurveParams, l: Pick<LaunchView, "sold" | "raised">): number {
  return Number(p.virtualUsdc + l.raised) / Number(p.virtualTokens0 - l.sold);
}

// ─── writes (either lane) ─────────────────────────────────────────────────────

const enc = (functionName: string, args: unknown[]) => encodeFunctionData({ abi: TRIUMPH_ABI, functionName, args } as any);

/** One-time per wallet per mint: make Triumph the SPL delegate so it can pull USDC (buy) or tokens (sell). */
export async function ensureDelegate(cfg: TriumphConfig, lane: Lane, triumph: Hex, mint: Hex, need: bigint) {
  if ((await delegatedTo(cfg, lane.address, triumph, mint)) >= need) return null;
  const data = encodeFunctionData({ abi: HELPER_ABI, functionName: "approve_spl", args: [triumph, U64_MAX, mint] });
  return lane.send(HELPER, data);
}

/** EVM lane: turn native gas USDC (18-dec wei) into SPL USDC in the wallet's Rome account. */
export function wrapGasToUsdc(lane: Lane, wei: bigint) {
  return lane.send(WITHDRAW, encodeFunctionData({ abi: WITHDRAW_ABI, functionName: "withdraw_to_ata", args: [wei] }));
}

export const launch = (lane: Lane, triumph: Hex, name: string, symbol: string) => lane.send(triumph, enc("launch", [name, symbol]));
export const registerWrapper = (lane: Lane, triumph: Hex, id: number) => lane.send(triumph, enc("registerWrapper", [BigInt(id)]));
export const buy = (lane: Lane, triumph: Hex, id: number, usdcIn: bigint, minOut: bigint) => lane.send(triumph, enc("buy", [BigInt(id), usdcIn, minOut]));
export const sell = (lane: Lane, triumph: Hex, id: number, tokensIn: bigint, minOut: bigint) => lane.send(triumph, enc("sell", [BigInt(id), tokensIn, minOut]));

export async function initTokenVault(cfg: TriumphConfig, lane: Lane, triumph: Hex, l: LaunchView) {
  const accts = vaultInitAccounts(triumph, bytes32ToPubkey(l.mint), cfg);
  return lane.send(triumph, enc("initTokenVault", [BigInt(l.id), accts]));
}

export async function graduate(cfg: TriumphConfig, lane: Lane, triumph: Hex, l: LaunchView, poolFeeBps: bigint) {
  const conn = new Connection(cfg.solanaRpc, "confirmed");
  const { accounts, pool } = await poolInitAccounts(conn, triumph, bytes32ToPubkey(l.mint), poolFeeBps, cfg);
  const tx = await lane.send(triumph, enc("graduate", [BigInt(l.id), accounts]));
  return { ...tx, pool: pool.toBase58() };
}

// ─── Solana-lane plumbing (synthetic provisioning, USDC in/out) ───────────────

export async function solanaProvision(cfg: TriumphConfig, signer: SignerLike) {
  const lane = solanaLane(cfg, signer);
  const conn = new Connection(cfg.solanaRpc, "confirmed");
  if (await isSyntheticProvisioned(conn, cfg.romeEvmProgramId, lane.address)) return null;
  const call = buildCreatePdaCall(lane.address);
  return lane.send(call.to as Hex, call.data as Hex);
}

/** Move `amount` (6-dec) USDC from the Solana wallet into its synthetic, only the shortfall. */
export async function solanaFundUsdc(cfg: TriumphConfig, signer: SignerLike, amount: bigint) {
  const payer = toLaneSigner(signer).payer;
  const synthetic = syntheticAddress(payer);
  const have = await splBalance(cfg, synthetic, usdcMintHex(cfg));
  if (have >= amount) return null;
  return submitSolanaInstructionsV1(
    buildFundLeg({ programId: cfg.romeEvmProgramId, chainId: cfg.chainId, mint: new PublicKey(cfg.usdcMint), amount: amount - have, wallet: payer, synthetic }),
    { connection: new Connection(cfg.solanaRpc, "confirmed"), signer },
  );
}

/** Push `amount` of any SPL mint from the synthetic back to the Solana wallet. */
export async function solanaSweep(cfg: TriumphConfig, signer: SignerLike, mintBase58: string, amount: bigint) {
  const payer = toLaneSigner(signer).payer;
  const conn = new Connection(cfg.solanaRpc, "confirmed");
  const sweep = buildSweepLeg({ programId: cfg.romeEvmProgramId, mint: new PublicKey(mintBase58), amount, wallet: payer, synthetic: syntheticAddress(payer) });
  await submitSolanaInstructionsV1([sweep.ensureWalletAtaIx], { connection: conn, signer });
  return solanaLane(cfg, signer).send(sweep.helperTo, sweep.calldata);
}

export function hexToPubkey(h: Hex): PublicKey {
  return bytes32ToPubkey(h);
}

/** Triumph's Solana authority (its external_auth PDA): owns every holding and the LP. */
export function vaultAuthorityKey(cfg: TriumphConfig, triumph: Hex): PublicKey {
  return triumphAuthority(triumph, cfg);
}
