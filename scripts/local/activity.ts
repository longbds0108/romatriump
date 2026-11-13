// LOCAL UI CHECK ONLY: drives real transactions through Triumph on an anvil chain whose Rome
// precompiles are the test mocks (contracts/script/LocalDeploy.s.sol). Never points at Hadrian.
import { createPublicClient, createWalletClient, encodePacked, http, keccak256, parseAbi, toBytes, type Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { TRIUMPH_ABI } from "../../lib/triumphAbi.js";

const RPC = "http://127.0.0.1:8545";
const [triumph, ledger] = process.argv.slice(2) as Hex[];
const chain = { id: 200010, name: "local", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;
const pub = createPublicClient({ chain, transport: http(RPC) });
// anvil's public default dev mnemonic (accounts 0-3), local chain only
const MNEMONIC = "test test test test test test test test test test test junk";
const acct = [0, 1, 2, 3].map((i) => mnemonicToAccount(MNEMONIC, { addressIndex: i }));
const w = acct.map((a) => createWalletClient({ account: a, chain, transport: http(RPC) }));
const HELPER = "0xff00000000000000000000000000000000000009" as const;
const H = parseAbi(["function approve_spl(address,uint64,bytes32)"]);
const LA = parseAbi([
  "function seed(bytes32,bytes32,uint64)",
  "function pda(address) view returns (bytes32)",
  "function ata(bytes32,bytes32) view returns (bytes32)",
  "function balance(bytes32,bytes32) view returns (uint64)",
]);
const k = (s: string) => keccak256(toBytes(s));
const USDC = k("usdc-mint");
const U64 = 2n ** 64n - 1n;

async function send(i: number, address: Hex, abi: any, functionName: string, args: unknown[]) {
  const hash = await w[i].writeContract({ address, abi, functionName, args } as any);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${functionName} reverted`);
  return r;
}
const T = (i: number, fn: string, args: unknown[]) => send(i, triumph, TRIUMPH_ABI, fn, args);
const pda = (a: Hex) => pub.readContract({ address: ledger, abi: LA, functionName: "pda", args: [a] });

for (let i = 0; i < 4; i++) await send(0, ledger, LA, "seed", [await pda(acct[i].address), USDC, 50_000_000n]);
for (let i = 0; i < 4; i++) await send(i, HELPER, H, "approve_spl", [triumph, U64, USDC]);

const launches = [
  ["Aurora Crown", "AUR"],
  ["Laurel", "LAUR"],
  ["Forum Coin", "FORUM"],
];
for (let i = 0; i < 3; i++) {
  await T(i, "launch", launches[i]);
  await T(i, "registerWrapper", [BigInt(i)]);
}
const mintOf = async (id: number) => ((await pub.readContract({ address: triumph, abi: TRIUMPH_ABI, functionName: "getLaunch", args: [BigInt(id)] })) as any).mint as Hex;
const buy = (i: number, id: number, amt: number) => T(i, "buy", [BigInt(id), BigInt(amt), 0n]);
async function sellThird(i: number, id: number) {
  const mint = await mintOf(id);
  const bal = await pub.readContract({ address: ledger, abi: LA, functionName: "balance", args: [mint, await pda(acct[i].address)] });
  await send(i, HELPER, H, "approve_spl", [triumph, U64, mint]);
  await T(i, "sell", [BigInt(id), bal / 3n, 0n]);
}

await buy(1, 0, 600_000);
await buy(2, 0, 450_000);
await buy(3, 0, 800_000);
await sellThird(2, 0);
await buy(0, 0, 5_000_000);
const m0 = await mintOf(0);
const me = await pda(triumph);
const vault: Hex[] = [keccak256(encodePacked(["string", "bytes32"], ["vault", m0])), me, keccak256(encodePacked(["string", "bytes32"], ["token_vault", m0])), m0, keccak256(encodePacked(["string", "bytes32"], ["vault_lp_mint", m0])), k("rent"), k("spl-token"), `0x${"0".repeat(64)}`];
await T(3, "initTokenVault", [0n, vault]);
const pool: Hex[] = [];
for (let i = 0; i < 26; i++) pool.push(keccak256(encodePacked(["string", "bytes32", "uint256"], ["acct", m0, BigInt(i)])));
pool[2] = m0;
pool[3] = USDC;
pool[4] = vault[0];
pool[12] = await pub.readContract({ address: ledger, abi: LA, functionName: "ata", args: [me, m0] });
pool[13] = await pub.readContract({ address: ledger, abi: LA, functionName: "ata", args: [me, USDC] });
pool[17] = me;
pool[19] = k("rent");
pool[21] = k("metaplex");
pool[22] = k("meteora-vault");
pool[23] = k("spl-token");
pool[24] = k("ata");
pool[25] = `0x${"0".repeat(64)}`;
await T(3, "graduate", [0n, pool]);

await buy(0, 1, 700_000);
await buy(3, 1, 500_000);
await sellThird(3, 1);
await buy(1, 1, 300_000);
await buy(2, 2, 1_000_000);
await buy(1, 2, 5_000_000);
console.log("launches:", await pub.readContract({ address: triumph, abi: TRIUMPH_ABI, functionName: "launchCount" }));
