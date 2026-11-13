// Read-only: the deployed Triumph's parameters and launches.
import { formatUnits } from "viem";
import { cfg, triumphAddress } from "../lib/env.js";
import * as T from "../lib/triumph.js";

const t = triumphAddress();
const pub = T.publicClient(cfg);
const rd = (functionName: string) => pub.readContract({ address: t, abi: T.TRIUMPH_ABI, functionName } as any);
const p = await T.readParams(cfg, t);
console.log("Triumph", t, "| owner", await rd("owner"), "| launches", await rd("launchCount"));
console.log(
  "curve", formatUnits(p.curveSupply, 6),
  "| reserve", formatUnits(p.lpSupply, 6),
  "| virtual", formatUnits(p.virtualUsdc, 6),
  "| graduates at", formatUnits(p.graduationUsdc, 6), "USDC | pool fee", p.poolFeeBps, "bps",
);
console.log("factory", await rd("factory"), "| authority", await rd("vaultAuthority"), "| fees", formatUnits((await rd("protocolFees")) as bigint, 6));
for (const l of await T.readLaunches(cfg, t))
  console.log(
    ` #${l.id} $${l.symbol} ${l.status} sold ${formatUnits(l.sold, 6)} raised ${formatUnits(l.raised, 6)} mint ${l.mintBase58}${l.poolBase58 ? ` pool ${l.poolBase58}` : ""}`,
  );
