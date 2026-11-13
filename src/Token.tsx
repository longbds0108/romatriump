import { useCallback, useEffect, useMemo, useState } from "react";
import type { Hex } from "viem";
import { cfg, evmAddr, evmTx, solAddr, TRIUMPH } from "./config";
import { useLanes } from "./lanes";
import { loadTrades, type TradeEvent, type useChainData } from "./chain";
import * as T from "../lib/triumph";
import { Avatar, Empty, Lifecycle, parseAmount, perM, short, StatusChip, Steps, tok, usdc, useSteps } from "./ui";

const SLIPPAGE_BPS = 300n; // 3%

// ─── curve chart (from the contract's own parameters) ───────────────────────

function CurveChart({ p, l }: { p: T.CurveParams; l: T.LaunchView }) {
  const W = 640;
  const H = 260;
  const pad = { l: 8, r: 8, t: 16, b: 26 };
  const N = 80;
  const priceAt = (sold: bigint) => Number(p.k) / Number(p.virtualTokens0 - sold) ** 2; // dx/dy = k / y²
  const p0 = priceAt(0n);
  const p1 = priceAt(p.curveSupply);
  const X = (f: number) => pad.l + f * (W - pad.l - pad.r);
  const Y = (v: number) => H - pad.b - ((v - p0) / (p1 - p0)) * (H - pad.t - pad.b);
  const pts = Array.from({ length: N + 1 }, (_, i) => {
    const sold = (p.curveSupply * BigInt(i)) / BigInt(N);
    return [X(i / N), Y(priceAt(sold))] as const;
  });
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const sold = l.status === "Graduated" ? p.curveSupply : l.sold;
  const f = Number(sold) / Number(p.curveSupply);
  const cx = X(f);
  const cy = Y(priceAt(sold));
  const filled = pts.filter(([x]) => x <= cx + 0.01);
  const fd = filled.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bonding curve: price against tokens sold">
      <defs>
        <linearGradient id="cf" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="rgba(131,170,255,0.26)" />
          <stop offset="1" stopColor="rgba(131,170,255,0)" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1={pad.l} x2={W - pad.r} y1={pad.t + g * (H - pad.t - pad.b)} y2={pad.t + g * (H - pad.t - pad.b)} stroke="rgba(255,255,255,0.05)" />
      ))}
      <path d={d} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="2" strokeDasharray="3 5" />
      {filled.length > 1 && <path d={`${fd} L${cx},${H - pad.b} L${pad.l},${H - pad.b} Z`} fill="url(#cf)" />}
      {filled.length > 1 && <path d={fd} fill="none" stroke="#e8e3d5" strokeWidth="3" strokeLinecap="round" />}
      <line x1={cx} x2={cx} y1={cy} y2={H - pad.b} stroke="rgba(232,227,213,0.4)" strokeDasharray="3 4" />
      <circle cx={cx} cy={cy} r="6" fill={l.status === "Graduated" ? "#4fd1c5" : "#e8e3d5"} />
      <circle cx={cx} cy={cy} r="12" fill="none" stroke={l.status === "Graduated" ? "rgba(79,209,197,.4)" : "rgba(232,227,213,.35)"} />
      <text x={pad.l} y={H - 6} fill="#8f889a" fontSize="11">
        0 sold
      </text>
      <text x={W - pad.r} y={H - 6} fill="#8f889a" fontSize="11" textAnchor="end">
        {tok(p.curveSupply)} sold → graduation
      </text>
      <text x={pad.l + 2} y={pad.t + 10} fill="#8f889a" fontSize="11">
        {perM(p1)}
      </text>
    </svg>
  );
}

// ─── trade panel ───────────────────────────────────────────────────────────

function useBalances(l: T.LaunchView, who: Hex | null, tick: number) {
  const [b, setB] = useState<{ usdc: bigint; token: bigint; gas: bigint; walletUsdc?: bigint } | null>(null);
  useEffect(() => {
    let on = true;
    if (!who) return setB(null);
    Promise.all([T.splBalance(cfg, who, T.usdcMintHex(cfg)), T.splBalance(cfg, who, l.mint), T.nativeBalance(cfg, who)])
      .then(([u, t, g]) => on && setB({ usdc: u, token: t, gas: g }))
      .catch(() => on && setB(null));
    return () => {
      on = false;
    };
  }, [who, l.mint, tick]);
  return b;
}

function TradePanel({ p, l, onDone }: { p: T.CurveParams; l: T.LaunchView; onDone: () => void }) {
  const L = useLanes();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amt, setAmt] = useState("");
  const [tick, setTick] = useState(0);
  const S = useSteps();
  const who = L.lane?.address ?? null;
  const bal = useBalances(l, who, tick);
  const value = parseAmount(amt);
  const trading = l.status === "Trading";

  const q = useMemo(() => {
    if (!value || value === 0n) return null;
    if (side === "buy") return { kind: "buy" as const, ...T.quoteBuy(p, l, value) };
    return { kind: "sell" as const, ...T.quoteSell(p, l, value) };
  }, [value, side, p, l]);

  const exec = () =>
    S.run(async (step) => {
      if (!L.lane || !TRIUMPH || !value) throw new Error("Connect a wallet first.");
      const tri = TRIUMPH;
      const lane = L.lane;
      const usdcMint = T.usdcMintHex(cfg);
      const link = (r: T.TxResult | null) => (r ? evmTx(r.hash) : undefined);
      if (lane.kind === "solana") await step("Set up your Rome account", () => T.solanaProvision(cfg, L.sol!.signer), link);

      if (side === "buy") {
        const quote = T.quoteBuy(p, l, value);
        const charge = quote.charged;
        const have = await T.splBalance(cfg, lane.address, usdcMint);
        if (have < charge) {
          if (lane.kind === "evm") {
            const wei = (charge - have) * 10n ** 12n;
            if ((await T.nativeBalance(cfg, lane.address)) < wei) throw new Error("Not enough USDC on Rome. Bridge USDC to this address first.");
            await step(`Move ${usdc(charge - have, 4)} USDC from gas into your token account`, () => T.wrapGasToUsdc(lane, wei), link);
          } else {
            await step(`Bring ${usdc(charge - have, 4)} USDC from your Solana wallet`, () => T.solanaFundUsdc(cfg, L.sol!.signer, charge), () => undefined);
          }
        }
        await step("Allow Triumph to take USDC (once)", () => T.ensureDelegate(cfg, lane, tri, usdcMint, charge), link);
        const min = (quote.tokensOut * (10_000n - SLIPPAGE_BPS)) / 10_000n;
        await step(`Buy ${tok(quote.tokensOut)} $${l.symbol}`, () => T.buy(lane, tri, l.id, value, min), link);
      } else {
        const quote = T.quoteSell(p, l, value);
        await step(`Allow Triumph to take $${l.symbol} (once)`, () => T.ensureDelegate(cfg, lane, tri, l.mint, value), link);
        const min = (quote.usdcOut * (10_000n - SLIPPAGE_BPS)) / 10_000n;
        await step(`Sell for ${usdc(quote.usdcOut, 4)} USDC`, () => T.sell(lane, tri, l.id, value, min), link);
      }
      setAmt("");
      setTick((t) => t + 1);
      onDone();
    });

  const sweep = (mint: string, amount: bigint, label: string) =>
    S.run(async (step) => {
      await step(label, () => T.solanaSweep(cfg, L.sol!.signer, mint, amount), (r) => evmTx(r.hash));
      setTick((t) => t + 1);
    });

  const maxSell = bal?.token ?? 0n;
  const overSell = side === "sell" && value !== null && value > maxSell;
  return (
    <div className="surface panel">
      <div className="segmented tabs" role="tablist">
        <button role="tab" aria-selected={side === "buy"} onClick={() => (setSide("buy"), setAmt(""))}>
          Buy
        </button>
        <button role="tab" aria-selected={side === "sell"} onClick={() => (setSide("sell"), setAmt(""))}>
          Sell
        </button>
      </div>
      <div className="well field">
        <input inputMode="decimal" placeholder="0.00" value={amt} onChange={(e) => setAmt(e.target.value.replace(",", "."))} disabled={!trading} aria-label="Amount" />
        <span className="unit">{side === "buy" ? "USDC" : `$${l.symbol}`}</span>
      </div>
      <div className="quick">
        {side === "buy"
          ? ["0.1", "0.5", "1"].map((v) => (
              <button key={v} className="btn btn-sm" onClick={() => setAmt(v)} disabled={!trading}>
                {v} USDC
              </button>
            ))
          : [25, 50, 100].map((pc) => (
              <button key={pc} className="btn btn-sm" disabled={!trading || !maxSell} onClick={() => setAmt((Number((maxSell * BigInt(pc)) / 100n) / 1e6).toString())}>
                {pc}%
              </button>
            ))}
      </div>
      <div className="quote">
        {q?.kind === "buy" ? (
          <>
            <div className="row">
              <span>You receive</span>
              <b>
                {tok(q.tokensOut)} ${l.symbol}
              </b>
            </div>
            <div className="row">
              <span>Charged · fee 1%</span>
              <span>
                {usdc(q.charged, 4)} · {usdc(q.fee, 4)} USDC
              </span>
            </div>
            {q.completes && (
              <div className="row">
                <span style={{ color: "var(--success-fg)" }}>This buy completes the curve. Only what is needed is charged.</span>
              </div>
            )}
          </>
        ) : q?.kind === "sell" ? (
          <>
            <div className="row">
              <span>You receive</span>
              <b>{usdc(q.usdcOut, 4)} USDC</b>
            </div>
            <div className="row">
              <span>Fee 1%</span>
              <span>{usdc(q.fee, 4)} USDC</span>
            </div>
          </>
        ) : (
          <div className="row">
            <span>Price now</span>
            <b>{perM(T.priceOf(p, l))}</b>
          </div>
        )}
        <div className="row">
          <span>Slippage limit</span>
          <span>{Number(SLIPPAGE_BPS) / 100}%</span>
        </div>
      </div>
      {!trading ? (
        <p className="muted" style={{ margin: 0 }}>
          {l.status === "Completed" ? "The curve sold out. Trading moves to Meteora once it graduates." : "This token now trades on its Meteora pool on Solana."}
        </p>
      ) : !L.lane ? (
        <p className="muted" style={{ margin: 0 }}>
          Connect MetaMask or a Solana wallet to trade.
        </p>
      ) : (
        <button className={`btn btn-lg btn-block ${side === "buy" ? "btn-primary" : "btn-secondary"}`} disabled={!q || S.busy || overSell || (q.kind === "buy" ? q.tokensOut === 0n : q.usdcOut === 0n)} onClick={exec}>
          {S.busy ? "Confirm in your wallet…" : overSell ? "More than you hold" : `${side === "buy" ? "Buy" : "Sell"} with ${L.lane.kind === "evm" ? "MetaMask" : L.sol?.name}`}
        </button>
      )}
      <Steps steps={S.steps} error={S.error} />

      {who && bal && (
        <div className="quote" style={{ marginTop: 16, marginBottom: 0 }}>
          <div className="row">
            <span>{L.lane?.kind === "solana" ? "Rome account (synthetic)" : "Rome account"}</span>
            <a className="dim" href={evmAddr(who)} target="_blank" rel="noreferrer">
              {short(who)} ↗
            </a>
          </div>
          <div className="row">
            <span>${l.symbol}</span>
            <b>{tok(bal.token)}</b>
          </div>
          <div className="row">
            <span>USDC (token account)</span>
            <b>{usdc(bal.usdc, 4)}</b>
          </div>
          {L.lane?.kind === "evm" && (
            <div className="row">
              <span>USDC (gas)</span>
              <span>{(Number(bal.gas) / 1e18).toFixed(4)}</span>
            </div>
          )}
          {L.lane?.kind === "solana" && (bal.token > 0n || bal.usdc > 0n) && (
            <div className="quick" style={{ marginBottom: 0 }}>
              {bal.token > 0n && (
                <button className="btn btn-sm" disabled={S.busy} onClick={() => sweep(l.mintBase58, bal.token, `Move ${tok(bal.token)} $${l.symbol} to ${L.sol?.name}`)}>
                  Move ${l.symbol} to wallet
                </button>
              )}
              {bal.usdc > 0n && (
                <button className="btn btn-sm" disabled={S.busy} onClick={() => sweep(cfg.usdcMint, bal.usdc, `Move ${usdc(bal.usdc, 4)} USDC to ${L.sol?.name}`)}>
                  Move USDC to wallet
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── graduation ────────────────────────────────────────────────────────────

function Graduation({ p, l, onDone }: { p: T.CurveParams; l: T.LaunchView; onDone: () => void }) {
  const L = useLanes();
  const S = useSteps();
  const go = () =>
    S.run(async (step) => {
      if (!L.lane || !TRIUMPH) throw new Error("Connect a wallet first.");
      const tri = TRIUMPH;
      const lane = L.lane;
      if (lane.kind === "solana") await step("Set up your Rome account", () => T.solanaProvision(cfg, L.sol!.signer), (r) => (r ? evmTx(r.hash) : undefined));
      if (!l.vaultReady) await step(`Open a Meteora vault for $${l.symbol}`, () => T.initTokenVault(cfg, lane, tri, l), (r) => evmTx(r.hash));
      const fresh = await T.readLaunch(cfg, tri, l.id);
      await step("Graduate: open the Meteora pool", () => T.graduate(cfg, lane, tri, fresh, p.poolFeeBps), (r) => evmTx(r.hash));
      onDone();
    });

  if (l.status === "Graduated" && l.poolBase58)
    return (
      <div className="surface panel" id="graduation">
        <p className="eyebrow">Graduation</p>
        <h3 style={{ marginTop: 8 }}>Graduated to Meteora</h3>
        <div className="quote" style={{ borderTop: 0, paddingTop: 0 }}>
          <div className="row">
            <span>Pool (Solana)</span>
            <a href={solAddr(l.poolBase58)} target="_blank" rel="noreferrer">
              {short(l.poolBase58)} ↗
            </a>
          </div>
          <div className="row">
            <span>Seeded with</span>
            <b>
              {usdc(p.graduationUsdc)} USDC + {tok(p.lpSupply)} ${l.symbol}
            </b>
          </div>
          <div className="row">
            <span>LP tokens</span>
            <span>Held by the Triumph PDA, no withdraw path</span>
          </div>
        </div>
      </div>
    );

  return (
    <div className="surface panel" id="graduation">
      <h3>Graduation</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        At {usdc(p.graduationUsdc)} USDC raised the curve closes. Anyone can then open a Meteora DAMM v1 pool with {usdc(p.graduationUsdc)} USDC and {tok(p.lpSupply)} $
        {l.symbol}, at the curve's final price.
      </p>
      {l.status === "Completed" ? (
        L.lane ? (
          <button className="btn btn-primary btn-lg btn-block" disabled={S.busy} onClick={go}>
            {S.busy ? "Graduating…" : "Graduate to Meteora"}
          </button>
        ) : (
          <p className="muted">Connect a wallet to trigger graduation. Rent for the pool accounts is paid in gas by whoever triggers it.</p>
        )
      ) : (
        <div className="row">
          <span>Remaining on the curve</span>
          <b>{usdc(p.graduationUsdc - l.raised)} USDC</b>
        </div>
      )}
      <Steps steps={S.steps} error={S.error} />
    </div>
  );
}

// ─── activity ──────────────────────────────────────────────────────────────

function Activity({ id, tick }: { id: number; tick: number }) {
  const [rows, setRows] = useState<TradeEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    loadTrades(id)
      .then((r) => on && (setRows(r), setErr(null)))
      .catch((e) => on && setErr(e?.shortMessage ?? e?.message ?? String(e)));
    return () => {
      on = false;
    };
  }, [id, tick]);
  return (
    <div className="surface panel">
      <h3>Trades</h3>
      {err ? (
        <p className="err-text">{err}</p>
      ) : !rows ? (
        <p className="muted">Reading logs…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No trades yet.</p>
      ) : (
        <div className="acts">
          {rows.map((r) => (
            <div className="act" key={r.hash + r.isBuy}>
              <span className={`side ${r.isBuy ? "b" : "s"}`}>{r.isBuy ? "Buy" : "Sell"}</span>
              <a className="truncate muted" href={evmAddr(r.trader)} target="_blank" rel="noreferrer">
                {short(r.trader)}
              </a>
              <span className="mono">
                {usdc(r.usdc, 4)} USDC · {tok(r.tokens)}
              </span>
              <a className="when dim" href={evmTx(r.hash)} target="_blank" rel="noreferrer">
                tx ↗
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── page ──────────────────────────────────────────────────────────────────

export default function TokenPage({ id, data, back }: { id: number; data: ReturnType<typeof useChainData>; back: () => void }) {
  const fromList = data.launches?.find((x) => x.id === id) ?? null;
  const [l, setL] = useState<T.LaunchView | null>(fromList);
  const [tick, setTick] = useState(0);
  const p = data.params;
  const reload = useCallback(() => {
    if (!TRIUMPH) return;
    T.readLaunch(cfg, TRIUMPH, id).then(setL).catch(() => {});
    data.refresh();
    setTick((t) => t + 1);
  }, [id, data]);
  useEffect(() => {
    if (fromList) setL(fromList);
  }, [fromList]);
  useEffect(() => {
    if (!fromList && TRIUMPH) T.readLaunch(cfg, TRIUMPH, id).then(setL).catch(() => {});
  }, [id, fromList]);

  if (!l || !p)
    return (
      <main className="wrap">
        <button className="btn btn-ghost btn-sm back" onClick={back}>
          ← All launches
        </button>
        {TRIUMPH ? <div className="skeleton" style={{ height: 320 }} /> : <Empty title="Not deployed yet">The contract is not deployed, so there is no launch to show.</Empty>}
      </main>
    );

  const pct = Number(((l.status === "Graduated" ? p.graduationUsdc : l.raised) * 10_000n) / p.graduationUsdc) / 100;
  return (
    <main className="wrap">
      <button className="btn btn-ghost btn-sm back" onClick={back}>
        ← All launches
      </button>
      <div className="t-head">
        <Avatar l={l} big />
        <div style={{ minWidth: 0 }}>
          <p className="eyebrow">Launch #{l.id}</p>
          <h1 className="title-sheen">{l.name}</h1>
          <span className="muted">
            ${l.symbol} · by{" "}
            <a href={evmAddr(l.creator)} target="_blank" rel="noreferrer">
              {short(l.creator)}
            </a>
          </span>
        </div>
        <StatusChip s={l.status} />
        <span className="spacer" />
        <div className="links">
          <a className="badge info pill" href={solAddr(l.mintBase58)} target="_blank" rel="noreferrer">
            SPL mint {short(l.mintBase58, 4, 4)} ↗
          </a>
          {l.wrapper !== "0x0000000000000000000000000000000000000000" && (
            <a className="badge pill" href={evmAddr(l.wrapper)} target="_blank" rel="noreferrer">
              ERC-20 {short(l.wrapper)} ↗
            </a>
          )}
        </div>
      </div>

      <div className="surface lifecycle">
        <Lifecycle s={l.status} />
      </div>

      <div className="t-grid">
        <div style={{ display: "grid", gap: 18, minWidth: 0 }}>
          <div className="surface panel">
            <div className="row" style={{ marginBottom: 8 }}>
              <span>Bonding curve</span>
              <b>{pct.toFixed(1)}% to graduation</b>
            </div>
            <CurveChart p={p} l={l} />
            <div className="kpis">
              <div className="well">
                <span>Price · USDC / 1M</span>
                <b>{l.status === "Graduated" ? "On Meteora" : perM(T.priceOf(p, l)).replace(" USDC / 1M", "")}</b>
              </div>
              <div className="well">
                <span>Raised</span>
                <b>{usdc(l.status === "Graduated" ? p.graduationUsdc : l.raised)} USDC</b>
              </div>
              <div className="well">
                <span>Sold</span>
                <b>{tok(l.status === "Graduated" ? p.curveSupply : l.sold)}</b>
              </div>
              <div className="well">
                <span>Pool reserve</span>
                <b>{tok(p.lpSupply)}</b>
              </div>
            </div>
          </div>
          <Activity id={l.id} tick={tick} />
        </div>
        <div style={{ display: "grid", gap: 18, minWidth: 0 }}>
          <TradePanel p={p} l={l} onDone={reload} />
          <Graduation p={p} l={l} onDone={reload} />
        </div>
      </div>
    </main>
  );
}
