# Triumph — a graduation launchpad on Rome

Every launch is a real SPL token on Solana. It trades on a USDC bonding curve from **MetaMask** (EVM lane, `submitRomeTx`) or **any Solana wallet** (Solana lane, `submitRomeTxV1`), against the same contract state. When the curve sells out, trading halts and one transaction CPIs into **Meteora DAMM v1** to open a TOKEN/USDC pool, seeded with all USDC raised plus the reserve, at exactly the curve's final price. The LP tokens land in the contract's PDA and no code path moves them.

## Layout
- `contracts/` Foundry. `src/Triumph.sol`, `src/IRome.sol`, `test/` (27 tests; precompile mocks that also enforce Rome's one-track rule).
- `lib/` registry config, Meteora account derivation (after rome-protocol/cardo), dual-lane client.
- `scripts/` `check.ts` (read-only preflight), `deploy.ts`, `smoke.ts` (full on-chain lifecycle), `gen-config.ts`.
- `src/` React web app.

## Design notes
- Supply 1B (6 dec). Curve share C = S(V+R)/(2V+R), reserve L = S·V/(2V+R), so pool price R/L equals the curve's end price.
- Single precompile track per entry point: `launch`/`registerWrapper`/`initTokenVault`/`graduate` on legacy CPI, `buy`/`sell`/`withdrawFees` on the cached SPL track.
- Holdings sit in SPL accounts owned by the contract PDA (not wrapper escrow) because Meteora needs the PDA to sign. Users grant the contract as SPL delegate once per mint (`Helper.approve_spl`).
- `graduate` pins every account that could redirect value or signer privilege (mints, payer ATAs, payer, all programs, rent); Meteora validates the other PDA seeds.
- Rent for new Solana accounts is bought with `swap_gas_to_lamports` (only the shortfall), billed to the caller as gas.

## Run
```bash
npm install
npm run test:contracts
npx tsx scripts/check.ts      # preflight
npm run build:contracts && npm run deploy   # needs Hadrian USDC gas on ROME_EVM_KEY
npm run smoke                 # launch → trade → graduate on testnet
npm run dev                   # http://127.0.0.1:5180
```
