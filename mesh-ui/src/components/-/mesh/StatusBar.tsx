import { useMesh } from "@/context/MeshContext";

export function StatusBar() {
  const { connected, credentials, fileLocks, events, conflicts } = useMesh();
  const serverUrl = credentials?.serverUrl ?? "—";

  return (
    <footer className="shrink-0 h-8 border-t border-border bg-surface flex items-center justify-between px-3 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-2">
        {connected ? (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-status-green animate-status-pulse" />
            <span className="text-foreground/85">Connected</span>
          </>
        ) : (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-status-grey" />
            <span className="text-foreground/50">Disconnected</span>
          </>
        )}
        <span className="text-subtle">to</span>
        <span className="text-foreground/85">{serverUrl.replace(/^https?:\/\//, "")}</span>
      </div>
      <div className="flex items-center gap-2.5">
        <span>
          <span className="text-foreground/85">{fileLocks.length}</span> locks
        </span>
        <span className="text-subtle">·</span>
        <span>
          <span className="text-foreground/85">{events.length}</span> events
        </span>
        {conflicts.length > 0 && (
          <>
            <span className="text-subtle">·</span>
            <span>
              <span className="text-status-red">{conflicts.length}</span> conflict
              {conflicts.length !== 1 ? "s" : ""}
            </span>
          </>
        )}
      </div>
      <div className="text-subtle">
        {serverUrl !== "—" ? serverUrl.replace(/^http/, "ws") + "/ws" : "—"}
      </div>
    </footer>
  );
}
