// Wallet lanes as app state: MetaMask (EVM lane) and/or a Solana wallet (Solana lane).
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Hex } from "viem";
import type { PublicKey } from "@solana/web3.js";
import type { SignerLike } from "@rome-protocol/sdk";
import { cfg } from "./config";
import { connectEvm, connectSolana, ensureChain, injected, type SolWallet } from "./wallets";
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
export const useLanes = () => useContext(LaneCtx)!;

export function useLaneState(): Lanes {
  const [evm, setEvm] = useState<Lanes["evm"]>(null);
  const [sol, setSol] = useState<Lanes["sol"]>(null);
  const [active, setActive] = useState<Lanes["active"]>(null);
  const [evmChainId, setEvmChainId] = useState<number | null>(null);

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
    setActive,
    connectEvm: async () => {
      const address = await connectEvm();
      setEvm({ address });
      setActive("evm");
      await readChain();
    },
    connectSol: async (w) => {
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
      if (k === "evm") setEvm(null);
      else {
        const f = (sol?.wallet.features as any)?.["standard:disconnect"];
        f?.disconnect?.().catch(() => {});
        setSol(null);
      }
    },
  };
}
