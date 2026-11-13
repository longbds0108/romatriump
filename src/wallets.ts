// Two wallet lanes. EVM: an injected EIP-1193 wallet (MetaMask). Solana: any Wallet
// Standard wallet that can sign messages and Solana v1 transactions (Rome's Solana lane).
import { getWallets } from "@wallet-standard/app";
import { PublicKey } from "@solana/web3.js";
import type { Hex } from "viem";
import type { SignerLike } from "@rome-protocol/sdk";
import { cfg } from "./config";

type Eip1193 = { request: (a: { method: string; params?: any[] }) => Promise<any>; on?: (e: string, f: (...a: any[]) => void) => void; removeListener?: (e: string, f: (...a: any[]) => void) => void };

export function injected(): Eip1193 | null {
  return ((window as any).ethereum as Eip1193) ?? null;
}

export async function connectEvm(): Promise<Hex> {
  const eth = injected();
  if (!eth) throw new Error("No EVM wallet found. Install MetaMask to use the EVM lane.");
  const [account] = (await eth.request({ method: "eth_requestAccounts" })) as Hex[];
  await ensureChain(eth);
  return account;
}

export async function ensureChain(eth: Eip1193) {
  const want = `0x${cfg.chainId.toString(16)}`;
  const have = await eth.request({ method: "eth_chainId" });
  if (have === want) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
  } catch (e: any) {
    if (e?.code !== 4902 && !/unrecognized|not added|unknown chain/i.test(String(e?.message))) throw e;
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: want,
          chainName: cfg.chainName,
          nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
          rpcUrls: [cfg.proxyUrl],
          blockExplorerUrls: [cfg.explorerUrl],
        },
      ],
    });
  }
}

// ── Solana (Wallet Standard), after rome-protocol/create-rome-app lib/solanaWallet.ts ──

export type SolWallet = ReturnType<ReturnType<typeof getWallets>["get"]>[number];
const chainId = () => (/^mainnet/.test(cfg.solanaCluster) ? "solana:mainnet" : cfg.solanaCluster === "testnet" ? "solana:testnet" : "solana:devnet");
const REQUIRED = ["standard:connect", "solana:signMessage", "solana:signTransaction"];
const usable = (w: SolWallet) => REQUIRED.every((f) => f in w.features) && (w.chains as readonly string[]).some((c) => c.startsWith("solana:"));

export function watchSolanaWallets(onChange: (w: SolWallet[]) => void): () => void {
  const { get, on } = getWallets();
  const emit = () => onChange(get().filter(usable));
  emit();
  const offs = [on("register", emit), on("unregister", emit)];
  return () => offs.forEach((off) => off());
}

export async function connectSolana(wallet: SolWallet): Promise<{ signer: SignerLike; publicKey: PublicKey }> {
  const features = wallet.features as any;
  const { accounts } = await features["standard:connect"].connect();
  const account = accounts?.[0];
  if (!account) throw new Error(`${wallet.name} returned no account.`);
  const chain = chainId();
  const publicKey = new PublicKey(account.publicKey);
  const signer = {
    payer: publicKey,
    signAuthHash: async (message: Uint8Array) => {
      const [{ signature, signedMessage }] = await features["solana:signMessage"].signMessage({ account, message });
      if (signedMessage && (signedMessage.length !== message.length || signedMessage.some((b: number, i: number) => b !== message[i])))
        throw new Error(`${wallet.name} changed the authorization message before signing it.`);
      return signature;
    },
    signV1Wire: async (transaction: Uint8Array) => {
      const [{ signedTransaction }] = await features["solana:signTransaction"].signTransaction({ account, transaction, chain });
      return (signedTransaction as Uint8Array).slice(-64);
    },
  };
  return { signer, publicKey };
}
