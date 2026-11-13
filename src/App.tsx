import { useState } from "react";
import { cfg, evmTx, TRIUMPH } from "./config";
import { LaneCtx, useLaneState, useLanes } from "./lanes";
import { Shell } from "./Shell";
import { useChainData } from "./chain";
import * as T from "../lib/triumph";
import { Avatar, Empty, Modal, perM, short, StatusChip, Steps, tok, usdc, useSteps } from "./ui";
import TokenPage from "./Token";
import ActivityPage from "./Activity";

// ─── home ─────────────────────────────────────────────────────────────────

function CurveArt() {
  // Shape of the constant-product curve and the graduation hand-off (illustration, not market data).
  const pEnd = 1 / Math.pow(1 - 0.62, 2);
  const pts = Array.from({ length: 60 }, (_, i) => {
    const s = i / 59;
    const p = 1 / Math.pow(1 - s * 0.62, 2);
    return [30 + s * 300, 220 - ((p - 1) / (pEnd - 1)) * 160];
  });
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [ex, ey] = pts[pts.length - 1];
  return (
    <div className="surface hero-art">
      <svg viewBox="0 0 460 250" aria-hidden="true">
        <defs>
          <linearGradient id="cv" x1="0" x2="1">
            <stop offset="0" stopColor="#6a8ad4" />
            <stop offset="1" stopColor="#e8e3d5" />
          </linearGradient>
          <linearGradient id="fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="rgba(131,170,255,0.22)" />
            <stop offset="1" stopColor="rgba(131,170,255,0)" />
          </linearGradient>
        </defs>
        {[60, 110, 160, 210].map((y) => (
          <line key={y} x1="30" x2="440" y1={y} y2={y} stroke="rgba(255,255,255,0.05)" />
        ))}
        <path d={`${d} L${ex},230 L30,230 Z`} fill="url(#fill)" />
        <path d={d} fill="none" stroke="url(#cv)" strokeWidth="3" strokeLinecap="round" />
        <line x1={ex} x2={ex} y1={ey} y2="230" stroke="rgba(255,255,255,0.18)" strokeDasharray="4 5" />
        <path d={`M${ex},${ey} C ${ex + 40},${ey} ${ex + 40},${ey} 420,${ey}`} stroke="#4fd1c5" strokeWidth="3" strokeDasharray="2 7" strokeLinecap="round" fill="none" />
        <circle cx={ex} cy={ey} r="7" fill="#e8e3d5" />
        <circle cx={ex} cy={ey} r="14" fill="none" stroke="rgba(232,227,213,0.35)" />
        <rect x="392" y={ey - 22} width="56" height="44" rx="12" fill="#10201e" stroke="#4fd1c5" />
        <text x="420" y={ey - 3} textAnchor="middle" fill="#4fd1c5" fontSize="11" fontWeight="600">
          Meteora
        </text>
        <text x="420" y={ey + 12} textAnchor="middle" fill="#8fe0d6" fontSize="9.5">
          pool
        </text>
        <text x={ex - 8} y={ey - 16} textAnchor="end" fill="#e8e3d5" fontSize="11" fontWeight="600">
          graduation
        </text>
      </svg>
      <div className="cap">
        <span>Bonding curve · priced in USDC on Rome</span>
        <span>Same price, now on Solana</span>
      </div>
    </div>
  );
}

function Home({ data, go, onLaunch }: { data: ReturnType<typeof useChainData>; go: (v: View) => void; onLaunch: () => void }) {
  const [filter, setFilter] = useState<"all" | "Trading" | "Completed" | "Graduated">("all");
  const ls = data.launches ?? [];
  const p = data.params;
  const graduated = ls.filter((l) => l.status === "Graduated").length;
  const onCurves = ls.filter((l) => l.status !== "Graduated").reduce((n, l) => n + l.raised, 0n);
  const shown = ls.filter((l) => filter === "all" || l.status === filter);
  return (
    <main className="wrap">
      <section className="hero">
        <div>
          <p className="eyebrow">Triumph · Rome Builder Arena · Hadrian testnet</p>
          <h1 className="title-sheen">Launch on a curve. Graduate to Solana.</h1>
          <p className="lead">
            Every Triumph launch is a real SPL token. It trades on a bonding curve from MetaMask or a Solana wallet, and the moment the curve sells out, one transaction opens a
            Meteora pool on Solana at the exact final price. The LP is locked in the contract forever.
          </p>
          <div className="hero-cta">
            <button className="btn btn-primary btn-lg" onClick={onLaunch}>
              Start a launch
            </button>
            <a className="btn btn-lg" href="#launches">
              Browse launches
            </a>
          </div>
          {!TRIUMPH && (
            <p className="well banner">
              <b>Not deployed yet.</b> The Triumph contract has no address on {cfg.chainName}. Everything here reads live chain state, so it stays empty until the contract is
              deployed.
            </p>
          )}
          {data.error && <p className="well banner">Chain read failed: {data.error}</p>}
        </div>
        <CurveArt />
      </section>

      <section className="stats">
        <div className="surface stat">
          <span>Launches</span>
          <b>{data.launches ? ls.length : "—"}</b>
          <small>on {cfg.chainName}</small>
        </div>
        <div className="surface stat">
          <span>Graduated</span>
          <b>{data.launches ? graduated : "—"}</b>
          <small>pools opened on Meteora</small>
        </div>
        <div className="surface stat">
          <span>USDC on open curves</span>
          <b>{data.launches ? usdc(onCurves) : "—"}</b>
          <small>held by the contract</small>
        </div>
        <div className="surface stat">
          <span>Graduation target</span>
          <b>{p ? usdc(p.graduationUsdc) : "—"}</b>
          <small>USDC raised per curve</small>
        </div>
      </section>

      <section id="launches">
        <div className="sec-head">
          <div>
            <p className="eyebrow">Live on {cfg.chainName}</p>
            <h2>Launches</h2>
          </div>
          <div className="segmented" role="tablist" aria-label="Filter launches">
            {(["all", "Trading", "Completed", "Graduated"] as const).map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : f === "Trading" ? "On curve" : f === "Completed" ? "Ready" : "Graduated"}
              </button>
            ))}
          </div>
        </div>
        {!data.launches ? (
          <div className="skeleton" style={{ height: 220 }} />
        ) : shown.length === 0 ? (
          <Empty title={ls.length ? "Nothing in this filter" : "No launches yet"}>
            {ls.length ? "Try another filter." : TRIUMPH ? "Be the first: a launch mints a fixed-supply SPL token and opens its curve." : "Launches appear here once the contract is deployed."}
          </Empty>
        ) : (
          <div className="grid">
            {shown.map((l) => {
              const pct = p ? Number((l.status === "Graduated" ? p.graduationUsdc : l.raised) * 10_000n / p.graduationUsdc) / 100 : 0;
              return (
                <button className="surface card-item card" key={l.id} onClick={() => go({ name: "token", id: l.id })}>
                  <div className="card-top">
                    <Avatar l={l} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h3 className="truncate">{l.name}</h3>
                      <span className="sym">${l.symbol}</span>
                    </div>
                    <StatusChip s={l.status} />
                  </div>
                  <div className="progress">
                    <i style={{ width: `${pct}%` }} />
                  </div>
                  <div className="row">
                    <span>
                      <b>{pct.toFixed(1)}%</b> to graduation
                    </span>
                    <span>{p && l.status !== "Graduated" ? perM(T.priceOf(p, l)) : l.poolBase58 ? short(l.poolBase58) : ""}</span>
                  </div>
                  <div className="row" style={{ marginTop: 6 }}>
                    <span>Sold {p ? `${tok(l.sold)} / ${tok(p.curveSupply)}` : tok(l.sold)}</span>
                    <span className="dim">#{l.id}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="how" id="how">
        <div className="well" style={{ borderRadius: 18 }}>
          <span className="eyebrow">01 · LAUNCH</span>
          <b>A real SPL token</b>
          <p>The contract creates the mint on Solana, mints a fixed 1B supply and keeps the mint authority in its own PDA. No owner can mint more.</p>
        </div>
        <div className="well" style={{ borderRadius: 18 }}>
          <span className="eyebrow">02 · CURVE</span>
          <b>One curve, two lanes</b>
          <p>MetaMask and Solana wallets buy and sell against the same constant-product curve, priced in USDC, through Rome's two transaction lanes.</p>
        </div>
        <div className="well" style={{ borderRadius: 18 }}>
          <span className="eyebrow">03 · GRADUATE</span>
          <b>Atomic hand-off</b>
          <p>When the curve sells out, trading stops. One CPI opens a Meteora DAMM pool with every USDC raised plus the reserve, at the curve's final price.</p>
        </div>
        <div className="well" style={{ borderRadius: 18 }}>
          <span className="eyebrow">04 · LOCK</span>
          <b>LP locked by code</b>
          <p>The pool's LP tokens land in the contract's PDA. No function moves them, so the liquidity cannot be pulled.</p>
        </div>
      </section>
    </main>
  );
}

// ─── launch dialog ────────────────────────────────────────────────────────

function LaunchDialog({ onClose, onDone, launches }: { onClose: () => void; onDone: (id: number) => void; launches: T.LaunchView[] }) {
  const L = useLanes();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const S = useSteps();
  const sym = symbol.trim().toUpperCase();
  const taken = launches.some((l) => l.symbol.toUpperCase() === sym);
  const valid = name.trim().length > 0 && new TextEncoder().encode(name.trim()).length <= 32 && /^[A-Z0-9]{1,10}$/.test(sym) && !taken;

  const go = () =>
    S.run(async (step) => {
      if (!L.lane || !TRIUMPH) throw new Error("Connect a wallet first.");
      const tri = TRIUMPH;
      const lane = L.lane;
      if (lane.kind === "solana") await step("Set up your Rome account", () => T.solanaProvision(cfg, L.sol!.signer), (r) => (r ? evmTx(r.hash) : undefined));
      await step(`Create $${sym} on Solana`, () => T.launch(lane, tri, name.trim(), sym), (r) => evmTx(r.hash));
      const n = Number(await T.publicClient(cfg).readContract({ address: tri, abi: T.TRIUMPH_ABI, functionName: "launchCount" }));
      const id = n - 1;
      await step("Register the ERC-20 wrapper", () => T.registerWrapper(lane, tri, id), (r) => evmTx(r.hash));
      onDone(id);
    });

  return (
    <Modal onClose={onClose}>
      <p className="eyebrow">New launch</p>
      <h2 className="title-sheen">Start a launch</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Mints a fixed 1,000,000,000 supply as an SPL token on Solana {cfg.solanaCluster}. Rent for the new accounts is paid in gas.
      </p>
      <label className="label" htmlFor="ln">
        Name
      </label>
      <input id="ln" className="input" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} placeholder="Victory Coin" />
      <label className="label" htmlFor="ls" style={{ marginTop: 14 }}>
        Symbol
      </label>
      <input id="ls" className="input" maxLength={10} value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="VICT" />
      {taken && <p className="err-text">That symbol is already used by another launch.</p>}
      <div style={{ marginTop: 18 }}>
        {!L.lane ? (
          <p className="muted">Connect MetaMask or a Solana wallet in the header to launch.</p>
        ) : (
          <button className="btn btn-primary btn-lg btn-block" disabled={!valid || S.busy || !TRIUMPH} onClick={go}>
            {S.busy ? "Launching…" : `Launch from ${L.lane.kind === "evm" ? "MetaMask" : L.sol?.name}`}
          </button>
        )}
      </div>
      <Steps steps={S.steps} error={S.error} />
    </Modal>
  );
}

// ─── footer (Plinths homepage footer pattern) ─────────────────────────────

function SiteFooter({ onLaunch, go }: { onLaunch: () => void; go: (v: View) => void }) {
  const toHow = () => (go({ name: "home" }), setTimeout(() => document.getElementById("how")?.scrollIntoView({ behavior: "smooth" }), 30));
  const toLaunches = () => (go({ name: "home" }), setTimeout(() => document.getElementById("launches")?.scrollIntoView({ behavior: "smooth" }), 30));
  const sol = (a: string) => `${cfg.solanaExplorer}/address/${a}?cluster=${cfg.solanaCluster}`;
  return (
    <footer className="footer">
      <div className="footer__main wrap">
        <div className="footer__brand">
          <button className="brand" onClick={() => go({ name: "home" })}>
            <img src="/laurel.svg" alt="" width={30} height={30} />
            <span>Triumph</span>
          </button>
          <p>
            A graduation launchpad on Rome. Tokens start on a USDC bonding curve that MetaMask and Solana wallets share, then graduate in one transaction to a Meteora pool
            on Solana with the liquidity locked by code.
          </p>
          <div className="footer__social">
            <a href="https://x.com/Longlhu2Huu" target="_blank" rel="noreferrer" aria-label="X (opens in a new tab)" title="X">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
            <a href="https://t.me/lebry123" target="_blank" rel="noreferrer" aria-label="Telegram (opens in a new tab)" title="Telegram">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
              </svg>
            </a>
          </div>
        </div>
        <nav className="footer__col" aria-label="Product">
          <h4>Product</h4>
          <button onClick={toLaunches}>Launches</button>
          <button onClick={onLaunch}>Start a launch</button>
          <button onClick={toHow}>How it works</button>
        </nav>
        <nav className="footer__col" aria-label="On-chain">
          <h4>On-chain</h4>
          {TRIUMPH ? (
            <a href={`${cfg.explorerUrl}/address/${TRIUMPH}`} target="_blank" rel="noreferrer">
              Triumph contract ↗
            </a>
          ) : (
            <span className="dim">Triumph contract · not deployed</span>
          )}
          <a href={`${cfg.explorerUrl}/address/${cfg.factory}`} target="_blank" rel="noreferrer">
            ERC20SPLFactory ↗
          </a>
          <a href={sol(cfg.programs.meteoraDammV1)} target="_blank" rel="noreferrer">
            Meteora DAMM v1 ↗
          </a>
          <a href={cfg.explorerUrl} target="_blank" rel="noreferrer">
            {cfg.chainName} explorer ↗
          </a>
        </nav>
        <nav className="footer__col" aria-label="Resources">
          <h4>Resources</h4>
          <a href="https://docs.rome.builders" target="_blank" rel="noreferrer">
            Rome docs ↗
          </a>
          <a href="https://github.com/rome-protocol/rome-registry" target="_blank" rel="noreferrer">
            Rome registry ↗
          </a>
          <a href="https://docs.meteora.ag" target="_blank" rel="noreferrer">
            Meteora docs ↗
          </a>
        </nav>
      </div>
      <p className="footer__word" aria-hidden="true">
        triumph
      </p>
      <div className="footer__bottom wrap">
        <span>© 2026 Triumph</span>
        <span>
          {cfg.chainName} (chain {cfg.chainId}) · Solana {cfg.solanaCluster}
        </span>
      </div>
    </footer>
  );
}

// ─── app ──────────────────────────────────────────────────────────────────

type View = { name: "home" } | { name: "activity" } | { name: "token"; id: number };

export default function App() {
  const lanes = useLaneState();
  const data = useChainData();
  const [view, setView] = useState<View>(() => {
    const m = location.hash.match(/^#\/launch\/(\d+)/);
    if (m) return { name: "token", id: Number(m[1]) };
    return location.hash.startsWith("#/activity") ? { name: "activity" } : { name: "home" };
  });
  const [launching, setLaunching] = useState(false);
  const go = (v: View) => {
    setView(v);
    history.replaceState(null, "", v.name === "token" ? `#/launch/${v.id}` : v.name === "activity" ? "#/activity" : "#/");
    window.scrollTo({ top: 0 });
  };
  const scrollTo = (id: string) => {
    if (view.name !== "home") go({ name: "home" });
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }), 40);
  };
  const nav = { home: () => go({ name: "home" }), activity: () => go({ name: "activity" }), launch: () => setLaunching(true), how: () => scrollTo("how") };

  return (
    <LaneCtx.Provider value={lanes}>
      <Shell current={view.name === "activity" ? "activity" : "launches"} go={nav}>
        {view.name === "home" ? (
          <Home data={data} go={go} onLaunch={() => setLaunching(true)} />
        ) : view.name === "activity" ? (
          <ActivityPage data={data} open={(id) => go({ name: "token", id })} onLaunch={() => setLaunching(true)} />
        ) : (
          <TokenPage id={view.id} data={data} back={() => go({ name: "home" })} />
        )}
      </Shell>
      {launching && (
        <LaunchDialog
          launches={data.launches ?? []}
          onClose={() => setLaunching(false)}
          onDone={(id) => {
            data.refresh();
            setTimeout(() => {
              setLaunching(false);
              go({ name: "token", id });
            }, 900);
          }}
        />
      )}
      <SiteFooter onLaunch={() => setLaunching(true)} go={go} />
    </LaneCtx.Provider>
  );
}
