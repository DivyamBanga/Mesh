import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { PairEvent, EventType } from './types';

export interface FileLockRow {
  path: string;
  project_id: string;
  session_id: string;
  developer: string;
  locked_at: number;
  reason: string;
}

export class EventStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  static create(dbPath: string): EventStore {
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    const schemaPath = path.join(__dirname, '..', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schema);

    return new EventStore(db);
  }

  static createFromDb(db: Database.Database): EventStore {
    return new EventStore(db);
  }

  appendEvent(event: PairEvent): PairEvent {
    const stmt = this.db.prepare(`
      INSERT INTO events (event_id, project_id, session_id, developer, event_type, payload, created_at, delivered_to)
      VALUES (@event_id, @project_id, @session_id, @developer, @event_type, @payload, @created_at, @delivered_to)
    `);

    stmt.run({
      event_id: event.event_id,
      project_id: event.project_id,
      session_id: event.session_id,
      developer: event.developer,
      event_type: event.event_type,
      payload: JSON.stringify(event.payload),
      created_at: event.created_at,
      delivered_to: '[]',
    });

    return event;
  }

  markDelivered(eventId: string, sessionId: string): void {
    const row = this.db
      .prepare('SELECT delivered_to FROM events WHERE event_id = ?')
      .get(eventId) as { delivered_to: string } | undefined;

    if (!row) return;

    const delivered: string[] = JSON.parse(row.delivered_to);
    if (!delivered.includes(sessionId)) {
      delivered.push(sessionId);
      this.db
        .prepare('UPDATE events SET delivered_to = ? WHERE event_id = ?')
        .run(JSON.stringify(delivered), eventId);
    }
  }

  getUndeliveredEvents(sessionId: string, projectId: string, since: number): PairEvent[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM events
        WHERE project_id = ?
          AND session_id != ?
          AND created_at > ?
        ORDER BY created_at ASC
      `)
      .all(projectId, sessionId, since) as any[];

    return rows
      .filter((row) => {
        const delivered: string[] = JSON.parse(row.delivered_to);
        return !delivered.includes(sessionId);
      })
      .map(this.rowToEvent);
  }

  getRecentEvents(projectId: string, limit: number, eventTypes?: EventType[]): PairEvent[] {
    let rows: any[];

    if (eventTypes && eventTypes.length > 0) {
      const placeholders = eventTypes.map(() => '?').join(', ');
      rows = this.db
        .prepare(`
          SELECT * FROM events
          WHERE project_id = ?
            AND event_type IN (${placeholders})
          ORDER BY created_at DESC
          LIMIT ?
        `)
        .all(projectId, ...eventTypes, limit) as any[];
    } else {
      rows = this.db
        .prepare(`
          SELECT * FROM events
          WHERE project_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `)
        .all(projectId, limit) as any[];
    }

    return rows.map(this.rowToEvent).reverse();
  }

  getDecisions(projectId: string, since?: number): PairEvent[] {
    let rows: any[];

    if (since !== undefined) {
      rows = this.db
        .prepare(`
          SELECT * FROM events
          WHERE project_id = ?
            AND event_type = 'decision'
            AND created_at >= ?
          ORDER BY created_at ASC
        `)
        .all(projectId, since) as any[];
    } else {
      rows = this.db
        .prepare(`
          SELECT * FROM events
          WHERE project_id = ?
            AND event_type = 'decision'
          ORDER BY created_at ASC
        `)
        .all(projectId) as any[];
    }

    return rows.map(this.rowToEvent);
  }

  acquireFileLock(
    filePath: string,
    projectId: string,
    sessionId: string,
    developer: string,
    reason: string,
    exclusive: boolean
  ): boolean {
    const existing = this.db
      .prepare('SELECT session_id FROM file_locks WHERE path = ? AND project_id = ?')
      .get(filePath, projectId) as { session_id: string } | undefined;

    if (existing) {
      // Allow re-lock by same session
      if (existing.session_id === sessionId) {
        this.db
          .prepare(`
            UPDATE file_locks SET reason = ?, locked_at = ?
            WHERE path = ? AND project_id = ?
          `)
          .run(reason, Date.now(), filePath, projectId);
        return true;
      }
      return false;
    }

    this.db
      .prepare(`
        INSERT INTO file_locks (path, project_id, session_id, developer, locked_at, reason)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(filePath, projectId, sessionId, developer, Date.now(), reason);

    return true;
  }

  releaseFileLock(paths: string[], projectId: string, sessionId: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM file_locks
      WHERE path = ? AND project_id = ? AND session_id = ?
    `);

    const releaseMany = this.db.transaction((pathList: string[]) => {
      for (const p of pathList) {
        stmt.run(p, projectId, sessionId);
      }
    });

    releaseMany(paths);
  }

  releaseAllLocksForSession(projectId: string, sessionId: string): string[] {
    const rows = this.db
      .prepare('SELECT path FROM file_locks WHERE project_id = ? AND session_id = ?')
      .all(projectId, sessionId) as { path: string }[];

    const paths = rows.map((r) => r.path);

    if (paths.length > 0) {
      this.db
        .prepare('DELETE FROM file_locks WHERE project_id = ? AND session_id = ?')
        .run(projectId, sessionId);
    }

    return paths;
  }

  getFileLocks(projectId: string): FileLockRow[] {
    return this.db
      .prepare('SELECT * FROM file_locks WHERE project_id = ?')
      .all(projectId) as FileLockRow[];
  }

  getEventCount(projectId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM events WHERE project_id = ?')
      .get(projectId) as { count: number };
    return row.count;
  }

  close(): void {
    this.db.close();
  }

  private rowToEvent(row: any): PairEvent {
    return {
      event_id: row.event_id,
      project_id: row.project_id,
      session_id: row.session_id,
      developer: row.developer,
      event_type: row.event_type as EventType,
      payload: JSON.parse(row.payload),
      created_at: row.created_at,
    };
  }
}
