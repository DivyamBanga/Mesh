import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { SessionRegistry } from '../src/session-registry';

function createTestRegistry(): SessionRegistry {
  const db = new Database(':memory:');
  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf-8');
  db.exec(schema);
  return new SessionRegistry(db);
}

describe('SessionRegistry.registerSession', () => {
  it('adds session to in-memory map and DB', () => {
    const r = createTestRegistry();
    r.registerSession('sess-a', 'proj-1', 'Alice', 'main');
    expect(r.getSession('sess-a')).toBeDefined();
    expect(r.getSession('sess-a')?.developer_name).toBe('Alice');
  });

  it('returns the registered session info', () => {
    const r = createTestRegistry();
    const info = r.registerSession('sess-b', 'proj-1', 'Bob', 'feature/auth');
    expect(info.session_id).toBe('sess-b');
    expect(info.branch).toBe('feature/auth');
    expect(info.ws_connected).toBe(true);
  });
});

describe('SessionRegistry.updateHeartbeat', () => {
  it('updates last_seen and in-memory heartbeat', () => {
    const r = createTestRegistry();
    r.registerSession('sess-a', 'proj-1', 'Alice', 'main');
    const before = r.getSession('sess-a')!.last_seen;

    // Small delay to ensure timestamp differs
    const hb = { current_task: 'Building auth', active_files: ['src/auth.ts'], status: 'working' as const };
    r.updateHeartbeat('sess-a', hb);

    const session = r.getSession('sess-a')!;
    expect(session.heartbeat).toEqual(hb);
    expect(session.last_seen).toBeGreaterThanOrEqual(before);
  });

  it('is a no-op for unknown session', () => {
    const r = createTestRegistry();
    expect(() => r.updateHeartbeat('unknown', { current_task: '', active_files: [], status: 'idle' })).not.toThrow();
  });
});

describe('SessionRegistry.getSessionsForProject', () => {
  it('returns all sessions for a project', () => {
    const r = createTestRegistry();
    r.registerSession('sess-a', 'proj-1', 'Alice', 'main');
    r.registerSession('sess-b', 'proj-1', 'Bob', 'main');
    r.registerSession('sess-c', 'proj-2', 'Carol', 'main');
    expect(r.getSessionsForProject('proj-1')).toHaveLength(2);
    expect(r.getSessionsForProject('proj-2')).toHaveLength(1);
  });
});

describe('SessionRegistry.getPartnerContexts', () => {
  it('excludes the calling session', () => {
    const r = createTestRegistry();
    r.registerSession('sess-a', 'proj-1', 'Alice', 'main');
    r.registerSession('sess-b', 'proj-1', 'Bob', 'main');
    r.registerSession('sess-c', 'proj-1', 'Carol', 'main');

    const partners = r.getPartnerContexts('sess-a', 'proj-1');
    expect(partners).toHaveLength(2);
    expect(partners.find(p => p.session_id === 'sess-a')).toBeUndefined();
  });

  it('returns empty array when no other sessions', () => {
    const r = createTestRegistry();
    r.registerSession('sess-a', 'proj-1', 'Alice', 'main');
    expect(r.getPartnerContexts('sess-a', 'proj-1')).toHaveLength(0);
  });

  it('includes heartbeat data in context', () => {
    const r = createTestRegistry();
    r.registerSession('sess-a', 'proj-1', 'Alice', 'main');
    r.registerSession('sess-b', 'proj-1', 'Bob', 'main');
    r.updateHeartbeat('sess-b', { current_task: 'Auth module', active_files: ['src/auth.ts'], status: 'working' });

    const [ctx] = r.getPartnerContexts('sess-a', 'proj-1');
    expect(ctx.current_task).toBe('Auth module');
    expect(ctx.status).toBe('working');
  });
});

describe('SessionRegistry.markDisconnected', () => {
  it('sets ws_connected to false, retains session', () => {
    const r = createTestRegistry();
    r.registerSession('sess-a', 'proj-1', 'Alice', 'main');
    r.markDisconnected('sess-a');

    const session = r.getSession('sess-a')!;
    expect(session.ws_connected).toBe(false);
  });

  it('still returns disconnected session in getSessionsForProject', () => {
    const r = createTestRegistry();
    r.registerSession('sess-a', 'proj-1', 'Alice', 'main');
    r.markDisconnected('sess-a');
    expect(r.getSessionsForProject('proj-1')).toHaveLength(1);
  });
});

describe('SessionRegistry.cleanStaleSessions', () => {
  it('removes disconnected sessions older than maxAgeMs', () => {
    const r = createTestRegistry();
    r.registerSession('sess-a', 'proj-1', 'Alice', 'main');
    r.markDisconnected('sess-a');
    // Override last_seen to ancient time
    const session = r.getSession('sess-a')!;
    session.last_seen = Date.now() - 600000; // 10 minutes ago

    r.cleanStaleSessions(300000); // 5 minutes max age
    expect(r.getSession('sess-a')).toBeUndefined();
  });

  it('retains recently disconnected sessions', () => {
    const r = createTestRegistry();
    r.registerSession('sess-a', 'proj-1', 'Alice', 'main');
    r.markDisconnected('sess-a');

    r.cleanStaleSessions(300000);
    // Should still be there — just disconnected
    expect(r.getSession('sess-a')).toBeDefined();
  });

  it('does not remove connected sessions regardless of age', () => {
    const r = createTestRegistry();
    r.registerSession('sess-a', 'proj-1', 'Alice', 'main');
    // Still connected
    r.cleanStaleSessions(0); // maxAge = 0 = remove everything disconnected
    expect(r.getSession('sess-a')).toBeDefined();
  });
});
