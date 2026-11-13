// Dual-lane proof on the live chain: a Solana wallet (no EVM key) launches and buys through
// submitRomeTxV1, then the EVM deployer buys on the same curve through submitRomeTx.
//   npx tsx scripts/solana-lane.ts
import "dotenv/config";
import { Connection, Keypair } from "@solana/web3.js";
import { fundSyntheticGas } from "@rome-protocol/sdk";
import { formatUnits, parseUnits } from "viem";
import { cfg, deployer, triumphAddress } from "../lib/env.js";
import { eip1193FromAccount } from "../lib/eip1193Node.js";
import * as T from "../lib/triumph.js";

const t = triumphAddress();
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.ROME_SOLANA_KEY!)));
const sol = T.solanaLane(cfg, kp);
const deps = { connection: new Connection(cfg.solanaRpc, "confirmed"), proxyUrl: cfg.proxyUrl, chainId: cfg.chainId, programId: cfg.romeEvmProgramId, signer: kp };
const pub = T.publicClient(cfg);
const usdc = T.usdcMintHex(cfg);
const link = (r: T.TxResult | null) => (r ? `${cfg.explorerUrl}/tx/${r.hash} (${r.route}${r.signature ? `, solana ${r.signature.slice(0, 10)}…` : ""})` : "already done");

console.log("Solana wallet", kp.publicKey.toBase58(), "→ Rome address", sol.address);
const gas = await pub.getBalance({ address: sol.address });
if (gas < parseUnits("3", 18)) {
  const f = await fundSyntheticGas(deps, parseUnits("4", 18));
  console.log("  fund gas (4 USDC)    ", f.signature);
}
console.log("  provision            ", link(await T.solanaProvision(cfg, kp)));

const sym = `LAU${Math.floor(Math.random() * 900 + 100)}`;
console.log(`  launch $${sym}          `, link(await T.launch(sol, t, "Laurel Crown", sym)));
const id = Number(await pub.readContract({ address: t, abi: T.TRIUMPH_ABI, functionName: "launchCount" })) - 1;
console.log("  registerWrapper      ", link(await T.registerWrapper(sol, t, id)));

const BUY = 1_000_000n;
const f = await T.solanaFundUsdc(cfg, kp, BUY);
console.log("  fund leg (USDC)      ", f ? (f as any).signature ?? "sent" : "already funded");
console.log("  delegate USDC        ", link(await T.ensureDelegate(cfg, sol, t, usdc, BUY)));
const p = await T.readParams(cfg, t);
let l = await T.readLaunch(cfg, t, id);
const q = T.quoteBuy(p, l, BUY);
console.log("  buy 1 USDC (Solana)  ", link(await T.buy(sol, t, id, BUY, (q.tokensOut * 97n) / 100n)));
console.log("    Rome address holds", formatUnits(await T.splBalance(cfg, sol.address, (await T.readLaunch(cfg, t, id)).mint), 6), `$${sym}`);

const me = deployer();
const evm = T.evmLane(cfg, eip1193FromAccount(me, cfg.proxyUrl, cfg.chainId), me.address);
const EB = 500_000n;
const have = await T.splBalance(cfg, me.address, usdc);
if (have < EB) console.log("  wrap gas → USDC (EVM)", link(await T.wrapGasToUsdc(evm, (EB - have) * 10n ** 12n)));
console.log("  delegate USDC (EVM)  ", link(await T.ensureDelegate(cfg, evm, t, usdc, EB)));
l = await T.readLaunch(cfg, t, id);
console.log("  buy 0.5 USDC (EVM)   ", link(await T.buy(evm, t, id, EB, (T.quoteBuy(p, l, EB).tokensOut * 97n) / 100n)));
l = await T.readLaunch(cfg, t, id);
console.log(`  launch #${id} ${l.status}: sold ${formatUnits(l.sold, 6)} · raised ${formatUnits(l.raised, 6)} USDC · mint ${l.mintBase58}`);
