# Triumph — a graduation launchpad on Rome

Every launch is a real SPL token on Solana. It trades on a USDC bonding curve from **MetaMask** (EVM lane, `submitRomeTx`) or **any Solana wallet** (Solana lane, `submitRomeTxV1`), against the same contract state. When the curve sells out, trading halts and one transaction CPIs into **Meteora DAMM v1** to open a TOKEN/USDC pool, seeded with all USDC raised plus the reserve, at exactly the curve's final price. The LP tokens land in the contract's PDA and no code path moves them.

## Live on Rome Hadrian (chain 200010, Solana devnet)

| | |
|---|---|
| Triumph | [`0x4adee16cff2c521253f2e82b4f3161a391d22331`](https://via-hadrian.testnet.romeprotocol.xyz/address/0x4adee16cff2c521253f2e82b4f3161a391d22331) (deploy block 521699112, 72.2M gas) |
| Contract PDA (signs CPIs, holds funds + LP) | `3Ju9uZz9AT7vbn4iDg7hy7tCJi8iH2m1S5omdCGSb7Y3` |
| Curve | 750M tokens sold, 250M reserve, graduates at 3 USDC raised (testnet parameters) |

Verified with real transactions:
- **Full lifecycle, EVM lane** (launch #0 `$TRI4290`): launch → ERC-20 wrapper → buy → sell → buy to completion → Meteora vault → graduation. Pool [`DB5f7L4L…D9715`](https://explorer.solana.com/address/DB5f7L4L3Bj6qjv5sRBsJDhxG2hCTyWe8a2UqK1D9715?cluster=devnet) holds 250M tokens + 3.000000 USDC; the contract kept exactly the 0.042723 USDC of fees; 27,386.13 LP sit in the PDA's ATA. [graduate tx](https://via-hadrian.testnet.romeprotocol.xyz/tx/0x94cf9c0321aa955ee0d73936710bc4cd67a187f3f29ec3ea9043fb5ceefba544)
- **Dual lane** (launch #1 `$LAU400`): a Solana wallet with no EVM key launched, registered the wrapper, funded and bought through `submitRomeTxV1` (all atomic); MetaMask then bought on the same curve through `submitRomeTx`.
- Gas was funded from Solana devnet only: SOL → USDC on rome-dex's native pool (`scripts/swap-sol-usdc.ts`), then `fundSyntheticGas` + a native transfer to the deployer (`scripts/fund-from-solana.ts`).
- Measured graduation rent ≈ 27.7M lamports (Metaplex metadata alone 13.7M incl. its fee); default `poolRent` is now 30M.

## Layout
- `contracts/` Foundry. `src/Triumph.sol`, `src/IRome.sol`, `test/` (27 tests; precompile mocks that also enforce Rome's one-track rule).
- `lib/` registry config, Meteora account derivation (after rome-protocol/cardo), dual-lane client.
- `scripts/` `check.ts` (preflight), `deploy.ts`, `smoke.ts` (full lifecycle, EVM lane), `solana-lane.ts` (dual-lane proof), `graduate.ts`, `status.ts`, `inspect-grad.ts`, `swap-sol-usdc.ts` + `fund-from-solana.ts` (gas from a Solana devnet wallet), `gen-config.ts`, `local/` (anvil + mocks, UI checks only).
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
