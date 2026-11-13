import type { Connection, PublicKey } from "@solana/web3.js";
/** Minimal SPL token-account read (amount at offset 64), no spl-token dependency. */
export async function getAccount(conn: Connection, ata: PublicKey) {
  const info = await conn.getAccountInfo(ata);
  if (!info || info.data.length < 72) return null;
  return { amount: info.data.readBigUInt64LE(64), owner: info.owner };
}
