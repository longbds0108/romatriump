// Deploy Triumph to a Rome chain with config resolved from the registry.
//   npm run deploy            → deploys, prints TRIUMPH_ADDRESS for .env
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, formatUnits, http, type Hex } from "viem";
import { PublicKey, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { pubkeyToBytes32 } from "@rome-protocol/sdk";
import { cfg, deployer, romeChain } from "../lib/env.js";
import { TRIUMPH_ABI } from "../lib/triumphAbi.js";

// Testnet curve: starts at 1.5 USDC virtual liquidity, graduates at 3 USDC raised.
const VIRTUAL_USDC = BigInt(process.env.VIRTUAL_USDC ?? 1_500_000);
const GRADUATION_USDC = BigInt(process.env.GRADUATION_USDC ?? 3_000_000);
const POOL_FEE_BPS = BigInt(process.env.POOL_FEE_BPS ?? 25);

const artifact = JSON.parse(readFileSync(new URL("../contracts/out/Triumph.sol/Triumph.json", import.meta.url), "utf8"));
const b32 = (s: string) => pubkeyToBytes32(new PublicKey(s));
const config = {
  factory: cfg.factory,
  usdcMint: b32(cfg.usdcMint),
  meteoraDamm: b32(cfg.programs.meteoraDammV1),
  meteoraVault: b32(cfg.programs.meteoraVault),
  metadataProgram: b32(cfg.programs.metaplex),
  tokenProgram: b32(cfg.programs.splToken),
  ataProgram: b32(cfg.programs.associatedToken),
  systemProgram: b32(cfg.programs.system),
  rentSysvar: pubkeyToBytes32(SYSVAR_RENT_PUBKEY),
  virtualUsdc: VIRTUAL_USDC,
  graduationUsdc: GRADUATION_USDC,
  poolFeeBps: POOL_FEE_BPS,
};

const account = deployer();
const chain = romeChain();
const pub = createPublicClient({ chain, transport: http(cfg.proxyUrl) });
const wallet = createWalletClient({ account, chain, transport: http(cfg.proxyUrl) });
const before = await pub.getBalance({ address: account.address });
console.log("deployer", account.address, formatUnits(before, 18), "USDC gas");
if (before === 0n) {
  console.error("Deployer has no gas. Bridge USDC to Hadrian first (no faucet on Rome).");
  process.exit(1);
}
const gp = await pub.getGasPrice();
const hash = await wallet.deployContract({
  abi: TRIUMPH_ABI,
  bytecode: artifact.bytecode.object as Hex,
  args: [config],
  gas: 60_000_000n, // Rome prices Solana account creation into gas; charged gas is the exact usage
  maxFeePerGas: (gp * 3n) / 2n,
  maxPriorityFeePerGas: 0n,
});
console.log("tx", hash);
const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
if (r.status !== "success" || !r.contractAddress) throw new Error("deploy reverted");
const after = await pub.getBalance({ address: account.address });
console.log("Triumph deployed:", r.contractAddress, "| gas used", r.gasUsed.toString(), "| cost", formatUnits(before - after, 18), "USDC");
console.log(`${cfg.explorerUrl}/address/${r.contractAddress}`);
console.log(`→ set TRIUMPH_ADDRESS=${r.contractAddress} in .env`);
