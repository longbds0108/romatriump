// Read-only preflight: config, deployer funding, PDA derivation parity, Meteora readiness.
import { formatUnits, parseAbi } from "viem";
import { Connection, PublicKey } from "@solana/web3.js";
import { deriveAuthorityPda, pubkeyToBytes32 } from "@rome-protocol/sdk";
import { cfg, deployer } from "../lib/env.js";
import { publicClient } from "../lib/triumph.js";
import { readVault } from "../lib/meteora.js";

const me = deployer();
const pub = publicClient(cfg);
console.log("chain      ", cfg.chainId, cfg.chainName, (await pub.getChainId()) === cfg.chainId ? "✓ rpc" : "✗ rpc mismatch");
console.log("factory    ", cfg.factory, (await pub.getCode({ address: cfg.factory }))?.length ? "✓ code" : "✗ no code");
console.log("wUSDC      ", cfg.wusdc, "mint", cfg.usdcMint);
const bal = await pub.getBalance({ address: me.address });
console.log("deployer   ", me.address, formatUnits(bal, 18), "USDC (gas)");

const helper = parseAbi(["function pda(address user) view returns (bytes32)"]);
const onchain = await pub.readContract({ address: "0xff00000000000000000000000000000000000009", abi: helper, functionName: "pda", args: [me.address] });
const sdk = pubkeyToBytes32(deriveAuthorityPda(me.address, cfg.romeEvmProgramId));
console.log("pda parity ", onchain === sdk ? "✓" : `✗ precompile ${onchain} sdk ${sdk}`);

const conn = new Connection(cfg.solanaRpc, "confirmed");
const v = await readVault(conn, new PublicKey(cfg.usdcMint), cfg);
console.log("meteora    ", "USDC vault", v.vault.toBase58(), v.exists ? "✓" : "✗ missing");
