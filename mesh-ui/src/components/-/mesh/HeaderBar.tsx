import { Copy, Plus, LogOut } from "lucide-react";
import { useState, useEffect } from "react";
import { useMesh } from "@/context/MeshContext";

function MeshLogo({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
    >
      <path d="M5 5 L19 5 M5 5 L12 12 M19 5 L12 12 M5 5 L5 19 M19 5 L19 19 M12 12 L5 19 M12 12 L19 19 M5 19 L19 19" opacity="0.55" />
      {([[5, 5], [19, 5], [12, 12], [5, 19], [19, 19]] as [number, number][]).map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={1.6} fill="currentColor" stroke="none" />
      ))}
    </svg>
  );
}

function StatusDot({ active = false }: { active?: boolean }) {
  if (active) {
    return (
      <span className="relative inline-flex h-1.5 w-1.5">
        <span className="absolute inset-0 rounded-full bg-status-green opacity-70 animate-status-pulse" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-status-green" />
      </span>
    );
  }
  return <span className="inline-block h-1.5 w-1.5 rounded-full bg-status-grey" />;
}

function useDuration(startedAt: number | null): string {
  const [elapsed, setElapsed] = useState("0m");

  useEffect(() => {
    if (!startedAt) return;
    const update = () => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      setElapsed(h > 0 ? `${h}h ${m}m` : `${m}m`);
    };
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [startedAt]);

  return elapsed;
}

export function HeaderBar() {
  const { credentials, sessions, sessionStartedAt, disconnect } = useMesh();
  const [copied, setCopied] = useState(false);
  const duration = useDuration(sessionStartedAt);

  const activeCount = sessions.filter((s) => s.ws_connected).length;
  const totalCount = sessions.length;

  function copyInvite() {
    if (!credentials?.inviteCode) return;
    navigator.clipboard.writeText(credentials.inviteCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <header className="shrink-0 flex items-center justify-between border-b border-border bg-surface px-4 h-[52px]">
      {/* Left */}
      <div className="flex items-center gap-2.5">
        <MeshLogo className="h-5 w-5 text-foreground/85" />
        <span className="text-[13px] tracking-wide text-foreground/90 font-sans-ui">Mesh</span>
      </div>

      {/* Center */}
      <div className="flex items-center gap-3 text-[12.5px]">
        <span className="font-sans-ui font-semibold text-foreground/95">
          {credentials?.projectName ?? "—"}
        </span>
        {credentials?.inviteCode && (
          <>
            <span className="text-subtle">/</span>
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-sm border border-border bg-background/60">
              <span className="text-muted-foreground">invite</span>
              <span className="text-muted-foreground">{credentials.inviteCode}</span>
              <button
                type="button"
                aria-label="Copy invite code"
                onClick={copyInvite}
                className="text-subtle hover:text-foreground transition-colors"
              >
                <Copy className="h-3 w-3" />
              </button>
              {copied && (
                <span className="text-[10px] text-status-green">copied</span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Right */}
      <div className="flex items-center gap-3 text-[12px]">
        <div className="flex items-center gap-1.5">
          {sessions.map((s) => (
            <StatusDot key={s.session_id} active={s.ws_connected} />
          ))}
          {totalCount === 0 && <StatusDot active={false} />}
          <span className="text-muted-foreground ml-1.5">
            {activeCount}/{totalCount} agents
          </span>
        </div>
        <div className="px-2 py-0.5 rounded-sm border border-border bg-background/60 text-foreground/85 tabular-nums">
          {duration}
        </div>
        <button
          type="button"
          title="Disconnect"
          onClick={disconnect}
          className="flex items-center gap-1.5 px-2 py-1 rounded-sm border border-border text-foreground/80 hover:bg-surface-2 hover:text-foreground transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span>disconnect</span>
        </button>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(credentials?.inviteCode ?? "");
          }}
          className="flex items-center gap-1.5 px-2 py-1 rounded-sm border border-border text-foreground/80 hover:bg-surface-2 hover:text-foreground transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>invite</span>
        </button>
      </div>
    </header>
  );
}
