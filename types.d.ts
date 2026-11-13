// @rome-protocol/registry ships JS + JSON without .d.ts.
declare module "@rome-protocol/registry" {
  export function listChains(): any[];
  export function getChain(chainId: number): any;
  export function getTokens(chainId: number): any[];
  export function getContracts(chainId: number): any;
  export function getPrograms(network: string): any;
}
