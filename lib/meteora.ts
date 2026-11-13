// Account lists for the two Meteora instructions Triumph CPIs into, derived exactly as
// Rome's own cardo app does (lib/meteora-pool-create.ts, scripts/create-vault.mjs), which
// in turn follows rome-sdk/rome-meteora's Anchor account structs. Triumph pins every account
// that could redirect value or signer privilege; Meteora checks the PDA seeds of the rest.
import { Connection, PublicKey, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { deriveAta, deriveAuthorityPda, pubkeyToBytes32 } from "@rome-protocol/sdk";
import type { Hex } from "viem";
import type { TriumphConfig } from "./config.js";

const VAULT_BASE = new PublicKey("HWzXGcGHy4tcpYfaRDCyLNzXqBTv3E6BttpCH2vJxArv");
const DEFAULT_FEE_BPS = 25n;
const TOKEN_VAULT_OFFSET = 19; // Vault account layout (cardo use-meteora-vault-states.ts)
const LP_MINT_OFFSET = 115;

const pk = (s: string | PublicKey) => (typeof s === "string" ? new PublicKey(s) : s);
const find = (seeds: (Buffer | Uint8Array)[], program: PublicKey) => PublicKey.findProgramAddressSync(seeds, program)[0];

export function bytes32ToPubkey(h: Hex): PublicKey {
  return new PublicKey(Buffer.from(h.slice(2), "hex"));
}

export function vaultFor(mint: PublicKey, cfg: TriumphConfig) {
  const vp = pk(cfg.programs.meteoraVault);
  const vault = find([Buffer.from("vault"), mint.toBuffer(), VAULT_BASE.toBuffer()], vp);
  return {
    vault,
    tokenVault: find([Buffer.from("token_vault"), vault.toBuffer()], vp),
    lpMint: find([Buffer.from("lp_mint"), vault.toBuffer()], vp),
  };
}

/** Reads token_vault / lp_mint from the live vault account (legacy vaults store a non-PDA lp_mint). */
export async function readVault(conn: Connection, mint: PublicKey, cfg: TriumphConfig) {
  const d = vaultFor(mint, cfg);
  const info = await conn.getAccountInfo(d.vault);
  if (!info) return { ...d, exists: false };
  return {
    vault: d.vault,
    tokenVault: new PublicKey(info.data.subarray(TOKEN_VAULT_OFFSET, TOKEN_VAULT_OFFSET + 32)),
    lpMint: new PublicKey(info.data.subarray(LP_MINT_OFFSET, LP_MINT_OFFSET + 32)),
    exists: true,
  };
}

export function triumphAuthority(triumph: Hex, cfg: TriumphConfig): PublicKey {
  return deriveAuthorityPda(triumph, cfg.romeEvmProgramId);
}

/** `initialize` on the dynamic-vault program: vault, payer, token_vault, token_mint, lp_mint, rent, token_program, system_program. */
export function vaultInitAccounts(triumph: Hex, mint: PublicKey, cfg: TriumphConfig): Hex[] {
  const v = vaultFor(mint, cfg);
  return [
    v.vault,
    triumphAuthority(triumph, cfg),
    v.tokenVault,
    mint,
    v.lpMint,
    SYSVAR_RENT_PUBKEY,
    pk(cfg.programs.splToken),
    pk(cfg.programs.system),
  ].map((k) => pubkeyToBytes32(k));
}

export function poolAddress(mintA: PublicKey, mintB: PublicKey, feeBps: bigint, cfg: TriumphConfig): PublicKey {
  const a = mintA.toBuffer();
  const b = mintB.toBuffer();
  const [first, second] = a.compare(b) > 0 ? [a, b] : [b, a];
  const seeds: Buffer[] = [Buffer.from([0]), first, second];
  if (feeBps !== DEFAULT_FEE_BPS) {
    const fee = Buffer.alloc(8);
    fee.writeBigUInt64LE(feeBps);
    seeds.push(fee);
  }
  return find(seeds, pk(cfg.programs.meteoraDammV1));
}

/**
 * The 26 accounts of `initialize_permissionless_pool_with_fee_tier`, token A = launch mint,
 * token B = USDC, payer = Triumph's PDA. Reads both vaults from chain.
 */
export async function poolInitAccounts(conn: Connection, triumph: Hex, mint: PublicKey, feeBps: bigint, cfg: TriumphConfig) {
  const damm = pk(cfg.programs.meteoraDammV1);
  const mpl = pk(cfg.programs.metaplex);
  const usdc = pk(cfg.usdcMint);
  const payer = triumphAuthority(triumph, cfg);
  const [va, vb] = await Promise.all([readVault(conn, mint, cfg), readVault(conn, usdc, cfg)]);
  if (!vb.exists) throw new Error("Meteora has no USDC vault on this cluster");

  const pool = poolAddress(mint, usdc, feeBps, cfg);
  const lpMint = find([Buffer.from("lp_mint"), pool.toBuffer()], damm);
  const aVaultLp = find([va.vault.toBuffer(), pool.toBuffer()], damm);
  const bVaultLp = find([vb.vault.toBuffer(), pool.toBuffer()], damm);
  const accounts = [
    pool, // 0
    lpMint, // 1
    mint, // 2 token_a_mint
    usdc, // 3 token_b_mint
    va.vault, // 4
    vb.vault, // 5
    va.tokenVault, // 6
    vb.tokenVault, // 7
    va.lpMint, // 8
    vb.lpMint, // 9
    aVaultLp, // 10
    bVaultLp, // 11
    deriveAta(payer, mint), // 12 payer_token_a
    deriveAta(payer, usdc), // 13 payer_token_b
    deriveAta(payer, lpMint), // 14 payer_pool_lp (LP lands here and never moves)
    find([Buffer.from("fee"), mint.toBuffer(), pool.toBuffer()], damm), // 15
    find([Buffer.from("fee"), usdc.toBuffer(), pool.toBuffer()], damm), // 16
    payer, // 17 signer
    aVaultLp, // 18 fee_owner (Meteora hard-codes a_vault_lp)
    SYSVAR_RENT_PUBKEY, // 19
    find([Buffer.from("metadata"), mpl.toBuffer(), lpMint.toBuffer()], mpl), // 20
    mpl, // 21
    pk(cfg.programs.meteoraVault), // 22
    pk(cfg.programs.splToken), // 23
    pk(cfg.programs.associatedToken), // 24
    pk(cfg.programs.system), // 25
  ];
  return { pool, lpMint, tokenVaultReady: va.exists, accounts: accounts.map((k) => pubkeyToBytes32(k)) };
}
