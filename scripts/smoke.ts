// End-to-end on the live chain, EVM lane: launch → wrapper → buy → sell → buy to completion
// → Meteora vault → graduate. Prints every hash; verifies the pool on Solana afterwards.
import { formatUnits, type Hex } from "viem";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAccount } from "../lib/splRead.js";
import { cfg, deployer, triumphAddress } from "../lib/env.js";
import { eip1193FromAccount } from "../lib/eip1193Node.js";
import * as T from "../lib/triumph.js";

const me = deployer();
const triumph = triumphAddress();
const lane = T.evmLane(cfg, eip1193FromAccount(me, cfg.proxyUrl, cfg.chainId), me.address);
const usdc = T.usdcMintHex(cfg);
const p = await T.readParams(cfg, triumph);
const log = (step: string, r: T.TxResult | null) => console.log(`  ${step.padEnd(22)} ${r ? `${cfg.explorerUrl}/tx/${r.hash}` : "already done"}`);
const u = (x: bigint) => `${formatUnits(x, 6)} USDC`;

console.log("Triumph", triumph, "| graduates at", u(p.graduationUsdc));
const sym = `TRI${Math.floor(Math.random() * 9000 + 1000)}`;
log("launch " + sym, await T.launch(lane, triumph, "Triumph Smoke", sym));
const id = Number(await T.publicClient(cfg).readContract({ address: triumph, abi: T.TRIUMPH_ABI, functionName: "launchCount" })) - 1;
let l = await T.readLaunch(cfg, triumph, id);
console.log("  mint", l.mintBase58, `${cfg.solanaExplorer}/address/${l.mintBase58}?cluster=${cfg.solanaCluster}`);
log("registerWrapper", await T.registerWrapper(lane, triumph, id));

const need = p.graduationUsdc + p.graduationUsdc / 50n + 200_000n; // raise + fees + headroom
const have = await T.splBalance(cfg, me.address, usdc);
if (have < need) log("wrap gas → USDC", await T.wrapGasToUsdc(lane, (need - have) * 10n ** 12n));
log("delegate USDC", await T.ensureDelegate(cfg, lane, triumph, usdc, need));

const q1 = T.quoteBuy(p, l, 1_000_000n);
log("buy 1 USDC", await T.buy(lane, triumph, id, 1_000_000n, (q1.tokensOut * 99n) / 100n));
l = await T.readLaunch(cfg, triumph, id);
const bal = await T.splBalance(cfg, me.address, l.mint);
console.log("  holding", formatUnits(bal, 6), sl(l));
log("delegate token", await T.ensureDelegate(cfg, lane, triumph, l.mint, bal / 2n));
log("sell half", await T.sell(lane, triumph, id, bal / 2n, 0n));
l = await T.readLaunch(cfg, triumph, id);
console.log("  after sell", sl(l));
log("buy to completion", await T.buy(lane, triumph, id, need, 0n));
l = await T.readLaunch(cfg, triumph, id);
console.log("  status", l.status, sl(l));
if (l.status !== "Completed") throw new Error("curve did not complete");

log("init Meteora vault", await T.initTokenVault(cfg, lane, triumph, l));
const g = await T.graduate(cfg, lane, triumph, await T.readLaunch(cfg, triumph, id), p.poolFeeBps);
log("graduate", g);
l = await T.readLaunch(cfg, triumph, id);
console.log("  status", l.status, "pool", l.poolBase58);
console.log(`  ${cfg.solanaExplorer}/address/${l.poolBase58}?cluster=${cfg.solanaCluster}`);

const conn = new Connection(cfg.solanaRpc, "confirmed");
const pool = await conn.getAccountInfo(new PublicKey(l.poolBase58!));
console.log("  pool account on Solana:", pool ? `✓ owner ${pool.owner.toBase58()}` : "✗ missing");
const lpAta = (await import("@rome-protocol/sdk")).deriveAta(T.vaultAuthorityKey(cfg, triumph), T.hexToPubkey(l.lpMint));
const lp = await getAccount(conn, lpAta);
console.log("  LP locked in Triumph PDA:", lp ? `✓ ${lp.amount} raw` : "✗ none");

function sl(x: T.LaunchView) {
  return `| sold ${formatUnits(x.sold, 6)} / ${formatUnits(p.curveSupply, 6)} · raised ${u(x.raised)}`;
}
