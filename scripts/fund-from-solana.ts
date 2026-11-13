// Fund the EVM deployer from a Solana devnet wallet, entirely through Rome's Solana lane:
//   wallet USDC (SPL, devnet) ──fundSyntheticGas──▶ synthetic's native gas on Rome
//   synthetic ──native transfer (submitRomeTxV1)──▶ deployer EVM address
// Usage: npx tsx scripts/fund-from-solana.ts <usdc amount, e.g. 8>
import "dotenv/config";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { fundSyntheticGas, isSyntheticProvisioned, buildCreatePdaCall, submitRomeTxV1, syntheticAddress } from "@rome-protocol/sdk";
import { formatUnits, parseUnits } from "viem";
import { cfg, deployer } from "../lib/env.js";
import { publicClient } from "../lib/triumph.js";

const amount = process.argv[2] ?? "8";
const raw = process.env.ROME_SOLANA_KEY;
if (!raw) throw new Error("ROME_SOLANA_KEY missing in .env");
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
const conn = new Connection(cfg.solanaRpc, "confirmed");
const deps = { connection: conn, proxyUrl: cfg.proxyUrl, chainId: cfg.chainId, programId: cfg.romeEvmProgramId, signer: kp };
const synthetic = syntheticAddress(kp.publicKey);
const to = deployer().address;
const pub = publicClient(cfg);

const sol = await conn.getBalance(kp.publicKey);
const usdcAccts = await conn.getParsedTokenAccountsByOwner(kp.publicKey, { mint: new PublicKey(cfg.usdcMint) });
const usdc = usdcAccts.value.reduce((s, a) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n);
console.log("solana wallet", kp.publicKey.toBase58(), `${sol / 1e9} SOL`, `${formatUnits(usdc, 6)} USDC`);
console.log("synthetic    ", synthetic, "→ deployer", to);
const want = parseUnits(amount, 6);
if (sol < 20_000_000) throw new Error("need ≥ 0.02 devnet SOL for Solana fees (faucet.solana.com, cluster devnet)");
if (usdc < want) throw new Error(`need ≥ ${amount} devnet USDC (faucet.circle.com → Solana Devnet)`);

if (!(await isSyntheticProvisioned(conn, cfg.romeEvmProgramId, synthetic))) {
  const r = await submitRomeTxV1(deps, buildCreatePdaCall(synthetic));
  console.log("provision    ", r.hash, r.receipt?.status);
}
const wei = want * 10n ** 12n; // 6-dec USDC → 18-dec native gas
const f = await fundSyntheticGas(deps, wei);
console.log("fund gas     ", f.signature);
const synthGas = await pub.getBalance({ address: synthetic });
console.log("synthetic gas", formatUnits(synthGas, 18), "USDC");

// keep a margin on the synthetic for the transfer's own gas
const send = synthGas - parseUnits("0.3", 18);
if (send <= 0n) throw new Error("synthetic gas too low to forward");
const t = await submitRomeTxV1(deps, { to, data: "0x", value: send });
console.log("forward      ", t.hash, t.route, t.receipt?.status);
console.log("deployer gas ", formatUnits(await pub.getBalance({ address: to }), 18), "USDC");
