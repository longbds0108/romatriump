// Wallet lanes as app state: MetaMask (EVM lane) and/or a Solana wallet (Solana lane).
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Hex } from "viem";
import type { PublicKey } from "@solana/web3.js";
import type { SignerLike } from "@rome-protocol/sdk";
import { cfg } from "./config";
import { connectEvm, connectSolana, ensureChain, injected, watchSolanaWallets, type SolWallet } from "./wallets";
import * as T from "../lib/triumph";

export interface Lanes {
  evm: { address: Hex } | null;
  sol: { signer: SignerLike; publicKey: PublicKey; name: string; icon?: string; wallet: SolWallet } | null;
  active: "evm" | "solana" | null;
  lane: T.Lane | null;
  /** chain id MetaMask reports, as a number; null when no EVM wallet is connected */
  evmChainId: number | null;
  setActive: (k: "evm" | "solana") => void;
  connectEvm: () => Promise<void>;
  connectSol: (w: SolWallet) => Promise<void>;
  switchNetwork: () => Promise<void>;
  disconnect: (k: "evm" | "solana") => void;
}

export const LaneCtx = createContext<Lanes | null>(null);

// Which wallets to reconnect after a reload. Only names and flags, never keys or addresses.
const SAVED = "triumph.wallets";
type Saved = { evm?: boolean; sol?: string; active?: "evm" | "solana" | null };
const loadSaved = (): Saved => {
  try {
    return JSON.parse(localStorage.getItem(SAVED) ?? "{}") ?? {};
  } catch {
    return {};
  }
};
const save = (s: Saved) => {
  try {
    localStorage.setItem(SAVED, JSON.stringify(s));
  } catch {
    /* storage blocked: wallets just won't auto-reconnect */
  }
};
export const useLanes = () => useContext(LaneCtx)!;

export function useLaneState(): Lanes {
  const [evm, setEvm] = useState<Lanes["evm"]>(null);
  const [sol, setSol] = useState<Lanes["sol"]>(null);
  const [active, setActive] = useState<Lanes["active"]>(null);
  const [evmChainId, setEvmChainId] = useState<number | null>(null);
  const touched = useRef(false);

  // Silent reconnect: eth_accounts never prompts; Wallet Standard connect({ silent }) neither.
  useEffect(() => {
    const s = loadSaved();
    let off: (() => void) | undefined;
    const eth = injected();
    if (s.evm && eth)
      eth
        .request({ method: "eth_accounts" })
        .then((a: Hex[]) => {
          if (!a?.[0]) return;
          setEvm({ address: a[0] });
          setActive((cur) => (s.active === "evm" || !cur ? "evm" : cur));
          return eth.request({ method: "eth_chainId" }).then((c: string) => setEvmChainId(Number(c)));
        })
        .catch(() => {});
    if (s.sol) {
      let tried = false;
      off = watchSolanaWallets((ws) => {
        const w = ws.find((x) => x.name === s.sol);
        if (!w || tried) return;
        tried = true;
        connectSolana(w, true)
          .then((r) => {
            setSol({ ...r, name: w.name, icon: w.icon, wallet: w });
            setActive((cur) => (s.active === "solana" || !cur ? "solana" : cur));
          })
          .catch(() => {});
      });
    }
    return () => off?.();
  }, []);

  useEffect(() => {
    if (touched.current) save({ evm: !!evm, sol: sol?.name, active });
  }, [evm, sol, active]);

  useEffect(() => {
    const eth = injected();
    if (!eth?.on) return;
    const onAcc = (a: Hex[]) => setEvm((cur) => (cur ? (a?.[0] ? { address: a[0] } : null) : cur));
    const onChain = (c: string) => setEvmChainId(Number(c));
    eth.on("accountsChanged", onAcc);
    eth.on("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAcc);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, []);

  // Keep the active lane valid when one side disconnects.
  useEffect(() => {
    if (active === "evm" && !evm) setActive(sol ? "solana" : null);
    if (active === "solana" && !sol) setActive(evm ? "evm" : null);
  }, [active, evm, sol]);

  const lane = useMemo<T.Lane | null>(() => {
    if (active === "evm" && evm) return T.evmLane(cfg, injected()!, evm.address);
    if (active === "solana" && sol) return T.solanaLane(cfg, sol.signer);
    return null;
  }, [active, evm, sol]);

  const readChain = async () => {
    const eth = injected();
    if (eth) setEvmChainId(Number(await eth.request({ method: "eth_chainId" })));
  };

  return {
    evm,
    sol,
    active,
    lane,
    evmChainId,
    setActive: (k) => ((touched.current = true), setActive(k)),
    connectEvm: async () => {
      touched.current = true;
      const address = await connectEvm();
      setEvm({ address });
      setActive("evm");
      await readChain();
    },
    connectSol: async (w) => {
      touched.current = true;
      const r = await connectSolana(w);
      setSol({ ...r, name: w.name, icon: w.icon, wallet: w });
      setActive("solana");
    },
    switchNetwork: async () => {
      const eth = injected();
      if (!eth) throw new Error("No EVM wallet found.");
      await ensureChain(eth);
      await readChain();
    },
    disconnect: (k) => {
      touched.current = true;
      if (k === "evm") setEvm(null);
      else {
        const f = (sol?.wallet.features as any)?.["standard:disconnect"];
        f?.disconnect?.().catch(() => {});
        setSol(null);
      }
    },
  };
}
