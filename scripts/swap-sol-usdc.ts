// Swap devnet SOL → devnet USDC on rome-dex's native USDC/SOL pool (0.05% tier), so a Solana
// wallet holding only SOL can pay Rome gas (USDC). Pool data: rome-protocol/rome-dex app/chains.yaml.
// Usage: npx tsx scripts/swap-sol-usdc.ts <SOL amount, e.g. 0.25>
import "dotenv/config";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { deriveAta } from "@rome-protocol/sdk";

const POOL = {
  program: new PublicKey("6uGAEN6UJgJUcDoUNHtGQoGwcSRSx4nEBtsYtfkhyaey"),
  swapState: new PublicKey("9zod7AYEDVTr1goUP4Kpsrf3Yqse3YDgW7ALRocEG8WR"),
  authority: new PublicKey("8n9X5L4huQdiNyRNYUP7s6vgWpBJYnVxHg1Xj4SLteW9"),
  mintA: new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"), // USDC
  mintB: new PublicKey("So11111111111111111111111111111111111111112"), // SOL
  vaultA: new PublicKey("Fsds5PorE9v8kiHCPkDqF1ecfXef1uvZga3TbCNeWMua"),
  vaultB: new PublicKey("7D25oe2187Gpjvo9joqdgnY1tfKx4TNUy6YwLs2rEdZ8"),
  poolMint: new PublicKey("H9Z5sSeYEDNeBSHnmZftkwuaRVVLhbRhwyMF3Ah6YYob"),
  feeBps: 5n,
};
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.ROME_SOLANA_KEY!)));
const conn = new Connection(process.env.SOLANA_RPC || "https://api.devnet.solana.com", "confirmed");
const sol = Number(process.argv[2] ?? "0.25");
const amountIn = BigInt(Math.round(sol * 1e9));

const u64 = (v: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
};
const ataIx = (owner: PublicKey, mint: PublicKey, ata: PublicKey) =>
  new TransactionInstruction({
    programId: ATA_PROGRAM,
    keys: [
      { pubkey: kp.publicKey, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]), // CreateIdempotent
  });

const wsolAta = deriveAta(kp.publicKey, POOL.mintB);
const usdcAta = deriveAta(kp.publicKey, POOL.mintA);
const [ra, rb] = await Promise.all([conn.getTokenAccountBalance(POOL.vaultA), conn.getTokenAccountBalance(POOL.vaultB)]);
const x = BigInt(rb.value.amount); // SOL reserve
const y = BigInt(ra.value.amount); // USDC reserve
const inAfterFee = (amountIn * (10_000n - POOL.feeBps)) / 10_000n;
const quote = (y * inAfterFee) / (x + inAfterFee);
const minOut = (quote * 97n) / 100n;
console.log(`swap ${sol} SOL → ~${Number(quote) / 1e6} USDC (min ${Number(minOut) / 1e6}) on rome-dex 0.05%`);

const swapIx = new TransactionInstruction({
  programId: POOL.program,
  keys: [
    { pubkey: POOL.swapState, isSigner: false, isWritable: true },
    { pubkey: POOL.authority, isSigner: false, isWritable: false },
    { pubkey: kp.publicKey, isSigner: true, isWritable: false },
    { pubkey: wsolAta, isSigner: false, isWritable: true }, // source user (SOL)
    { pubkey: POOL.vaultB, isSigner: false, isWritable: true }, // pool source vault
    { pubkey: POOL.vaultA, isSigner: false, isWritable: true }, // pool dest vault
    { pubkey: usdcAta, isSigner: false, isWritable: true }, // dest user (USDC)
    { pubkey: POOL.poolMint, isSigner: false, isWritable: true },
    { pubkey: POOL.mintB, isSigner: false, isWritable: false },
    { pubkey: POOL.mintA, isSigner: false, isWritable: false },
    { pubkey: TOKEN, isSigner: false, isWritable: false },
    { pubkey: TOKEN, isSigner: false, isWritable: false },
    { pubkey: TOKEN, isSigner: false, isWritable: false },
  ],
  data: Buffer.concat([Buffer.from([1]), u64(amountIn), u64(minOut)]), // Swap
});

const tx = new Transaction().add(
  ataIx(kp.publicKey, POOL.mintB, wsolAta),
  SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: wsolAta, lamports: amountIn }),
  new TransactionInstruction({ programId: TOKEN, keys: [{ pubkey: wsolAta, isSigner: false, isWritable: true }], data: Buffer.from([17]) }), // SyncNative
  ataIx(kp.publicKey, POOL.mintA, usdcAta),
  swapIx,
  new TransactionInstruction({
    programId: TOKEN,
    keys: [
      { pubkey: wsolAta, isSigner: false, isWritable: true },
      { pubkey: kp.publicKey, isSigner: false, isWritable: true },
      { pubkey: kp.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([9]), // CloseAccount: return leftover wSOL as SOL
  }),
);
const sig = await sendAndConfirmTransaction(conn, tx, [kp]);
console.log("tx", sig, `https://explorer.solana.com/tx/${sig}?cluster=devnet`);
const bal = await conn.getTokenAccountBalance(usdcAta);
console.log("USDC now", bal.value.uiAmountString, "| SOL now", (await conn.getBalance(kp.publicKey)) / 1e9);
