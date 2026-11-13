// The registry reads the filesystem, so project it to static JSON the browser can import.
import { writeFileSync } from "node:fs";
import { cfg } from "../lib/env.js";

const out = {
  ...cfg,
  triumph: (process.env.TRIUMPH_ADDRESS || null) as string | null,
  triumphFromBlock: process.env.TRIUMPH_FROM_BLOCK ? Number(process.env.TRIUMPH_FROM_BLOCK) : null,
};
writeFileSync(new URL("../src/config.generated.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log("wrote src/config.generated.json — chain", out.chainId, out.triumph ? `triumph ${out.triumph}` : "(no TRIUMPH_ADDRESS yet)");
