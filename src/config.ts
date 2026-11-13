import raw from "./config.generated.json";
import type { TriumphConfig } from "../lib/config";
import type { Hex } from "viem";

export const cfg = raw as unknown as TriumphConfig & { triumph: Hex | null; triumphFromBlock: number | null };
export const TRIUMPH = cfg.triumph;
export const evmTx = (h: string) => `${cfg.explorerUrl}/tx/${h}`;
export const evmAddr = (a: string) => `${cfg.explorerUrl}/address/${a}`;
export const solAddr = (a: string) => `${cfg.solanaExplorer}/address/${a}?cluster=${cfg.solanaCluster}`;
export const solTx = (s: string) => `${cfg.solanaExplorer}/tx/${s}?cluster=${cfg.solanaCluster}`;
