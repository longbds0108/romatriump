// Browser E2E against the live Hadrian deployment, through the real UI.
//   npx tsx e2e/run.ts [phase ...]      phases: pages evm launch sol mobile   (default: all)
// Needs the dev server (npm run dev) and ROME_EVM_KEY / ROME_SOLANA_KEY in .env.
import "dotenv/config";
import { mkdirSync } from "node:fs";
import puppeteer, { type Page } from "puppeteer-core";
import { Keypair } from "@solana/web3.js";
import { cfg, deployer, triumphAddress } from "../lib/env.js";
import * as T from "../lib/triumph.js";
import { installWallets, type WalletLog } from "./shims.js";

const BASE = process.env.E2E_URL ?? "http://127.0.0.1:5180/";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = new URL("./out/", import.meta.url).pathname;
const LAUNCH = Number(process.env.E2E_LAUNCH ?? 1);
mkdirSync(OUT, { recursive: true });

const phases = process.argv.slice(2).length ? process.argv.slice(2) : ["pages", "evm", "launch", "sol", "mobile"];
const tri = triumphAddress();
const sol = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.ROME_SOLANA_KEY!)));
const results: { name: string; ok: boolean; info: string }[] = [];
const consoleErrors: string[] = [];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--window-size=1440,1000"] });

async function newPage(width = 1440, height = 1000) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  // tsx/esbuild wraps named functions in __name(); functions sent to the page need it too.
  await page.evaluateOnNewDocument("globalThis.__name = (f) => f;");
  const log: WalletLog = { evm: [], sol: [] };
  await installWallets(page, { evm: deployer(), sol, rpcUrl: cfg.proxyUrl, chainId: cfg.chainId }, log);
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(`[${page.url().split("#")[1] ?? "/"}] ${m.text().slice(0, 300)}`));
  page.on("pageerror", (e) => consoleErrors.push(`[pageerror] ${String(e).slice(0, 300)}`));
  return { page, log };
}

async function check(name: string, fn: () => Promise<string>) {
  const t0 = Date.now();
  try {
    const info = await fn();
    results.push({ name, ok: true, info: `${info} (${((Date.now() - t0) / 1000).toFixed(1)}s)` });
    console.log(`✔ ${name} — ${info}`);
  } catch (e: any) {
    const shot = `${OUT}fail-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
    for (const p of await browser.pages()) if (!p.isClosed() && p.url().startsWith("http")) await p.screenshot({ path: shot, fullPage: true }).catch(() => {});
    results.push({ name, ok: false, info: `${e?.message ?? String(e)} [${shot}]` });
    console.log(`✘ ${name} — ${e?.message ?? e}`);
  }
}

const text = (page: Page) => page.evaluate(() => document.body.innerText);
async function waitText(page: Page, needle: string | RegExp, timeout = 30_000) {
  await page.waitForFunction(
    (n: string, isRe: boolean) => (isRe ? new RegExp(n).test(document.body.innerText) : document.body.innerText.includes(n)),
    { timeout, polling: 250 },
    typeof needle === "string" ? needle : needle.source,
    typeof needle !== "string",
  );
}
async function click(page: Page, selector: string, label: string | RegExp) {
  const ok = await page.evaluate(
    (sel: string, l: string, isRe: boolean) => {
      const el = [...document.querySelectorAll<HTMLElement>(sel)].find((e) => (isRe ? new RegExp(l).test(e.innerText) : e.innerText.trim().includes(l)) && !(e as HTMLButtonElement).disabled);
      el?.click();
      return !!el;
    },
    selector,
    typeof label === "string" ? label : label.source,
    typeof label !== "string",
  );
  if (!ok) throw new Error(`no enabled ${selector} matching ${label}`);
}
async function typeInto(page: Page, selector: string, value: string) {
  await page.click(selector, { count: 3 });
  await page.keyboard.press("Backspace");
  await page.type(selector, value);
}
/** Wait for a Steps run inside `scope` to finish; returns its step labels or throws with the UI's error.
 *  Done = the action button left its busy label (or the dialog closed), stable across two polls. */
async function waitSteps(page: Page, scope: string, timeout = 8 * 60_000) {
  await page.waitForFunction((s: string) => !!document.querySelector(`${s} .steps .step`), { timeout: 30_000 }, scope);
  const snap = () =>
    page.evaluate((s: string) => {
      const root = document.querySelector(s);
      if (!root) return { gone: true, busy: false, steps: [] as string[], error: null as string | null };
      const busy = [...root.querySelectorAll<HTMLButtonElement>("button.btn-lg")].some((b) => /…$/.test(b.innerText.trim()));
      return {
        gone: false,
        busy: busy || !!root.querySelector(".steps .s.run"),
        steps: [...root.querySelectorAll(".steps .step")].map((e) => `${e.querySelector(".s")?.className.replace("s ", "")}: ${(e as HTMLElement).innerText.replace(/\s+/g, " ").trim()}`),
        error: root.querySelector(".err-text")?.textContent ?? null,
      };
    }, scope);
  const end = Date.now() + timeout;
  let last = await snap();
  let idle = 0;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 1500));
    const cur = await snap();
    if (cur.error) throw new Error(`UI error: ${cur.error}\n    ${cur.steps.join("\n    ")}`);
    if (cur.gone) return last.steps;
    if (!cur.steps.length) return last.steps; // panel swapped to its finished state
    if (!cur.busy) idle++;
    else idle = 0;
    last = cur;
    if (idle >= 2) return cur.steps;
  }
  throw new Error(`timed out; steps so far:\n    ${last.steps.join("\n    ")}`);
}
async function connect(page: Page, which: "MetaMask" | "E2E Solana") {
  await new Promise((r) => setTimeout(r, 1500)); // let the silent reconnect settle
  const hasRow = (w: string) => [...document.querySelectorAll<HTMLElement>(".lane-row")].some((r) => r.innerText.includes(w));
  if (!(await page.$(".acct-box__trigger"))) {
    await click(page, ".acct button", "Connect wallet");
    await page.waitForSelector(".acct-option", { timeout: 15_000 });
    await click(page, ".acct-option", which);
    await page.waitForSelector(".acct-box__trigger", { timeout: 30_000 });
  }
  await page.click(".acct-box__trigger");
  await page.waitForSelector(".lane-row", { timeout: 10_000 });
  if (!(await page.evaluate(hasRow, which))) {
    await click(page, ".acct-panel button", /Connect (a Solana wallet|MetaMask)/);
    await page.waitForSelector(".acct-option", { timeout: 15_000 });
    await click(page, ".acct-option", which);
    await page.waitForFunction(hasRow, { timeout: 30_000 }, which);
  }
  // Make the requested lane the active one.
  await page.evaluate((w: string) => {
    const row = [...document.querySelectorAll<HTMLElement>(".lane-row")].find((r) => r.innerText.includes(w));
    [...(row?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((b) => b.innerText.trim() === "Use")?.click();
  }, which);
  await page.waitForFunction((w: string) => [...document.querySelectorAll<HTMLElement>(".lane-row.is-active")].some((r) => r.innerText.includes(w)), { timeout: 10_000 }, which);
  await page.click(".acct-panel .icon-btn[aria-label=Close]").catch(() => page.mouse.click(700, 600));
}

// ── phases ───────────────────────────────────────────────────────────────────

if (phases.includes("pages")) {
  const { page } = await newPage();
  await check("home renders launches from chain", async () => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await waitText(page, "$LAU400");
    await waitText(page, "$TRI4290");
    await page.screenshot({ path: `${OUT}home.png`, fullPage: true });
    const t = await text(page);
    for (const s of ["Connect wallet", "Launches", "Activity", "Start a launch"]) if (!t.includes(s)) throw new Error(`missing "${s}"`);
    return "both launches listed, header + sidebar present";
  });
  await check("activity page loads events", async () => {
    await page.goto(`${BASE}#/activity`, { waitUntil: "domcontentloaded" });
    await waitText(page, /Buy|Sell/, 60_000);
    await page.screenshot({ path: `${OUT}activity.png`, fullPage: true });
    return "event rows visible";
  });
  await check("graduated token page (#0)", async () => {
    await page.goto(`${BASE}#/launch/0`, { waitUntil: "domcontentloaded" });
    await waitText(page, "Graduated to Meteora");
    await waitText(page, "DB5f");
    await page.screenshot({ path: `${OUT}token-0.png`, fullPage: true });
    return "pool link + LP note shown, trading disabled";
  });
  await check(`trading token page (#${LAUNCH}) without wallet`, async () => {
    await page.goto(`${BASE}#/launch/${LAUNCH}`, { waitUntil: "domcontentloaded" });
    await waitText(page, "Connect MetaMask or a Solana wallet to trade.");
    await page.screenshot({ path: `${OUT}token-1.png`, fullPage: true });
    return "connect prompt shown";
  });
  await check("browser Back returns to the previous view", async () => {
    await page.goBack();
    await waitText(page, "Graduated to Meteora");
    await page.goBack();
    await page.waitForFunction(() => location.hash.startsWith("#/activity"));
    await page.waitForSelector("h1.title-sheen");
    await page.goForward();
    await waitText(page, "Graduated to Meteora");
    return "history entries route both ways";
  });
  await page.close();
}

if (phases.includes("evm")) {
  const { page, log } = await newPage();
  await page.goto(`${BASE}#/launch/${LAUNCH}`, { waitUntil: "domcontentloaded" });
  await check("connect MetaMask (EVM lane)", async () => {
    await connect(page, "MetaMask");
    await waitText(page, "Buy with MetaMask");
    return `active lane EVM, ${deployer().address.slice(0, 8)}…`;
  });
  const before = await T.readLaunch(cfg, tri, LAUNCH);
  await check("EVM buy 0.1 USDC", async () => {
    await typeInto(page, 'input[aria-label="Amount"]', "0.1");
    await waitText(page, "You receive");
    await click(page, ".panel button.btn-lg", "Buy with MetaMask");
    const steps = await waitSteps(page, ".surface.panel:has(.tabs)");
    const after = await T.readLaunch(cfg, tri, LAUNCH);
    if (after.raised <= before.raised) throw new Error("raised did not grow");
    return `${steps.length} steps; raised ${Number(before.raised) / 1e6} → ${Number(after.raised) / 1e6}; ${log.evm.filter((m) => m === "eth_sendTransaction").length} wallet txs`;
  });
  await check("EVM sell 50% of holdings", async () => {
    await click(page, ".tabs button", "Sell");
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLButtonElement>(".quick button")].some((b) => b.innerText.includes("50%") && !b.disabled), { timeout: 30_000 });
    await click(page, ".quick button", "50%");
    await waitText(page, "You receive");
    const mid = await T.readLaunch(cfg, tri, LAUNCH);
    await click(page, ".panel button.btn-lg", "Sell with MetaMask");
    const steps = await waitSteps(page, ".surface.panel:has(.tabs)");
    const after = await T.readLaunch(cfg, tri, LAUNCH);
    if (after.sold >= mid.sold) throw new Error("sold did not shrink");
    return `${steps.length} steps; sold ${(Number(mid.sold) / 1e12).toFixed(2)}M → ${(Number(after.sold) / 1e12).toFixed(2)}M`;
  });
  await check("trade list shows the new trades", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitText(page, /Sell/, 60_000);
    await page.screenshot({ path: `${OUT}token-1-evm.png`, fullPage: true });
    return "sell row visible after reload";
  });
  await page.close();
}

if (phases.includes("launch")) {
  const { page } = await newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  const sym = `E2E${Math.floor(Math.random() * 900 + 100)}`;
  await check(`launch $${sym} from the UI (EVM lane)`, async () => {
    await connect(page, "MetaMask");
    await click(page, ".sidebar button, .nav-item", "Start a launch");
    await page.waitForSelector("#ln", { timeout: 10_000 });
    await page.type("#ln", "E2E Laurel");
    await page.type("#ls", sym);
    await click(page, ".modal button.btn-lg", "Launch from MetaMask");
    const steps = await waitSteps(page, ".modal");
    await waitText(page, `$${sym}`, 60_000);
    await page.waitForFunction(() => location.hash.startsWith("#/launch/"), { timeout: 30_000 }).catch(() => {});
    await page.screenshot({ path: `${OUT}launched.png`, fullPage: true });
    const n = Number(await T.publicClient(cfg).readContract({ address: tri, abi: T.TRIUMPH_ABI, functionName: "launchCount" }));
    const l = await T.readLaunch(cfg, tri, n - 1);
    if (l.symbol !== sym) throw new Error(`last launch is ${l.symbol}`);
    return `${steps.length} steps; launch #${n - 1} mint ${l.mintBase58}, wrapper ${l.wrapper}, page ${await page.evaluate(() => location.hash)}`;
  });
  await page.close();
}

if (phases.includes("sol")) {
  const { page, log } = await newPage();
  await page.goto(`${BASE}#/launch/${LAUNCH}`, { waitUntil: "domcontentloaded" });
  await check("connect Solana wallet (Wallet Standard)", async () => {
    await connect(page, "E2E Solana");
    if ((await T.readLaunch(cfg, tri, LAUNCH)).status === "Trading") {
      await waitText(page, "Buy with E2E Solana");
      await waitText(page, "Rome account (synthetic)");
    }
    return `synthetic ${T.solanaLane(cfg, sol).address}`;
  });
  const p = await T.readParams(cfg, tri);
  await check("Solana-lane buy completes the curve", async () => {
    const l = await T.readLaunch(cfg, tri, LAUNCH);
    if (l.status !== "Trading") return `skipped, launch is ${l.status}`;
    const need = p.graduationUsdc - l.raised;
    const amt = ((Number(need) * 1.03) / 1e6 + 0.01).toFixed(2);
    await typeInto(page, 'input[aria-label="Amount"]', amt);
    await waitText(page, "This buy completes the curve");
    await click(page, ".panel button.btn-lg", "Buy with E2E Solana");
    const steps = await waitSteps(page, ".surface.panel:has(.tabs)");
    const after = await T.readLaunch(cfg, tri, LAUNCH);
    if (after.status !== "Completed") throw new Error(`status ${after.status}`);
    return `entered ${amt} USDC; ${steps.length} steps (${steps.map((s) => s.split(":")[0]).join(",")}); signMessage×${log.sol.filter((x) => x === "signMessage").length} signTx×${log.sol.filter((x) => x === "signTransaction").length}`;
  });
  await check("graduate from the UI (Solana lane)", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".acct-box__trigger", { timeout: 20_000 }).catch(() => {
      throw new Error("wallet did not reconnect after reload");
    });
    await waitText(page, "Graduate to Meteora", 60_000);
    await click(page, ".panel button.btn-lg", "Graduate to Meteora");
    const steps = await waitSteps(page, "#graduation", 10 * 60_000).catch(async (e) => {
      await page.screenshot({ path: `${OUT}graduate-error.png`, fullPage: true });
      throw e;
    });
    await waitText(page, "Graduated to Meteora", 90_000);
    await page.screenshot({ path: `${OUT}token-1-graduated.png`, fullPage: true });
    const l = await T.readLaunch(cfg, tri, LAUNCH);
    return `${steps.length} steps; status ${l.status}; pool ${l.poolBase58}`;
  });
  await page.close();
}

if (phases.includes("mobile")) {
  const { page } = await newPage(390, 844);
  for (const [name, hash] of [["home", ""], ["activity", "#/activity"], ["token", `#/launch/${LAUNCH}`]] as const) {
    await check(`mobile 390px ${name}`, async () => {
      await page.goto(`${BASE}${hash}`, { waitUntil: "domcontentloaded" });
      await new Promise((r) => setTimeout(r, 2500));
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await page.screenshot({ path: `${OUT}m-${name}.png`, fullPage: true });
      if (over > 1) throw new Error(`horizontal overflow ${over}px`);
      return "no horizontal scroll";
    });
  }
  await check("mobile menu opens", async () => {
    await page.click(".menu-toggle");
    await page.waitForSelector("#mobile-nav", { visible: true, timeout: 5000 });
    await page.screenshot({ path: `${OUT}m-menu.png` });
    return "nav drawer visible";
  });
  await page.close();
}

await browser.close();
console.log("\n──── summary ────");
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}\n      ${r.info}`);
const errs = [...new Set(consoleErrors)];
console.log(`\nconsole errors: ${errs.length}`);
errs.slice(0, 20).forEach((e) => console.log("  " + e));
process.exit(results.every((r) => r.ok) ? 0 : 1);
