// Test wallets for the browser E2E run. Keys stay in Node: the page gets an injected
// `window.ethereum` and a Wallet Standard Solana wallet whose methods call back into
// Node through page.exposeFunction, so only addresses and signatures reach the page.
import type { Page } from "puppeteer-core";
import type { Keypair } from "@solana/web3.js";
import type { Account } from "viem";
import { toLaneSigner } from "@rome-protocol/sdk";
import { eip1193FromAccount } from "../lib/eip1193Node.js";

export interface WalletLog {
  evm: string[];
  sol: string[];
}

export async function installWallets(page: Page, opts: { evm: Account; sol: Keypair; rpcUrl: string; chainId: number }, log: WalletLog) {
  const evm = eip1193FromAccount(opts.evm, opts.rpcUrl, opts.chainId);
  const signer = toLaneSigner(opts.sol);

  await page.exposeFunction("__e2eEvm", async (json: string) => {
    const req = JSON.parse(json);
    if (req.method === "eth_sendTransaction" || req.method === "wallet_switchEthereumChain") log.evm.push(req.method);
    try {
      const result = req.method === "wallet_switchEthereumChain" ? null : await evm.request(req);
      return JSON.stringify({ result }, (_k, v) => (typeof v === "bigint" ? `0x${v.toString(16)}` : v));
    } catch (e: any) {
      return JSON.stringify({ error: { message: e?.details ?? e?.shortMessage ?? e?.message ?? String(e), code: e?.code ?? -32603 } });
    }
  });
  await page.exposeFunction("__e2eSolPubkey", async () => Array.from(opts.sol.publicKey.toBytes()));
  await page.exposeFunction("__e2eSolPubkeyB58", async () => opts.sol.publicKey.toBase58());
  await page.exposeFunction("__e2eSolSignMessage", async (msg: number[]) => {
    log.sol.push("signMessage");
    return Array.from(await signer.signAuthHash(Uint8Array.from(msg)));
  });
  await page.exposeFunction("__e2eSolSignTx", async (wire: number[]) => {
    log.sol.push("signTransaction");
    return Array.from(await signer.signV1Wire(Uint8Array.from(wire)));
  });

  await page.evaluateOnNewDocument(() => {
    const w = window as any;
    w.ethereum = {
      isMetaMask: true,
      request: async (a: { method: string; params?: unknown[] }) => {
        const r = JSON.parse(await w.__e2eEvm(JSON.stringify(a)));
        if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code });
        return r.result;
      },
      on() {},
      removeListener() {},
    };

    const icon =
      "data:image/svg+xml;base64," +
      btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0b53bf"/><text x="16" y="21" font-size="12" text-anchor="middle" fill="#fff" font-family="sans-serif">E2E</text></svg>');
    let accounts: any[] = [];
    const wallet = {
      version: "1.0.0",
      name: "E2E Solana",
      icon,
      chains: ["solana:devnet"],
      get accounts() {
        return accounts;
      },
      features: {
        "standard:connect": {
          version: "1.0.0",
          connect: async () => {
            const publicKey = new Uint8Array(await w.__e2eSolPubkey());
            accounts = [{ address: await w.__e2eSolPubkeyB58(), publicKey, chains: ["solana:devnet"], features: ["solana:signMessage", "solana:signTransaction"] }];
            return { accounts };
          },
        },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signMessage": {
          version: "1.0.0",
          signMessage: async (...inputs: any[]) =>
            Promise.all(inputs.map(async (i) => ({ signedMessage: i.message, signature: new Uint8Array(await w.__e2eSolSignMessage(Array.from(i.message))) }))),
        },
        "solana:signTransaction": {
          version: "1.0.0",
          supportedTransactionVersions: ["legacy", 0],
          signTransaction: async (...inputs: any[]) =>
            Promise.all(
              inputs.map(async (i) => {
                const sig = new Uint8Array(await w.__e2eSolSignTx(Array.from(i.transaction)));
                const out = new Uint8Array(i.transaction.length + 64);
                out.set(i.transaction);
                out.set(sig, i.transaction.length);
                return { signedTransaction: out };
              }),
            ),
        },
      },
    };
    const cb = ({ register }: any) => register(wallet);
    window.addEventListener("wallet-standard:app-ready", (e: any) => cb(e.detail));
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: cb }));
  });
}
