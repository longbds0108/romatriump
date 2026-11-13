// Graduate a completed launch on the live chain (EVM lane, deployer key).
//   npx tsx scripts/graduate.ts <launchId> [poolRentLamports]
// With a pool rent value, first sets the owner's rent budget (launch/vault budgets unchanged).
import { Connection } from "@solana/web3.js";
import { encodeFunctionData } from "viem";
import { cfg, deployer, triumphAddress } from "../lib/env.js";
import { eip1193FromAccount } from "../lib/eip1193Node.js";
import * as T from "../lib/triumph.js";
import { bytes32ToPubkey, poolInitAccounts } from "../lib/meteora.js";

const id = Number(process.argv[2] ?? 0);
const poolRent = process.argv[3] ? BigInt(process.argv[3]) : null;
const me = deployer();
const t = triumphAddress();
const pub = T.publicClient(cfg);
const lane = T.evmLane(cfg, eip1193FromAccount(me, cfg.proxyUrl, cfg.chainId), me.address);
const rd = (functionName: string) => pub.readContract({ address: t, abi: T.TRIUMPH_ABI, functionName } as any) as Promise<bigint>;

if (poolRent !== null) {
  const [lr, vr] = await Promise.all([rd("launchRent"), rd("vaultRent")]);
  const r = await lane.send(t, encodeFunctionData({ abi: T.TRIUMPH_ABI, functionName: "setRentBudgets", args: [lr, vr, poolRent] }));
  console.log("setRentBudgets", poolRent, `${cfg.explorerUrl}/tx/${r.hash}`);
}
const l = await T.readLaunch(cfg, t, id);
const p = await T.readParams(cfg, t);
const { accounts, pool } = await poolInitAccounts(new Connection(cfg.solanaRpc, "confirmed"), t, bytes32ToPubkey(l.mint), p.poolFeeBps, cfg);
const data = encodeFunctionData({ abi: T.TRIUMPH_ABI, functionName: "graduate", args: [BigInt(id), accounts] });
try {
  const g = await pub.estimateGas({ account: me.address, to: t, data });
  console.log("estimate ok:", g, "gas");
} catch (e: any) {
  console.log("estimate failed:", e?.details ?? e?.shortMessage ?? e?.message);
  process.exit(1);
}
const r = await lane.send(t, data);
console.log("graduate", `${cfg.explorerUrl}/tx/${r.hash}`);
console.log("pool", pool.toBase58(), `${cfg.solanaExplorer}/address/${pool.toBase58()}?cluster=${cfg.solanaCluster}`);
