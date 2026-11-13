// Read-only diagnostics for graduation: PDA lamports, vault state, pool accounts that exist already.
import { Connection, PublicKey } from "@solana/web3.js";
import { cfg, triumphAddress } from "../lib/env.js";
import * as T from "../lib/triumph.js";
import { bytes32ToPubkey, poolInitAccounts, readVault } from "../lib/meteora.js";

const t = triumphAddress();
const id = Number(process.argv[2] ?? 0);
const conn = new Connection(cfg.solanaRpc, "confirmed");
const l = await T.readLaunch(cfg, t, id);
const p = await T.readParams(cfg, t);
const auth = T.vaultAuthorityKey(cfg, t);
const mint = bytes32ToPubkey(l.mint);
console.log("launch", id, l.status, "vaultReady", l.vaultReady);
console.log("authority PDA", auth.toBase58(), "lamports", await conn.getBalance(auth));
const v = await readVault(conn, mint, cfg);
console.log("token vault", v.vault.toBase58(), v.exists ? "exists" : "missing");
const { accounts, pool } = await poolInitAccounts(conn, t, mint, p.poolFeeBps, cfg);
const names = ["pool", "lp_mint", "token_a_mint", "token_b_mint", "a_vault", "b_vault", "a_token_vault", "b_token_vault", "a_vault_lp_mint", "b_vault_lp_mint", "a_vault_lp", "b_vault_lp", "payer_token_a", "payer_token_b", "payer_pool_lp", "protocol_token_a_fee", "protocol_token_b_fee", "payer", "fee_owner", "rent", "mint_metadata", "metadata_program", "vault_program", "token_program", "associated_token_program", "system_program"];
const infos = await conn.getMultipleAccountsInfo(accounts.map((h) => bytes32ToPubkey(h)));
infos.forEach((info, i) => {
  const k = bytes32ToPubkey(accounts[i]).toBase58();
  let extra = "";
  if (info && info.data.length === 165) extra = ` amount=${info.data.readBigUInt64LE(64)}`;
  console.log(String(i).padStart(2), names[i].padEnd(25), k, info ? `exists owner=${info.owner.toBase58().slice(0, 8)} len=${info.data.length} lamports=${info.lamports}${extra}` : "—");
});
console.log("pool", pool.toBase58());
for (const n of [82, 165, 679, 944, 1232]) console.log("rent", n, await conn.getMinimumBalanceForRentExemption(n));
