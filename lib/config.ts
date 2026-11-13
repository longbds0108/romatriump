// Everything Triumph needs about the chain, resolved from @rome-protocol/registry.
// No hardcoded chain ids, RPCs, contract addresses, mints or program ids.
import { getChain, getContracts, getPrograms, getTokens } from "@rome-protocol/registry";
import type { Hex } from "viem";

export interface TriumphConfig {
  chainId: number;
  chainName: string;
  proxyUrl: string;
  explorerUrl: string;
  solanaRpc: string;
  solanaCluster: string;
  solanaExplorer: string;
  romeEvmProgramId: string;
  wusdc: Hex; // ERC-20 wrapper over the gas-token USDC mint
  usdcMint: string; // base58
  factory: Hex; // ERC20SPLFactory (live)
  programs: {
    meteoraDammV1: string;
    meteoraVault: string;
    metaplex: string;
    splToken: string;
    associatedToken: string;
    system: string;
  };
}

// Meteora's dynamic-vault program and Metaplex are not in the registry's program list
// (they are fixed, cluster-independent ids). Source: rome-protocol/cardo lib/meteora-pool-create.ts.
const METEORA_VAULT_PROGRAM = "24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi";
const METAPLEX_PROGRAM = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

export const DEFAULT_CHAIN_ID = 200010; // Rome Hadrian (testnet)

function live(name: string, chainId: number): Hex {
  const c = (getContracts(chainId) ?? []).find((x: any) => x.name === name);
  const v = c?.versions?.find((x: any) => x.status === "live");
  if (!v) throw new Error(`${name} has no live deployment on chain ${chainId} in the registry`);
  return v.address as Hex;
}

export function loadConfig(o: { chainId?: number; proxyUrl?: string; solanaRpc?: string } = {}): TriumphConfig {
  const chainId = o.chainId ?? DEFAULT_CHAIN_ID;
  const chain = getChain(chainId);
  if (!chain) throw new Error(`chain ${chainId} not in @rome-protocol/registry`);
  const tokens = getTokens(chainId) ?? [];
  const gas = tokens.find((t: any) => t.kind === "gas");
  const wusdc = tokens.find((t: any) => t.kind === "spl_wrapper" && t.mintId === gas?.mintId);
  if (!wusdc) throw new Error(`no wUSDC wrapper on chain ${chainId}`);
  const p = getPrograms(chain.network);
  if (!p?.meteoraDammV1) throw new Error(`Meteora DAMM v1 is not listed for ${chain.network}`);
  return {
    chainId,
    chainName: chain.name,
    proxyUrl: o.proxyUrl || chain.rpcUrl,
    explorerUrl: chain.explorerUrl.replace(/\/$/, ""),
    solanaRpc: o.solanaRpc || chain.solana.rpc,
    solanaCluster: chain.solana.cluster,
    solanaExplorer: chain.solana.explorerUrl.replace(/\/$/, ""),
    romeEvmProgramId: chain.romeEvmProgramId,
    wusdc: wusdc.address as Hex,
    usdcMint: wusdc.mintId,
    factory: live("ERC20SPLFactory", chainId),
    programs: {
      meteoraDammV1: p.meteoraDammV1,
      meteoraVault: METEORA_VAULT_PROGRAM,
      metaplex: METAPLEX_PROGRAM,
      splToken: p.splToken,
      associatedToken: p.associatedToken,
      system: p.systemProgram,
    },
  };
}
