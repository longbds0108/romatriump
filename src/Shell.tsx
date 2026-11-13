// Workspace shell after the Plinths UI skill (PortaldotL site-header.tsx, network-chip.tsx, account-panel.tsx):
// floating header bar (brand · network chip · account control · mobile menu) + collapsible left sidebar.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  ChevronDown,
  Copy,
  ExternalLink,
  LayoutGrid,
  Loader2,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  ShieldCheck,
  Sparkles,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Hex } from "viem";
import { cfg, evmAddr, solAddr, TRIUMPH } from "./config";
import { useLanes } from "./lanes";
import { watchSolanaWallets, type SolWallet } from "./wallets";
import * as T from "../lib/triumph";
import { short } from "./ui";

export type NavKey = "launches" | "activity" | "create" | "how";
type Go = { home: () => void; activity: () => void; launch: () => void; how: () => void };

// ─── brand + small pieces ───────────────────────────────────────────────────

function Brand({ onHome }: { onHome: () => void }) {
  return (
    <button className="brand" onClick={onHome} aria-label="Triumph home">
      <img src="/laurel.svg" alt="" width={30} height={30} />
      <span>Triumph</span>
    </button>
  );
}

/** Deterministic gradient avatar from an address (like the wallet avatar in the account control). */
export function AddrAvatar({ value, size = 24 }: { value: string; size?: number }) {
  const h = [...value].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const a = h % 360;
  const b = (a + 70) % 360;
  return <span className="addr-avatar" style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${a} 70% 72%), hsl(${b} 60% 48%))` }} aria-hidden="true" />;
}

function XIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
function TelegramIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}
const SOCIAL = [
  { href: "https://x.com/Longlhu2Huu", label: "X", icon: XIcon },
  { href: "https://t.me/lebry123", label: "Telegram", icon: TelegramIcon },
];

function useOutside(ref: React.RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const p = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const k = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", p);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("pointerdown", p);
      document.removeEventListener("keydown", k);
    };
  }, [open, ref, close]);
}

// ─── network chip ───────────────────────────────────────────────────────────

/** Rome network pill: logo + status dot. Click adds/switches MetaMask to the chain; disconnected it does nothing harmful. */
function NetworkChip() {
  const L = useLanes();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const status = L.evm ? (L.evmChainId === cfg.chainId ? "ok" : "wrong") : L.sol ? "ok" : "idle";
  const title = failed
    ? "The wallet did not switch network"
    : status === "ok"
      ? `Connected to ${cfg.chainName}`
      : status === "wrong"
        ? `Add / switch MetaMask to ${cfg.chainName}`
        : `${cfg.chainName} · settles on Solana ${cfg.solanaCluster}`;
  useEffect(() => {
    if (!failed) return;
    const t = setTimeout(() => setFailed(false), 2500);
    return () => clearTimeout(t);
  }, [failed]);
  return (
    <button
      type="button"
      className={`net-chip ${status === "wrong" ? "is-wrong" : ""} ${failed ? "is-failed" : ""}`}
      title={title}
      aria-label={`${cfg.chainName}: ${title}`}
      disabled={pending}
      onClick={async () => {
        if (!L.evm) return;
        setPending(true);
        try {
          await L.switchNetwork();
        } catch {
          setFailed(true);
        } finally {
          setPending(false);
        }
      }}
    >
      <span className="net-chip__logo">
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <defs>
            <linearGradient id="rome-g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#e8e3d5" />
              <stop offset="1" stopColor="#6a8ad4" />
            </linearGradient>
          </defs>
          <circle cx="10" cy="10" r="10" fill="url(#rome-g)" />
          <path d="M6.5 14V6h4a2.4 2.4 0 0 1 0 4.8h-4M10 10.8 13.5 14" fill="none" stroke="#100e13" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {pending ? <Loader2 className="net-chip__spin spin" aria-hidden="true" /> : <i className={`net-chip__dot ${failed ? "bad" : status}`} aria-hidden="true" />}
      </span>
      <span className="net-chip__name">{cfg.chainName}</span>
    </button>
  );
}

// ─── account control ────────────────────────────────────────────────────────

function useLaneBalance(kind: "evm" | "solana" | null, address: Hex | null) {
  const [text, setText] = useState("…");
  useEffect(() => {
    if (!address || !kind) return;
    let on = true;
    const read = () =>
      (kind === "evm" ? T.nativeBalance(cfg, address).then((w) => w / 10n ** 12n) : T.splBalance(cfg, address, T.usdcMintHex(cfg)))
        .then((u6) => on && setText(`${(Number(u6) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })} USDC`))
        .catch(() => on && setText("—"));
    read();
    const t = setInterval(read, 15_000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [kind, address]);
  return text;
}

function SolanaWalletList({ onPick }: { onPick: (w: SolWallet) => void }) {
  const [wallets, setWallets] = useState<SolWallet[]>([]);
  useEffect(() => watchSolanaWallets(setWallets), []);
  if (!wallets.length) return <p className="acct-note">No Solana wallet detected. Install Solflare, Phantom or Backpack.</p>;
  return (
    <>
      {wallets.map((w) => (
        <button key={w.name} className="acct-option" onClick={() => onPick(w)}>
          <img src={w.icon} alt="" />
          <span>
            {w.name}
            <small>Solana lane</small>
          </span>
        </button>
      ))}
    </>
  );
}

function ConnectOptions({ onDone }: { onDone: () => void }) {
  const L = useLanes();
  const [err, setErr] = useState<string | null>(null);
  const run = (p: Promise<void>) => p.then(onDone, (e) => setErr(e?.message ?? String(e)));
  return (
    <div className="acct-options">
      <p className="eyebrow">EVM lane</p>
      <button className="acct-option" onClick={() => run(L.connectEvm())} disabled={!!L.evm}>
        <span className="mm-logo" aria-hidden="true" />
        <span>
          MetaMask
          <small>{L.evm ? `Connected · ${short(L.evm.address)}` : "Any injected EVM wallet"}</small>
        </span>
      </button>
      <p className="eyebrow" style={{ marginTop: 10 }}>
        Solana lane
      </p>
      {L.sol ? (
        <p className="acct-note">Connected · {L.sol.name}</p>
      ) : (
        <SolanaWalletList onPick={(w) => run(L.connectSol(w))} />
      )}
      <p className="acct-note">Rome's Solana lane signs Solana v1 transactions. On devnet today Solflare supports them; Phantom support is pending.</p>
      {err && <p className="err-text">{err}</p>}
    </div>
  );
}

function LaneRow({ kind }: { kind: "evm" | "solana" }) {
  const L = useLanes();
  const connected = kind === "evm" ? L.evm : L.sol;
  const address = kind === "evm" ? L.evm?.address : L.sol ? T.solanaLane(cfg, L.sol.signer).address : undefined;
  const [copied, setCopied] = useState(false);
  if (!connected || !address) return null;
  const isActive = L.active === kind;
  return (
    <div className={`well lane-row ${isActive ? "is-active" : ""}`}>
      <div className="lane-row__top">
        {kind === "evm" ? <span className="mm-logo" aria-hidden="true" /> : <img src={L.sol!.icon} alt="" className="lane-row__icon" />}
        <div className="lane-row__who">
          <b>{kind === "evm" ? "MetaMask" : L.sol!.name}</b>
          <small>{kind === "evm" ? "EVM lane" : `Solana lane · ${short(L.sol!.publicKey.toBase58(), 4, 4)}`}</small>
        </div>
        {isActive ? (
          <span className="badge success">
            <i className="dot" />
            Active
          </span>
        ) : (
          <button className="btn btn-sm" onClick={() => L.setActive(kind)}>
            Use
          </button>
        )}
      </div>
      <div className="lane-row__addr">
        <span className="mono" title={address}>
          {short(address, 8, 6)}
        </span>
        <button
          className="icon-btn"
          aria-label="Copy address"
          title={copied ? "Copied" : "Copy address"}
          onClick={() => navigator.clipboard?.writeText(address).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1200)))}
        >
          <Copy />
        </button>
        <a className="icon-btn" href={kind === "evm" ? evmAddr(address) : solAddr(L.sol!.publicKey.toBase58())} target="_blank" rel="noreferrer" aria-label="Open in explorer" title="Open in explorer">
          <ExternalLink />
        </a>
        <button className="icon-btn" aria-label="Disconnect" title="Disconnect" onClick={() => L.disconnect(kind)}>
          <LogOut />
        </button>
      </div>
      {kind === "solana" && <p className="acct-note">Rome address (synthetic) the contract sees for this wallet.</p>}
    </div>
  );
}

function AccountMenu() {
  const L = useLanes();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
  useOutside(root, open, () => (setOpen(false), setAdding(false)));
  const balance = useLaneBalance(L.active, L.lane?.address ?? null);
  const connectedAny = !!(L.evm || L.sol);

  if (!connectedAny)
    return (
      <div className="acct" ref={root}>
        <button className="btn btn-primary btn-sm" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          Connect wallet
        </button>
        {open && (
          <div className="acct-panel" role="dialog" aria-label="Connect a wallet" id={panelId}>
            <p className="acct-panel__title">Connect a wallet</p>
            <ConnectOptions onDone={() => setOpen(false)} />
          </div>
        )}
      </div>
    );

  const addr = L.lane?.address ?? "";
  return (
    <div className="acct" ref={root}>
      <div className="acct-box">
        <span className="acct-box__bal">{balance}</span>
        <button className="acct-box__trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} aria-label="Account and wallets" onClick={() => setOpen((o) => !o)}>
          {L.active === "solana" && L.sol?.icon ? <img src={L.sol.icon} alt="" className="acct-box__icon" /> : <AddrAvatar value={addr} />}
          <span className="acct-box__addr mono">{short(addr)}</span>
          <ChevronDown className={`acct-box__chev ${open ? "is-open" : ""}`} />
        </button>
      </div>
      {open && (
        <div className="acct-panel" role="dialog" aria-label="Account and wallets" id={panelId}>
          <div className="acct-panel__head">
            <p className="acct-panel__title">Wallets</p>
            <button className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}>
              <X />
            </button>
          </div>
          <p className="acct-note" style={{ marginTop: 0 }}>
            Trades and launches are signed by the <b>active</b> lane. Both lanes act on the same contract.
          </p>
          <div className="lane-rows">
            <LaneRow kind="evm" />
            <LaneRow kind="solana" />
          </div>
          {!(L.evm && L.sol) &&
            (adding ? (
              <ConnectOptions onDone={() => setAdding(false)} />
            ) : (
              <button className="btn btn-sm btn-block" onClick={() => setAdding(true)}>
                <Plus /> Connect {L.evm ? "a Solana wallet" : "MetaMask"}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

// ─── navigation ─────────────────────────────────────────────────────────────

interface NavLink {
  key: string;
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
  href?: string;
}

function NavSections({ current, items, onchain, collapsed, onNavigate }: { current: NavKey | null; items: NavLink[]; onchain: NavLink[]; collapsed: boolean; onNavigate?: () => void }) {
  const item = (n: NavLink) => {
    const Icon = n.icon;
    const body = (
      <>
        <Icon className="nav-item__icon" aria-hidden="true" />
        {!collapsed && <span className="nav-item__label">{n.label}</span>}
      </>
    );
    return n.href ? (
      <a key={n.key} className="nav-item" href={n.href} target="_blank" rel="noreferrer" aria-label={n.label} title={collapsed ? n.label : undefined} onClick={onNavigate}>
        {body}
      </a>
    ) : (
      <button
        key={n.key}
        className="nav-item"
        aria-current={current === n.key ? "page" : undefined}
        aria-label={n.label}
        title={collapsed ? n.label : undefined}
        onClick={() => (n.onClick?.(), onNavigate?.())}
      >
        {body}
      </button>
    );
  };
  return (
    <>
      <div className="nav-section">{items.map(item)}</div>
      <div className="nav-section nav-section--rule">
        {!collapsed && (
          <p className="eyebrow nav-section__label">
            <ShieldCheck aria-hidden="true" /> On-chain
          </p>
        )}
        {onchain.map(item)}
      </div>
    </>
  );
}

function useNav(go: Go) {
  const items: NavLink[] = [
    { key: "launches", label: "Launches", icon: LayoutGrid, onClick: go.home },
    { key: "activity", label: "Activity", icon: Activity, onClick: go.activity },
    { key: "create", label: "Start a launch", icon: Sparkles, onClick: go.launch },
    { key: "how", label: "How it works", icon: Workflow, onClick: go.how },
  ];
  const onchain: NavLink[] = [
    ...(TRIUMPH ? [{ key: "contract", label: "Triumph contract", icon: ExternalLink, href: evmAddr(TRIUMPH) }] : []),
    { key: "meteora", label: "Meteora DAMM v1", icon: ExternalLink, href: solAddr(cfg.programs.meteoraDammV1) },
    { key: "explorer", label: `${cfg.chainName} explorer`, icon: ExternalLink, href: cfg.explorerUrl },
  ];
  return { items, onchain };
}

function Socials() {
  return (
    <>
      {SOCIAL.map((s) => {
        const Icon = s.icon;
        return (
          <a key={s.href} className="social-item" href={s.href} target="_blank" rel="noreferrer" aria-label={`${s.label} (opens in a new tab)`} title={s.label}>
            <Icon />
          </a>
        );
      })}
    </>
  );
}

// ─── header + sidebar ───────────────────────────────────────────────────────

export function SiteHeader({ current, go }: { current: NavKey | null; go: Go }) {
  const [open, setOpen] = useState(false);
  const nav = useNav(go);
  return (
    <header className="site-header">
      <div className="bar">
        <Brand onHome={go.home} />
        <div className="bar__right">
          <NetworkChip />
          <AccountMenu />
          <button className="menu-toggle" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen((o) => !o)}>
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </div>
      {open && (
        <nav id="mobile-nav" className="mobile-nav" aria-label="Menu">
          <div className="mobile-nav__body">
            <NavSections current={current} items={nav.items} onchain={nav.onchain} collapsed={false} onNavigate={() => setOpen(false)} />
          </div>
          <div className="mobile-nav__social">
            <Socials />
          </div>
        </nav>
      )}
    </header>
  );
}

const SIDEBAR_KEY = "triumph.sidebar";

export function SiteSidebar({ current, go }: { current: NavKey | null; go: Go }) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "1";
    } catch {
      return false;
    }
  });
  const nav = useNav(go);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
    } catch {
      /* per-viewer convenience only */
    }
  };
  const Toggle = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <aside className={`sidebar ${collapsed ? "is-collapsed" : ""}`} aria-label="Workspace">
      <div className="sidebar__head">
        {!collapsed && <span className="eyebrow sidebar__label">Workspace</span>}
        <button className="sidebar__toggle" onClick={toggle} aria-expanded={!collapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          <Toggle />
        </button>
      </div>
      <nav className="sidebar__nav">
        <NavSections current={current} items={nav.items} onchain={nav.onchain} collapsed={collapsed} />
      </nav>
      <div className="sidebar__social">
        <Socials />
      </div>
    </aside>
  );
}

export function Shell({ current, go, children }: { current: NavKey | null; go: Go; children: ReactNode }) {
  return (
    <>
      <SiteHeader current={current} go={go} />
      <div className="shell">
        <SiteSidebar current={current} go={go} />
        <div className="shell__main">{children}</div>
      </div>
    </>
  );
}
