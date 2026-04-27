import Database from 'better-sqlite3';
import WebSocket from 'ws';
import { HeartbeatPayload, PartnerContext } from './types';

export interface SessionInfo {
  session_id: string;
  developer_name: string;
  project_id: string;
  branch: string;
  connected_at: number;
  last_seen: number;
  ws_connected: boolean;
  ws?: WebSocket;
  heartbeat?: HeartbeatPayload;
}

export class SessionRegistry {
  private db: Database.Database;
  private sessions: Map<string, SessionInfo> = new Map();

  constructor(db: Database.Database) {
    this.db = db;
    this.loadFromDb();
  }

  private loadFromDb(): void {
    const rows = this.db.prepare('SELECT * FROM sessions').all() as any[];
    for (const row of rows) {
      this.sessions.set(row.session_id, {
        session_id: row.session_id,
        developer_name: row.developer_name,
        project_id: row.project_id,
        branch: row.branch,
        connected_at: row.connected_at,
        last_seen: row.last_seen,
        ws_connected: row.ws_connected === 1,
      });
    }
  }

  registerSession(
    sessionId: string,
    projectId: string,
    developerName: string,
    branch: string,
    ws?: WebSocket
  ): SessionInfo {
    const now = Date.now();
    const info: SessionInfo = {
      session_id: sessionId,
      developer_name: developerName,
      project_id: projectId,
      branch,
      connected_at: now,
      last_seen: now,
      ws_connected: true,
      ws,
    };

    this.sessions.set(sessionId, info);

    this.db.prepare(`
      INSERT INTO sessions (session_id, developer_name, project_id, branch, connected_at, last_seen, ws_connected)
      VALUES (?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(session_id) DO UPDATE SET
        developer_name = excluded.developer_name,
        branch = excluded.branch,
        last_seen = excluded.last_seen,
        ws_connected = 1
    `).run(sessionId, developerName, projectId, branch, now, now);

    return info;
  }

  updateHeartbeat(sessionId: string, payload: HeartbeatPayload): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const now = Date.now();
    session.last_seen = now;
    session.heartbeat = payload;

    this.db.prepare('UPDATE sessions SET last_seen = ? WHERE session_id = ?')
      .run(now, sessionId);
  }

  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionsForProject(projectId: string): SessionInfo[] {
    return Array.from(this.sessions.values())
      .filter(s => s.project_id === projectId);
  }

  getConnectedSessionsForProject(projectId: string): SessionInfo[] {
    return this.getSessionsForProject(projectId)
      .filter(s => s.ws_connected);
  }

  getPartnerContexts(sessionId: string, projectId: string): PartnerContext[] {
    return this.getSessionsForProject(projectId)
      .filter(s => s.session_id !== sessionId)
      .map(s => this.sessionToPartnerContext(s));
  }

  markDisconnected(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.ws_connected = false;
    session.ws = undefined;
    session.last_seen = Date.now();

    this.db.prepare('UPDATE sessions SET ws_connected = 0, last_seen = ? WHERE session_id = ?')
      .run(session.last_seen, sessionId);
  }

  cleanStaleSessions(maxAgeMs: number): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, session] of this.sessions) {
      if (!session.ws_connected && session.last_seen < cutoff) {
        this.sessions.delete(id);
        this.db.prepare('DELETE FROM sessions WHERE session_id = ?').run(id);
      }
    }
  }

  getTotalSessionCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
    return row.count;
  }

  private sessionToPartnerContext(s: SessionInfo): PartnerContext {
    return {
      developer: s.developer_name,
      session_id: s.session_id,
      branch: s.branch,
      current_task: s.heartbeat?.current_task ?? '',
      active_files: s.heartbeat?.active_files ?? [],
      status: s.heartbeat?.status ?? 'idle',
      recent_decisions: [],
      active_locks: [],
      open_questions: [],
      open_blockers: [],
      last_updated: s.last_seen,
    };
  }
}
