import { useState, useEffect, useRef } from "react";
import { useMesh } from "@/context/MeshContext";

export function TerminalPanel() {
  const { meshLogs, connected } = useMesh();
  const [tab, setTab] = useState<"logs" | "claude">("logs");
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (tab === "logs") {
      logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [meshLogs, tab]);

  const tabBtn = (key: typeof tab, label: string, dot?: boolean) => {
    const active = tab === key;
    return (
      <button
        type="button"
        onClick={() => setTab(key)}
        className={`relative flex items-center gap-1.5 h-full px-3 border-r border-border transition-colors ${
          active
            ? "bg-background text-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {dot && connected && (
          <span className="h-1.5 w-1.5 rounded-full bg-status-green animate-status-pulse" />
        )}
        {label}
        {active && <span className="absolute left-0 right-0 bottom-0 h-px bg-foreground/85" />}
      </button>
    );
  };

  return (
    <section className="h-full w-full bg-background flex flex-col min-h-0">
      {/* Tab bar */}
      <div className="flex items-center h-8 border-b border-border bg-surface text-[11.5px]">
        {tabBtn("logs", "Mesh Logs", true)}
        {tabBtn("claude", "Your Claude")}
        <div className="ml-auto px-3 text-subtle text-[10.5px] uppercase tracking-wider">
          {meshLogs.length} lines
        </div>
      </div>

      {/* Output */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-2 text-[12px] leading-relaxed">
        {tab === "logs" ? (
          meshLogs.length === 0 ? (
            <div className="text-muted-foreground text-[11.5px] pt-2">
              Waiting for connection…
            </div>
          ) : (
            <div className="space-y-0.5">
              {meshLogs.map((line, i) => {
                const isWarn = line.includes("CONFLICT") || line.includes("warn") || line.includes("error");
                return (
                  <div
                    key={i}
                    className={`text-[11.5px] font-mono ${
                      isWarn ? "text-status-red" : "text-muted-foreground"
                    }`}
                  >
                    {line}
                  </div>
                );
              })}
              <div ref={logsEndRef} />
            </div>
          )
        ) : (
          <div className="space-y-1 text-muted-foreground text-[11.5px] pt-2">
            <div className="text-foreground/60">
              <span className="text-status-green mr-1.5">❯</span>
              claude
            </div>
            <div className="pl-4 text-foreground/50">
              Connect your Claude Code session via the Mesh MCP plugin to stream
              output here.
            </div>
            <div className="pl-4 mt-3 font-mono text-[10.5px] space-y-0.5 text-foreground/40">
              <div># Add to your CLAUDE.md:</div>
              <div>mesh_server: {"{serverUrl}"}</div>
              <div>invite_code: {"{inviteCode}"}</div>
            </div>
          </div>
        )}
      </div>

      {/* Input stub */}
      <div className="h-9 border-t border-border bg-surface flex items-center px-3 text-[12px]">
        <span className="text-status-green mr-2">❯</span>
        <span className="text-foreground/30">mesh logs —</span>
        <span className="ml-1 inline-block w-[7px] h-[14px] bg-foreground/25 animate-caret" />
      </div>
    </section>
  );
}
