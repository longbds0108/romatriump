import "dotenv/config";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { loadConfig } from "./config.js";

export const cfg = loadConfig({
  chainId: process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : undefined,
  proxyUrl: process.env.PROXY_URL,
  solanaRpc: process.env.SOLANA_RPC,
});

export function deployer() {
  const k = process.env.ROME_EVM_KEY?.trim();
  if (!k || !/^0x[0-9a-fA-F]{64}$/.test(k)) {
    console.error("ROME_EVM_KEY missing in .env (a 0x 32-byte key funded with Hadrian USDC gas).");
    process.exit(1);
  }
  return privateKeyToAccount(k as Hex);
}

export function triumphAddress(): Hex {
  const a = process.env.TRIUMPH_ADDRESS?.trim();
  if (!a || !/^0x[0-9a-fA-F]{40}$/.test(a)) {
    console.error("TRIUMPH_ADDRESS missing in .env — run `npm run deploy` first.");
    process.exit(1);
  }
  return a as Hex;
}

export function romeChain() {
  return {
    id: cfg.chainId,
    name: cfg.chainName,
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [cfg.proxyUrl] } },
  } as const;
}
