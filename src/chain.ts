// Live chain reads for the UI (no mock data anywhere: an undeployed contract shows empty states).
import { useCallback, useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { cfg, TRIUMPH } from "./config";
import * as T from "../lib/triumph";

export function useChainData() {
  const [params, setParams] = useState<T.CurveParams | null>(null);
  const [launches, setLaunches] = useState<T.LaunchView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    if (!TRIUMPH) {
      setLaunches([]);
      return;
    }
    try {
      const [p, ls] = await Promise.all([params ? Promise.resolve(params) : T.readParams(cfg, TRIUMPH), T.readLaunches(cfg, TRIUMPH)]);
      if (!alive.current) return;
      setParams(p);
      setLaunches(ls);
      setError(null);
    } catch (e: any) {
      if (alive.current) setError(e?.shortMessage ?? e?.message ?? String(e));
    }
  }, [params]);

  useEffect(() => {
    alive.current = true;
    refresh();
    const t = setInterval(refresh, 8000);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [refresh]);

  return { params, launches, error, refresh };
}

export interface TradeEvent {
  id: number;
  trader: Hex;
  isBuy: boolean;
  usdc: bigint;
  tokens: bigint;
  hash: Hex;
  block: bigint;
}

/** Trade events for one launch, newest first. Rome caps eth_getLogs ranges, so page and halve on refusal. */
export async function loadTrades(id: number, maxWindows = 24): Promise<TradeEvent[]> {
  if (!TRIUMPH) return [];
  const pub = T.publicClient(cfg);
  const latest = await pub.getBlockNumber();
  const floor = BigInt(cfg.triumphFromBlock ?? 0);
  let span = 50_000n;
  let to = latest;
  const out: TradeEvent[] = [];
  for (let i = 0; i < maxWindows && to > floor; i++) {
    const from = to - span + 1n > floor ? to - span + 1n : floor;
    try {
      const logs = await pub.getContractEvents({ address: TRIUMPH, abi: T.TRIUMPH_ABI, eventName: "Trade", args: { id: BigInt(id) }, fromBlock: from, toBlock: to });
      for (const l of logs.reverse()) {
        const a = (l as any).args;
        out.push({ id, trader: a.trader, isBuy: a.isBuy, usdc: a.usdc, tokens: a.tokens, hash: l.transactionHash!, block: l.blockNumber! });
      }
      to = from - 1n;
      if (out.length >= 40) break;
    } catch (e: any) {
      if (span <= 500n) throw e;
      span /= 2n;
    }
  }
  return out;
}

// ─── all contract events (Activity page) ─────────────────────────────────────

export type ActivityEvent =
  | { kind: "launch"; id: number; who: Hex; symbol: string; name: string; hash: Hex; block: bigint; logIndex: number }
  | { kind: "buy" | "sell"; id: number; who: Hex; usdc: bigint; tokens: bigint; fee: bigint; hash: Hex; block: bigint; logIndex: number }
  | { kind: "complete"; id: number; raised: bigint; hash: Hex; block: bigint; logIndex: number }
  | { kind: "graduate"; id: number; who: Hex; pool: Hex; usdc: bigint; tokens: bigint; hash: Hex; block: bigint; logIndex: number };

/** Every Triumph event, newest first. One getLogs per window (address filter only), decoded locally. */
export async function loadActivity(maxWindows = 40, limit = 400): Promise<ActivityEvent[]> {
  if (!TRIUMPH) return [];
  const { parseEventLogs } = await import("viem");
  const pub = T.publicClient(cfg);
  const latest = await pub.getBlockNumber();
  const floor = BigInt(cfg.triumphFromBlock ?? 0);
  let span = 50_000n;
  let to = latest;
  const out: ActivityEvent[] = [];
  for (let i = 0; i < maxWindows && to > floor && out.length < limit; i++) {
    const from = to - span + 1n > floor ? to - span + 1n : floor;
    let logs;
    try {
      logs = await pub.getLogs({ address: TRIUMPH, fromBlock: from, toBlock: to });
    } catch (e) {
      if (span <= 500n) throw e;
      span /= 2n;
      continue;
    }
    const parsed = parseEventLogs({ abi: T.TRIUMPH_ABI, logs }) as any[];
    const batch: ActivityEvent[] = [];
    for (const l of parsed) {
      const a = l.args;
      const base = { hash: l.transactionHash as Hex, block: l.blockNumber as bigint, logIndex: Number(l.logIndex) };
      if (l.eventName === "Launched") batch.push({ kind: "launch", id: Number(a.id), who: a.creator, symbol: a.symbol, name: a.name, ...base });
      else if (l.eventName === "Trade") batch.push({ kind: a.isBuy ? "buy" : "sell", id: Number(a.id), who: a.trader, usdc: a.usdc, tokens: a.tokens, fee: a.fee, ...base });
      else if (l.eventName === "CurveCompleted") batch.push({ kind: "complete", id: Number(a.id), raised: BigInt(a.raised), ...base });
      else if (l.eventName === "Graduated") batch.push({ kind: "graduate", id: Number(a.id), who: a.caller, pool: a.pool, usdc: BigInt(a.usdc), tokens: BigInt(a.tokens), ...base });
    }
    batch.sort((x, y) => (x.block === y.block ? y.logIndex - x.logIndex : x.block > y.block ? -1 : 1));
    out.push(...batch);
    to = from - 1n;
  }
  return out;
}

const blockTimes = new Map<bigint, number>();
/** Block timestamps (ms) for the given blocks, cached; at most `cap` lookups per call. */
export async function blockTimesFor(blocks: bigint[], cap = 60): Promise<Map<bigint, number>> {
  const pub = T.publicClient(cfg);
  const need = [...new Set(blocks)].filter((b) => !blockTimes.has(b)).slice(0, cap);
  await Promise.all(
    need.map((b) =>
      pub
        .getBlock({ blockNumber: b })
        .then((blk) => blockTimes.set(b, Number(blk.timestamp) * 1000))
        .catch(() => {}),
    ),
  );
  return blockTimes;
}
