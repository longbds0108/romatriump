// Activity: every launch, trade, curve completion and graduation, read from Triumph's events.
// Layout follows the PortaldotL dashboard (KPI row · activity columns + meters · my activity · full feed).
import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Flag, GraduationCap, Rocket, type LucideIcon } from "lucide-react";
import type { Hex } from "viem";
import { cfg, evmAddr, evmTx, TRIUMPH } from "./config";
import { useLanes } from "./lanes";
import { blockTimesFor, loadActivity, type ActivityEvent, type useChainData } from "./chain";
import { bytes32ToPubkey } from "../lib/meteora";
import * as T from "../lib/triumph";
import { Empty, short, tok, usdc } from "./ui";

type Filter = "all" | "launch" | "buy" | "sell" | "graduate";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "launch", label: "Launches" },
  { key: "buy", label: "Buys" },
  { key: "sell", label: "Sells" },
  { key: "graduate", label: "Graduations" },
];

const STATUS_COLOR: Record<string, string> = { Trading: "#83aaff", Completed: "#e8b54c", Graduated: "#4fd1c5" };

function timeAgo(ms: number | undefined) {
  if (!ms) return "";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: "blue" | "teal" | "amber" | "cream" }) {
  return (
    <div className={`surface stat kpi kpi--${tone}`}>
      <span>{label}</span>
      <b>{value}</b>
      <small>{hint}</small>
    </div>
  );
}

function Panel({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="surface panel">
      <div className="panel__head">
        <h3>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** One pill per launch, height = USDC traded. Hover shows the launch's figures (PortaldotL BidColumns). */
function VolumeColumns({ cols, open }: { cols: { id: number; symbol: string; volume: bigint; trades: number; status: string }[]; open: (id: number) => void }) {
  const max = cols.reduce((m, c) => (c.volume > m ? c.volume : m), 1n);
  const busiest = cols.reduce((b, c, i) => (c.volume > cols[b].volume ? i : b), 0);
  const [hover, setHover] = useState<number>();
  const a = cols[hover ?? busiest];
  return (
    <div className="vcols">
      <div className="vcols__bars" onMouseLeave={() => setHover(undefined)}>
        {cols.map((c, i) => {
          const h = c.volume === 0n ? 0 : Math.max(14, Number((c.volume * 100n) / max));
          const shown = i === (hover ?? busiest);
          return (
            <button
              key={c.id}
              className="vcol"
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onClick={() => open(c.id)}
              aria-label={`$${c.symbol}: ${usdc(c.volume)} USDC traded in ${c.trades} trades`}
            >
              <span className={`vcol__tip ${shown ? "is-on" : ""}`}>{usdc(c.volume, 1)}</span>
              <span className="vcol__track">
                {h === 0 ? <span className="vcol__empty" /> : <span className={`vcol__fill ${shown ? "is-on" : ""}`} style={{ height: `${h}%`, background: STATUS_COLOR[c.status] ?? "#9b949f" }} />}
              </span>
              <span className={`vcol__label ${shown ? "is-on" : ""}`}>${c.symbol.slice(0, 5)}</span>
            </button>
          );
        })}
      </div>
      {a && (
        <p className="well vcols__note">
          <i style={{ background: STATUS_COLOR[a.status] }} />
          <b>${a.symbol}</b>
          <span>·</span>
          <span>
            {usdc(a.volume)} USDC in {a.trades} trade{a.trades === 1 ? "" : "s"}
          </span>
          <span>·</span>
          <span>{a.status === "Trading" ? "On the curve" : a.status === "Completed" ? "Ready to graduate" : "Graduated"}</span>
        </p>
      )}
      <div className="legend">
        {Object.entries(STATUS_COLOR).map(([k, c]) => (
          <span key={k}>
            <i style={{ background: c }} />
            {k === "Trading" ? "On the curve" : k === "Completed" ? "Ready" : "Graduated"}
          </span>
        ))}
      </div>
    </div>
  );
}

function Meter({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total ? Math.round((count / total) * 100) : 0;
  return (
    <div className="meter">
      <div className="meter__top">
        <span>{label}</span>
        <span className="mono muted">
          {count} · {pct}%
        </span>
      </div>
      <div className="meter__track">
        <i style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

const ICON: Record<ActivityEvent["kind"], LucideIcon> = { launch: Rocket, buy: ArrowUpRight, sell: ArrowDownRight, complete: Flag, graduate: GraduationCap };

function describe(e: ActivityEvent, sym: (id: number) => string) {
  const s = `$${sym(e.id)}`;
  switch (e.kind) {
    case "launch":
      return { title: `Launched ${s}`, sub: e.name, tone: "cream" };
    case "buy":
      return { title: `Bought ${tok(e.tokens)} ${s}`, sub: `${usdc(e.usdc, 4)} USDC`, tone: "teal" };
    case "sell":
      return { title: `Sold ${tok(e.tokens)} ${s}`, sub: `${usdc(e.usdc, 4)} USDC`, tone: "red" };
    case "complete":
      return { title: `${s} curve complete`, sub: `${usdc(e.raised)} USDC raised · trading halted`, tone: "amber" };
    case "graduate":
      return { title: `${s} graduated to Meteora`, sub: `Pool ${short(bytes32ToPubkey(e.pool).toBase58(), 4, 4)} · ${usdc(e.usdc)} USDC + ${tok(e.tokens)}`, tone: "blue" };
  }
}

function EventRow({ e, sym, time, open, mine }: { e: ActivityEvent; sym: (id: number) => string; time?: number; open: (id: number) => void; mine?: boolean }) {
  const d = describe(e, sym);
  const Icon = ICON[e.kind];
  const who = "who" in e ? e.who : null;
  return (
    <li className="ev">
      <button className="ev__main" onClick={() => open(e.id)}>
        <span className={`ev__icon tone-${d.tone}`}>
          <Icon />
        </span>
        <span className="ev__text">
          <span className="ev__title truncate">{d.title}</span>
          <span className="ev__sub truncate">
            #{e.id} · {d.sub}
            {who && !mine ? ` · ${short(who)}` : ""}
          </span>
        </span>
      </button>
      <span className="ev__meta">
        <span className="muted">{timeAgo(time)}</span>
        <a href={evmTx(e.hash)} target="_blank" rel="noreferrer" aria-label="Transaction on explorer">
          tx ↗
        </a>
      </span>
    </li>
  );
}

export default function ActivityPage({ data, open, onLaunch }: { data: ReturnType<typeof useChainData>; open: (id: number) => void; onLaunch: () => void }) {
  const L = useLanes();
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [times, setTimes] = useState<Map<bigint, number>>(new Map());
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(25);

  useEffect(() => {
    let on = true;
    const load = () =>
      loadActivity()
        .then(async (ev) => {
          if (!on) return;
          setEvents(ev);
          setErr(null);
          const t = await blockTimesFor(ev.slice(0, 60).map((x) => x.block));
          if (on) setTimes(new Map(t));
        })
        .catch((e) => on && setErr(e?.shortMessage ?? e?.message ?? String(e)));
    load();
    const t = setInterval(load, 15_000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, []);

  const launches = data.launches ?? [];
  const sym = (id: number) => launches.find((l) => l.id === id)?.symbol ?? String(id);
  const ev = events ?? [];

  const stats = useMemo(() => {
    const trades = ev.filter((e): e is Extract<ActivityEvent, { kind: "buy" | "sell" }> => e.kind === "buy" || e.kind === "sell");
    const volume = trades.reduce((n, e) => n + e.usdc, 0n);
    const fees = trades.reduce((n, e) => n + e.fee, 0n);
    const traders = new Set(trades.map((e) => e.who.toLowerCase())).size;
    const buys = trades.filter((e) => e.kind === "buy").length;
    const perLaunch = launches
      .slice()
      .reverse()
      .map((l) => {
        const t = trades.filter((e) => e.id === l.id);
        return { id: l.id, symbol: l.symbol, volume: t.reduce((n, e) => n + e.usdc, 0n), trades: t.length, status: l.status };
      })
      .slice(-12);
    return { trades: trades.length, volume, fees, traders, buys, perLaunch };
  }, [ev, launches]);

  const mine = useMemo(() => {
    const addrs = new Set<string>();
    if (L.evm) addrs.add(L.evm.address.toLowerCase());
    if (L.sol) addrs.add(T.solanaLane(cfg, L.sol.signer).address.toLowerCase());
    return { addrs, list: ev.filter((e) => "who" in e && addrs.has((e.who as Hex).toLowerCase())) };
  }, [ev, L.evm, L.sol]);

  const feed = ev.filter((e) => filter === "all" || e.kind === filter || (filter === "graduate" && e.kind === "complete"));
  const ready = events !== null;
  const byStatus = (s: string) => launches.filter((l) => l.status === s).length;

  return (
    <main className="wrap">
      <header className="page-head">
        <p className="eyebrow">Triumph · {cfg.chainName}</p>
        <h1 className="title-sheen">Activity</h1>
        <p className="page-head__intro">Every launch, trade, curve completion and graduation, read straight from the contract's events. Nothing here is cached off-chain.</p>
      </header>

      {!TRIUMPH ? (
        <Empty title="Not deployed yet">The Triumph contract has no address on {cfg.chainName}, so there is no on-chain activity to read.</Empty>
      ) : (
        <>
          {err && <p className="well banner">Couldn't read events: {err}</p>}
          <section className="kpi-row">
            <Kpi tone="blue" label="Trades" value={ready ? String(stats.trades) : "…"} hint={ready ? `${stats.buys} buys · ${stats.trades - stats.buys} sells` : "Reading the chain…"} />
            <Kpi tone="teal" label="Volume" value={ready ? `${usdc(stats.volume)}` : "…"} hint="USDC across all curves" />
            <Kpi tone="amber" label="Traders" value={ready ? String(stats.traders) : "…"} hint="distinct Rome addresses" />
            <Kpi tone="cream" label="Fees" value={ready ? usdc(stats.fees, 4) : "…"} hint="USDC, 1% of curve trades" />
          </section>

          <section className="act-grid">
            <Panel title="Trade activity" aside={<span className="muted small">USDC traded per launch · latest {stats.perLaunch.length || ""}</span>}>
              {!ready || !data.launches ? (
                <div className="skeleton" style={{ height: 230 }} />
              ) : stats.perLaunch.length === 0 ? (
                <Empty title="No launches yet">Volume per launch shows here once tokens are launched and traded.</Empty>
              ) : (
                <VolumeColumns cols={stats.perLaunch} open={open} />
              )}
            </Panel>
            <Panel title="Launches by stage">
              {!data.launches ? (
                <div className="skeleton" style={{ height: 200 }} />
              ) : (
                <div className="meters">
                  <Meter label="On the curve" count={byStatus("Trading")} total={launches.length} color={STATUS_COLOR.Trading} />
                  <Meter label="Ready to graduate" count={byStatus("Completed")} total={launches.length} color={STATUS_COLOR.Completed} />
                  <Meter label="Graduated to Meteora" count={byStatus("Graduated")} total={launches.length} color={STATUS_COLOR.Graduated} />
                  <p className="muted small">Shares of all {launches.length} launches, by contract status.</p>
                </div>
              )}
            </Panel>
          </section>

          <section className="act-grid act-grid--b">
            <Panel
              title="My activity"
              aside={
                (L.evm || L.sol) && (
                  <button className="btn btn-sm" onClick={onLaunch}>
                    + New launch
                  </button>
                )
              }
            >
              {!(L.evm || L.sol) ? (
                <Empty title="No wallet connected">Connect MetaMask or a Solana wallet to list its launches, trades and graduations.</Empty>
              ) : !ready ? (
                <div className="skeleton" style={{ height: 180 }} />
              ) : mine.list.length === 0 ? (
                <Empty title="Nothing from this wallet yet">Launches, trades and graduations you sign show up here.</Empty>
              ) : (
                <ul className="evs">
                  {mine.list.slice(0, 8).map((e) => (
                    <EventRow key={`${e.hash}-${e.logIndex}`} e={e} sym={sym} time={times.get(e.block)} open={open} mine />
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              title="All events"
              aside={
                <div className="segmented" role="tablist" aria-label="Filter events">
                  {FILTERS.map((f) => (
                    <button key={f.key} role="tab" aria-selected={filter === f.key} onClick={() => (setFilter(f.key), setShown(25))}>
                      {f.label}
                    </button>
                  ))}
                </div>
              }
            >
              {!ready ? (
                <div className="skeleton" style={{ height: 320 }} />
              ) : feed.length === 0 ? (
                <Empty title={ev.length ? "Nothing in this filter" : "No events yet"}>{ev.length ? "Try another filter." : "The first launch will appear here."}</Empty>
              ) : (
                <>
                  <ul className="evs">
                    {feed.slice(0, shown).map((e) => (
                      <EventRow key={`${e.hash}-${e.logIndex}`} e={e} sym={sym} time={times.get(e.block)} open={open} />
                    ))}
                  </ul>
                  {feed.length > shown && (
                    <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => setShown((n) => n + 25)}>
                      Show more
                    </button>
                  )}
                  <p className="muted small" style={{ marginTop: 12 }}>
                    Times come from Rome block timestamps, shown relative to your clock.{" "}
                    <a href={evmAddr(TRIUMPH)} target="_blank" rel="noreferrer">
                      Contract on explorer ↗
                    </a>
                  </p>
                </>
              )}
            </Panel>
          </section>
        </>
      )}
    </main>
  );
}
