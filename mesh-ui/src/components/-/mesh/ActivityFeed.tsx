import { useState } from "react";
import { useMesh } from "@/context/MeshContext";
import type { EventEntry, ConflictEntry } from "@/lib/mesh-api";
import type { QuestionThread } from "@/context/MeshContext";

// ─── Events tab ──────────────────────────────────────────────────────────────

type DisplayEventType =
  | "intent" | "lock" | "unlock" | "decision" | "conflict" | "heartbeat"
  | "answer" | "question" | "blocker";

function mapEventType(raw: string): DisplayEventType {
  if (raw === "file_lock") return "lock";
  if (raw === "file_unlock") return "unlock";
  if (raw === "blocker_resolved") return "blocker";
  return raw as DisplayEventType;
}

function EventRow({ e }: { e: EventEntry }) {
  const type = mapEventType(e.event_type);
  const isConflict = type === "conflict";
  const time = new Date(e.created_at).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  let text = "";
  if (e.event_type === "intent") text = `"${e.payload.description}"`;
  else if (e.event_type === "file_lock") text = e.payload.paths?.join(", ") ?? "";
  else if (e.event_type === "file_unlock") text = e.payload.paths?.join(", ") ?? "";
  else if (e.event_type === "decision") text = e.payload.summary ?? "";
  else if (e.event_type === "heartbeat") text = `${e.payload.status} · ${e.payload.current_task ?? ""}`;
  else if (e.event_type === "question") text = `"${e.payload.text}"`;
  else if (e.event_type === "answer") text = `"${e.payload.text}"`;
  else if (e.event_type === "blocker") text = e.payload.description ?? "";
  else if (e.event_type === "blocker_resolved") text = `resolved: ${e.payload.resolution ?? ""}`;
  else text = JSON.stringify(e.payload).slice(0, 80);

  return (
    <div
      className={`grid grid-cols-[44px_82px_56px_1fr] gap-2 items-start px-3 py-1.5 text-[11.5px] border-l-2 ${
        isConflict
          ? "bg-status-red/10 border-l-status-red"
          : "border-l-transparent hover:bg-surface-2"
      } transition-colors`}
    >
      <span className="text-subtle tabular-nums">{time}</span>
      <span
        className={`px-1.5 py-[1px] text-[9.5px] uppercase tracking-wider rounded-sm border text-center ${
          isConflict
            ? "border-status-red/40 bg-status-red/10 text-status-red"
            : "border-border bg-surface-2 text-muted-foreground"
        }`}
      >
        {type}
      </span>
      <span className={isConflict ? "text-status-red font-medium" : "text-foreground/90"}>
        {e.developer}
      </span>
      <div className="text-muted-foreground leading-snug truncate">
        <span className={isConflict ? "text-foreground/95" : ""}>{text}</span>
      </div>
    </div>
  );
}

function ConflictRow({ c }: { c: ConflictEntry }) {
  return (
    <div className="grid grid-cols-[44px_82px_56px_1fr] gap-2 items-start px-3 py-1.5 text-[11.5px] border-l-2 bg-status-red/10 border-l-status-red transition-colors">
      <span className="text-subtle tabular-nums">—</span>
      <span className="px-1.5 py-[1px] text-[9.5px] uppercase tracking-wider rounded-sm border border-status-red/40 bg-status-red/10 text-status-red text-center">
        {c.severity}
      </span>
      <span className="text-status-red font-medium">WARN</span>
      <div className="text-foreground/95 leading-snug truncate">{c.description}</div>
    </div>
  );
}

function EventsTab() {
  const { events, conflicts } = useMesh();
  const allEmpty = events.length === 0 && conflicts.length === 0;

  if (allEmpty) {
    return (
      <div className="flex items-center justify-center h-24 text-[12px] text-muted-foreground">
        No events yet — waiting for activity…
      </div>
    );
  }

  return (
    <div className="py-1">
      {conflicts.map((c) => (
        <ConflictRow key={c.conflict_id} c={c} />
      ))}
      {[...events].reverse().map((e) => (
        <EventRow key={e.event_id} e={e} />
      ))}
    </div>
  );
}

// ─── Decisions tab ───────────────────────────────────────────────────────────

function DecisionsTab() {
  const { decisions } = useMesh();

  if (decisions.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-[12px] text-muted-foreground p-4">
        No decisions recorded yet.
      </div>
    );
  }

  return (
    <div className="p-2.5 space-y-2">
      {[...decisions].reverse().map((d) => (
        <div key={d.event_id} className="border border-border bg-surface-2 rounded-sm p-2.5">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="px-1.5 py-[1px] text-[9.5px] uppercase tracking-wider rounded-sm border border-border bg-surface-3 text-muted-foreground">
              {d.payload.category}
            </span>
          </div>
          <div className="text-[12.5px] font-medium text-foreground font-sans-ui leading-tight">
            {d.payload.summary}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
            {d.payload.rationale}
          </p>
          <div className="flex items-center gap-2 mt-2 text-[10.5px] text-subtle">
            <span className="text-foreground/75">{d.developer}</span>
            <span>·</span>
            <span className="tabular-nums">
              {new Date(d.created_at).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Comms tab ───────────────────────────────────────────────────────────────

function ThreadCard({ t }: { t: QuestionThread }) {
  const askTime = new Date(t.askedAt).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const ansTime = t.answeredAt
    ? new Date(t.answeredAt).toLocaleTimeString("en-US", {
        hour: "2-digit", minute: "2-digit", hour12: false,
      })
    : null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-2">
        <div className="h-5 w-5 shrink-0 rounded-full bg-surface-3 border border-border text-foreground/80 flex items-center justify-center text-[10px] font-semibold">
          Q
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] text-foreground/95 leading-snug">{t.question}</div>
          <div className="text-[10.5px] text-subtle mt-0.5">
            {t.asker} · <span className="tabular-nums">{askTime}</span>
          </div>
        </div>
      </div>
      {t.answer ? (
        <div className="ml-3 border-l-2 border-border-strong pl-2.5 py-1">
          <div className="text-[12px] text-foreground/85 leading-snug">"{t.answer}"</div>
          <div className="text-[10.5px] text-subtle mt-0.5">
            {t.answerer} · <span className="tabular-nums">{ansTime}</span>
          </div>
        </div>
      ) : (
        <div className="ml-3 border-l-2 border-border pl-2.5 py-1">
          <div className="text-[11.5px] italic text-muted-foreground">Awaiting response...</div>
        </div>
      )}
    </div>
  );
}

function CommsTab() {
  const { questions } = useMesh();

  if (questions.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-[12px] text-muted-foreground p-4">
        No questions yet.
      </div>
    );
  }

  return (
    <div className="p-2.5 space-y-3">
      {questions.map((t) => (
        <ThreadCard key={t.question_id} t={t} />
      ))}
    </div>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

export function ActivityFeed() {
  const { connected } = useMesh();
  const [tab, setTab] = useState<"events" | "decisions" | "comms">("events");

  const tabBtn = (key: typeof tab, label: string) => {
    const active = tab === key;
    return (
      <button
        type="button"
        onClick={() => setTab(key)}
        className={`relative h-full px-3 text-[11.5px] border-r border-border transition-colors ${
          active
            ? "bg-background text-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {label}
        {active && <span className="absolute left-0 right-0 bottom-0 h-px bg-foreground/85" />}
      </button>
    );
  };

  return (
    <aside className="h-full w-full bg-surface flex flex-col min-h-0">
      <div className="flex items-center h-8 border-b border-border bg-surface">
        {tabBtn("events", "Events")}
        {tabBtn("decisions", "Decisions")}
        {tabBtn("comms", "Comms")}
        <div className="ml-auto px-3 text-subtle text-[10.5px] uppercase tracking-wider">
          {connected ? "live" : "offline"}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {tab === "events" && <EventsTab />}
        {tab === "decisions" && <DecisionsTab />}
        {tab === "comms" && <CommsTab />}
      </div>
    </aside>
  );
}
