import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { MeshApi, type SessionSummary, type FileLockEntry, type EventEntry, type ConflictEntry } from '@/lib/mesh-api';

// ─── Public types ────────────────────────────────────────────────────────────

export interface QuestionThread {
  question_id: string;
  question: string;
  context: string;
  asker: string;
  askedAt: number;
  answer?: string;
  answerer?: string;
  answeredAt?: number;
}

export interface MeshCredentials {
  serverUrl: string;
  projectId: string;
  projectSecret: string;
  projectName: string;
  inviteCode: string;
}

export interface MeshContextValue {
  credentials: MeshCredentials | null;
  connected: boolean;
  sessions: SessionSummary[];
  events: EventEntry[];
  fileLocks: FileLockEntry[];
  decisions: EventEntry[];
  questions: QuestionThread[];
  conflicts: ConflictEntry[];
  meshLogs: string[];
  sessionStartedAt: number | null;
  configure: (creds: MeshCredentials) => void;
  disconnect: () => void;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const MeshContext = createContext<MeshContextValue | null>(null);

export function useMesh(): MeshContextValue {
  const ctx = useContext(MeshContext);
  if (!ctx) throw new Error('useMesh must be used within MeshProvider');
  return ctx;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'mesh_credentials';
const MAX_EVENTS = 300;
const MAX_LOGS = 500;

function loadCredentials(): MeshCredentials | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as MeshCredentials) : null;
  } catch {
    return null;
  }
}

function deriveQuestions(events: EventEntry[]): QuestionThread[] {
  const threads: Record<string, QuestionThread> = {};
  for (const e of events) {
    if (e.event_type === 'question') {
      threads[e.payload.question_id] = {
        question_id: e.payload.question_id,
        question: e.payload.text,
        context: e.payload.context ?? '',
        asker: e.developer,
        askedAt: e.created_at,
      };
    }
  }
  for (const e of events) {
    if (e.event_type === 'answer' && threads[e.payload.question_id]) {
      threads[e.payload.question_id] = {
        ...threads[e.payload.question_id],
        answer: e.payload.text,
        answerer: e.developer,
        answeredAt: e.created_at,
      };
    }
  }
  return Object.values(threads).sort((a, b) => b.askedAt - a.askedAt);
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function MeshProvider({ children }: { children: ReactNode }) {
  const [credentials, setCredentials] = useState<MeshCredentials | null>(loadCredentials);
  const [connected, setConnected] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [fileLocks, setFileLocks] = useState<FileLockEntry[]>([]);
  const [decisions, setDecisions] = useState<EventEntry[]>([]);
  const [conflicts, setConflicts] = useState<ConflictEntry[]>([]);
  const [meshLogs, setMeshLogs] = useState<string[]>([]);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const apiRef = useRef<MeshApi | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const appendLog = useCallback((msg: string) => {
    const ts = new Date().toISOString().slice(11, 19);
    setMeshLogs((prev) => [...prev.slice(-(MAX_LOGS - 1)), `[${ts}] ${msg}`]);
  }, []);

  const pollState = useCallback(async (api: MeshApi) => {
    try {
      const [s, l] = await Promise.all([api.getSessions(), api.getLocks()]);
      setSessions(s);
      setFileLocks(l);
    } catch {
      /* silent — WS onclose handles visible disconnect */
    }
  }, []);

  const connect = useCallback(
    (creds: MeshCredentials) => {
      // Teardown any previous connection
      wsRef.current?.close();
      if (pollRef.current) clearInterval(pollRef.current);

      const api = new MeshApi(creds.serverUrl, creds.projectId, creds.projectSecret);
      apiRef.current = api;
      setSessionStartedAt(Date.now());

      // Fetch initial REST snapshot
      Promise.all([
        api.getSessions(),
        api.getEvents(100),
        api.getLocks(),
        api.getDecisions(),
        api.getConflicts(),
      ])
        .then(([s, e, l, d, c]) => {
          setSessions(s);
          setEvents(e);
          setFileLocks(l);
          setDecisions(d);
          setConflicts(c);
          appendLog(`initial state loaded — ${s.length} sessions, ${e.length} events`);
        })
        .catch((err) => appendLog(`fetch error: ${(err as Error).message}`));

      // Open WS observer
      const wsUrl = creds.serverUrl.replace(/^http/, 'ws') + '/ws';
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        appendLog(`ws connection established → ${wsUrl}`);
        ws.send(
          JSON.stringify({
            type: 'observe',
            project_id: creds.projectId,
            auth_token: creds.projectSecret,
          }),
        );
      };

      ws.onmessage = (e) => {
        let msg: any;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }

        if (msg.type === 'ack' && msg.message === 'observing') {
          setConnected(true);
          appendLog(`handshake ok · project=${creds.projectId} · observing`);
          return;
        }

        if (msg.type === 'event') {
          const ev: EventEntry = msg.event;
          appendLog(`event: ${ev.event_type} · ${ev.developer}`);

          setEvents((prev) => [...prev.slice(-(MAX_EVENTS - 1)), ev]);

          if (ev.event_type === 'decision') {
            setDecisions((prev) => [...prev, ev]);
          }

          if (ev.event_type === 'heartbeat') {
            setSessions((prev) =>
              prev.map((s) =>
                s.session_id === ev.session_id
                  ? {
                      ...s,
                      status: ev.payload.status,
                      current_task: ev.payload.current_task,
                      last_seen: ev.created_at,
                    }
                  : s,
              ),
            );
          }

          if (ev.event_type === 'file_lock' || ev.event_type === 'file_unlock') {
            pollState(api);
          }
        }

        if (msg.type === 'peer_connected') {
          appendLog(`peer connected: ${msg.developer_name} (${msg.session_id})`);
          setSessions((prev) => {
            if (prev.some((s) => s.session_id === msg.session_id)) return prev;
            return [
              ...prev,
              {
                session_id: msg.session_id,
                developer_name: msg.developer_name,
                branch: msg.branch ?? 'main',
                ws_connected: true,
                last_seen: Date.now(),
                connected_at: Date.now(),
                status: 'idle' as const,
                current_task: '',
              },
            ];
          });
        }

        if (msg.type === 'peer_disconnected') {
          appendLog(`peer disconnected: ${msg.developer_name}`);
          setSessions((prev) =>
            prev.map((s) =>
              s.session_id === msg.session_id
                ? { ...s, ws_connected: false, status: 'idle' as const }
                : s,
            ),
          );
        }

        if (msg.type === 'conflict') {
          const count = (msg.conflicts as ConflictEntry[]).length;
          appendLog(`CONFLICT DETECTED: ${count} conflict(s)`);
          setConflicts((prev) => [...prev, ...msg.conflicts]);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        appendLog('ws disconnected');
      };

      ws.onerror = () => {
        appendLog('ws error — check server is running');
      };

      // Poll sessions + locks every 5 s
      pollRef.current = setInterval(() => pollState(api), 5000);
    },
    [appendLog, pollState],
  );

  const configure = useCallback(
    (creds: MeshCredentials) => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
      setCredentials(creds);
      connect(creds);
    },
    [connect],
  );

  const disconnect = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    wsRef.current?.close();
    if (pollRef.current) clearInterval(pollRef.current);
    setCredentials(null);
    setConnected(false);
    setSessions([]);
    setEvents([]);
    setFileLocks([]);
    setDecisions([]);
    setConflicts([]);
    setMeshLogs([]);
    setSessionStartedAt(null);
  }, []);

  // Auto-connect on mount if credentials exist
  useEffect(() => {
    const creds = loadCredentials();
    if (creds) connect(creds);
    return () => {
      wsRef.current?.close();
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const questions = deriveQuestions(events);

  return (
    <MeshContext.Provider
      value={{
        credentials,
        connected,
        sessions,
        events,
        fileLocks,
        decisions,
        questions,
        conflicts,
        meshLogs,
        sessionStartedAt,
        configure,
        disconnect,
      }}
    >
      {children}
    </MeshContext.Provider>
  );
}
