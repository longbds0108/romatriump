import { useCallback, useState, type ReactNode } from "react";
import { formatUnits } from "viem";
import type { LaunchView, Status } from "../lib/triumph";

export const usdc = (x: bigint, dp = 2) => Number(formatUnits(x, 6)).toLocaleString("en-US", { maximumFractionDigits: dp, minimumFractionDigits: Math.min(dp, 2) });
export const tok = (x: bigint) => {
  const n = Number(formatUnits(x, 6));
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
};
export const price = (p: number) => (p === 0 ? "0" : p < 0.0001 ? p.toExponential(3) : p.toPrecision(4));
/** Price per million tokens: supply is 1B, so a per-token price is too small to read. */
export const perM = (pricePerToken: number) => {
  const v = pricePerToken * 1e6;
  return `${v === 0 ? "0" : v < 0.01 ? v.toPrecision(3) : v.toLocaleString("en-US", { maximumFractionDigits: 4 })} USDC / 1M`;
};
export const short = (s: string, a = 6, b = 4) => (s.length > a + b + 1 ? `${s.slice(0, a)}…${s.slice(-b)}` : s);

export function parseAmount(s: string): bigint | null {
  const t = s.trim();
  if (!/^\d*(\.\d{0,6})?$/.test(t) || t === "" || t === ".") return null;
  const [i, f = ""] = t.split(".");
  return BigInt(i || "0") * 1_000_000n + BigInt((f + "000000").slice(0, 6));
}

// Plinths palette: cream, soft blue, violet, teal.
const PALETTES = [
  ["#f3efe5", "#cfc6b0"],
  ["#c3d6ff", "#6a8ad4"],
  ["#d3c4ff", "#9576ea"],
  ["#a8ece4", "#4fd1c5"],
  ["#e8e3d5", "#83aaff"],
  ["#cfe2ff", "#9576ea"],
];

export function Avatar({ l, big }: { l: Pick<LaunchView, "symbol" | "mint">; big?: boolean }) {
  const n = parseInt(l.mint.slice(2, 6), 16) % PALETTES.length;
  const [a, b] = PALETTES[n];
  return (
    <span className="avatar" style={{ background: `linear-gradient(135deg, ${a}, ${b})`, ...(big ? { width: 56, height: 56 } : {}) }}>
      {l.symbol.slice(0, 3)}
    </span>
  );
}

export function StatusChip({ s }: { s: Status }) {
  const label = s === "Trading" ? "On the curve" : s === "Completed" ? "Ready to graduate" : s === "Graduated" ? "Graduated · Meteora" : s;
  const tone = s === "Trading" ? "info" : s === "Completed" ? "warning" : s === "Graduated" ? "success" : "muted";
  return (
    <span className={`badge ${tone}`}>
      <i className="dot" />
      {label}
    </span>
  );
}

export type StepState = "run" | "ok" | "err" | "skip";
export interface Step {
  label: string;
  state: StepState;
  href?: string;
  note?: string;
}

/** Runs a multi-transaction flow and records each step with its explorer link. */
export function useSteps() {
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (flow: (step: <R>(label: string, fn: () => Promise<R>, link?: (r: R) => string | undefined) => Promise<R>) => Promise<void>) => {
    setSteps([]);
    setError(null);
    setBusy(true);
    const step = async <R,>(label: string, fn: () => Promise<R>, link?: (r: R) => string | undefined) => {
      const idx = { i: -1 };
      setSteps((s) => {
        idx.i = s.length;
        return [...s, { label, state: "run" }];
      });
      try {
        const r = await fn();
        setSteps((s) => s.map((x, i) => (i === idx.i ? { ...x, state: r === null ? "skip" : "ok", href: r === null ? undefined : link?.(r), note: r === null ? "already done" : undefined } : x)));
        return r;
      } catch (e) {
        setSteps((s) => s.map((x, i) => (i === idx.i ? { ...x, state: "err" } : x)));
        throw e;
      }
    };
    try {
      await flow(step);
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.details ?? e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return { steps, busy, error, run, clear: () => (setSteps([]), setError(null)) };
}

export function Steps({ steps, error }: { steps: Step[]; error: string | null }) {
  if (!steps.length && !error) return null;
  return (
    <>
      <div className="steps">
        {steps.map((s, i) => (
          <div className="well step" key={i}>
            <span className={`s ${s.state === "skip" ? "ok" : s.state}`} />
            <span className="truncate">{s.label}</span>
            {s.href ? (
              <a href={s.href} target="_blank" rel="noreferrer">
                tx ↗
              </a>
            ) : (
              <span className="dim">{s.note ?? ""}</span>
            )}
          </div>
        ))}
      </div>
      {error && <p className="err-text">{error}</p>}
    </>
  );
}

export function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="surface modal" role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}

/** Plinths empty state: dashed well with a glowing orb. */
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-orb" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z" />
        </svg>
      </span>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

/** Launch lifecycle (Plinths stepper): done steps filled, the live step ringed. */
export function Lifecycle({ s }: { s: Status }) {
  const steps = [
    { label: "Launched", sub: "SPL mint created, supply fixed" },
    { label: "On the curve", sub: "buy and sell in USDC" },
    { label: "Curve complete", sub: "trading halted" },
    { label: "Graduated", sub: "Meteora pool, LP locked" },
  ];
  // index of the step in progress; 4 = everything done
  const live = s === "Trading" ? 1 : s === "Completed" ? 3 : s === "Graduated" ? 4 : 0;
  return (
    <ol className="stepper">
      {steps.map((x, i) => {
        const cls = i < live || (s === "Completed" && i === 2) ? "done" : i === live ? "current" : "";
        return (
          <li key={x.label} className={cls}>
            <span className="n">{cls === "done" ? "✓" : i + 1}</span>
            <div>
              <p>{x.label}</p>
              <small>{x.sub}</small>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
