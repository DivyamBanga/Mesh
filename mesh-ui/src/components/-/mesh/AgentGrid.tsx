import { useMesh } from "@/context/MeshContext";
import type { SessionSummary } from "@/lib/mesh-api";

type AgentStatus = "working" | "thinking" | "waiting" | "idle";

function StatusDot({ status }: { status: AgentStatus }) {
  if (status === "working") {
    return (
      <span className="relative inline-flex h-2 w-2">
        <span className="absolute inset-0 rounded-full bg-status-green opacity-70 animate-status-pulse" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-status-green" />
      </span>
    );
  }
  return <span className="inline-flex h-2 w-2 rounded-full bg-status-grey" />;
}

function initials(name: string): string {
  return name
    .split(/[\s\-_]/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function AgentCard({
  session,
  lockCount,
}: {
  session: SessionSummary;
  lockCount: number;
}) {
  const status = session.ws_connected ? session.status : "idle";
  const accentBar = status === "working" ? "bg-status-green/70" : "bg-border";

  return (
    <div className="relative flex flex-col border rounded-sm overflow-hidden bg-surface-2 border-border">
      <div className={`h-[2px] w-full ${accentBar}`} />
      <div className="p-3 flex flex-col gap-2.5">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-full bg-surface-3 border border-border flex items-center justify-center text-[11px] font-semibold text-foreground/90 font-sans-ui shrink-0">
            {initials(session.developer_name)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-medium text-foreground font-sans-ui truncate">
                {session.developer_name}
              </span>
              {!session.ws_connected && (
                <span className="px-1.5 py-[1px] text-[9px] tracking-widest rounded-sm bg-surface-3 text-foreground/50 border border-border">
                  OFFLINE
                </span>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground truncate">{session.branch}</div>
          </div>
          <StatusDot status={status as AgentStatus} />
        </div>

        <p className="text-[11.5px] leading-snug text-foreground/75 line-clamp-2 min-h-[2.5em]">
          {session.current_task || (session.ws_connected ? "Awaiting task…" : "Disconnected")}
        </p>

        <div className="flex items-center gap-3 text-[10.5px] text-muted-foreground pt-1 border-t border-border">
          <span>{lockCount} locks</span>
          <span className="text-subtle">·</span>
          <span className={status === "working" ? "text-status-green" : "text-subtle"}>
            {status}
          </span>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
      <span className="text-[12px]">No agents connected</span>
      <span className="text-[11px] text-subtle">Waiting for MCP plugin connections…</span>
    </div>
  );
}

export function AgentGrid() {
  const { sessions, fileLocks } = useMesh();

  const locksBySession: Record<string, number> = {};
  for (const lock of fileLocks) {
    locksBySession[lock.session_id] = (locksBySession[lock.session_id] ?? 0) + 1;
  }

  return (
    <div className="h-full w-full bg-background p-3 overflow-y-auto scrollbar-thin">
      {sessions.length === 0 ? (
        <EmptyState />
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}
        >
          {sessions.map((s) => (
            <AgentCard
              key={s.session_id}
              session={s}
              lockCount={locksBySession[s.session_id] ?? 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}
