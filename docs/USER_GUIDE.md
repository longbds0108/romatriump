# Triumph user guide

Triumph is a token launchpad on Rome. Every launch is a real SPL token on Solana. It trades on a USDC bonding curve that MetaMask and Solana wallets share. When the curve sells out, anyone can graduate it: one transaction opens a Meteora pool on Solana at the curve's final price, and the pool's LP tokens stay locked in the contract.

This guide covers the public testnet, **Rome Hadrian**.

## 1. What you need

| | MetaMask (EVM lane) | Solana wallet (Solana lane) |
|---|---|---|
| Wallet | MetaMask or any injected EVM wallet | Solflare (it signs Solana v1 transactions; Phantom support is pending on Rome's side) |
| Network | Rome Hadrian, added for you on connect | Solana devnet |
| Funds | USDC on Hadrian. On Rome, USDC is also the gas token | devnet SOL for fees, plus devnet USDC to buy with |

If MetaMask doesn't add the network for you, add it by hand:

| Field | Value |
|---|---|
| Network name | Rome Hadrian |
| RPC URL | `https://hadrian.testnet.romeprotocol.xyz/` |
| Chain ID | `200010` |
| Currency symbol | `USDC` (18 decimals) |
| Block explorer | `https://via-hadrian.testnet.romeprotocol.xyz` |

The devnet USDC mint is `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.

## 2. Open the app

The source is at https://github.com/longbds0108/romatriump. To run it locally:

```bash
git clone https://github.com/longbds0108/romatriump.git && cd romatriump
npm install
npm run dev        # opens http://127.0.0.1:5180
```

## 3. Connect a wallet

1. Click **Connect wallet** at the top right.
2. Pick **MetaMask** (EVM lane) or your Solana wallet (Solana lane).
3. You can connect both. Open the account menu and click **Use** on the lane that should sign. Both lanes act on the same contract and the same curves.

A Solana wallet gets a **Rome account (synthetic)**: an EVM address that Rome derives from your Solana key. The account menu shows it, and the contract sees you at that address.

The app reconnects your wallets after a reload without a prompt.

## 4. Buy and sell

1. Open a launch from **Launches** on the home page.
2. Under **Buy**, type an amount in USDC or tap 0.1, 0.5 or 1. The panel shows how many tokens you get, the 1% fee and a 3% slippage limit.
3. Click **Buy with MetaMask** or **Buy with Solflare**, then confirm each step in your wallet. The step list shows a link for every transaction:
   - **MetaMask:** if your USDC is still gas, the first step moves the amount you need into your USDC token account.
   - **Solana wallet:** the first time, *Set up your Rome account* creates your Rome account. The next step brings the USDC you need over from your Solana wallet.
   - **Allow Triumph to take USDC (once):** a one-time approval for each token.
   - **Buy**.
4. To sell, switch to **Sell**, pick 25%, 50% or 100% (or type an amount), and click **Sell**. The USDC goes to your Rome account.

A buy that would pass the graduation target is trimmed: you pay only what the curve still needs.

**Solana lane:** the tokens you buy sit in your Rome account. Click **Move $TOKEN to wallet** (or **Move USDC to wallet**) under the trade panel to send them to your Solana wallet.

## 5. Start a launch

1. Click **Start a launch** in the sidebar or on the home page.
2. Enter a name (up to 32 bytes) and a symbol (1–10 letters or digits, not already used).
3. Click **Launch from …** and confirm two transactions:
   - **Create $SYMBOL on Solana** mints the fixed 1,000,000,000 supply as an SPL token. The contract keeps the mint authority, so nobody can mint more.
   - **Register the ERC-20 wrapper** gives the token an ERC-20 address on Rome, so EVM wallets can see it.

The rent for the new Solana accounts is paid as gas.

## 6. Graduate to Meteora

On the testnet, a curve sells 750M tokens and closes at **3 USDC raised**.

1. When the curve sells out, the launch shows **Ready to graduate**, and trading on the curve stops.
2. Anyone with a connected wallet can click **Graduate to Meteora**. Two steps run:
   - **Open a Meteora vault** for the token, only the first time.
   - **Graduate** opens a Meteora DAMM v1 TOKEN/USDC pool with all the USDC raised plus the 250M reserve tokens.
3. The page then shows **Graduated to Meteora** with a link to the pool on Solana. From here the token trades on Meteora.

Whoever triggers graduation pays the rent for the pool accounts as gas, about 0.03 SOL in value.

## 7. Track activity

- **Activity** in the sidebar shows volume, open curves, every trade, launch and graduation, and your own history when a wallet is connected.
- Each launch page lists its trades, with a link to every transaction on the Hadrian explorer.

## 8. Troubleshooting

| Message | What to do |
|---|---|
| *Not enough USDC on Rome* | Fund your MetaMask address with Hadrian USDC, or use the Solana lane with devnet USDC in your Solana wallet. |
| The **Rome Hadrian** chip in the header shows a warning | MetaMask is on another network. Click the chip to add or switch to Rome Hadrian. |
| *No Solana wallet detected* | Install Solflare, then reload the page. |
| *Slippage* error | The price moved by more than 3% before your trade landed. Try again. |
| *More than you hold* | Lower the sell amount, or tap 100%. |

## 9. Contract and links

| | |
|---|---|
| Triumph contract | [`0x4adee16cff2c521253f2e82b4f3161a391d22331`](https://via-hadrian.testnet.romeprotocol.xyz/address/0x4adee16cff2c521253f2e82b4f3161a391d22331) |
| Contract PDA on Solana (holds the funds and LP) | [`3Ju9uZz9AT7vbn4iDg7hy7tCJi8iH2m1S5omdCGSb7Y3`](https://explorer.solana.com/address/3Ju9uZz9AT7vbn4iDg7hy7tCJi8iH2m1S5omdCGSb7Y3?cluster=devnet) |
| Example pool (launch #1) | [`4ELGBt91…Dyqwr`](https://explorer.solana.com/address/4ELGBt912W9eTzpMqj7fxQToRRpcyB2RAB93bMyDaqwr?cluster=devnet) |
| Source | https://github.com/longbds0108/romatriump |
