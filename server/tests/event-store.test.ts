import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { EventStore } from '../src/event-store';
import { PairEvent, IntentPayload, FileLockPayload, HeartbeatPayload, DecisionPayload } from '../src/types';

// Helper: open an in-memory SQLite DB and apply schema
function createTestStore(): EventStore {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  const schemaPath = path.join(__dirname, '..', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);
  return EventStore.createFromDb(db);
}

function makeIntentEvent(overrides: Partial<PairEvent> = {}): PairEvent {
  const payload: IntentPayload = {
    description: 'Refactor auth module',
    files_affected: ['src/auth/index.ts'],
    estimated_scope: 'medium',
    reversible: true,
  };
  return {
    event_id: `evt-${Math.random().toString(36).slice(2)}`,
    project_id: 'proj-test',
    session_id: 'sess-alice',
    developer: 'Alice',
    event_type: 'intent',
    payload,
    created_at: Date.now(),
    ...overrides,
  };
}

function makeDecisionEvent(overrides: Partial<PairEvent> = {}): PairEvent {
  const payload: DecisionPayload = {
    category: 'architecture',
    summary: 'Use hexagonal architecture',
    rationale: 'Better testability',
    affected_files: ['src/'],
    rejected_alternatives: ['MVC'],
  };
  return {
    event_id: `evt-${Math.random().toString(36).slice(2)}`,
    project_id: 'proj-test',
    session_id: 'sess-alice',
    developer: 'Alice',
    event_type: 'decision',
    payload,
    created_at: Date.now(),
    ...overrides,
  };
}

// ─── appendEvent ──────────────────────────────────────────────────────────────

describe('EventStore.appendEvent', () => {
  it('stores and returns the event', () => {
    const store = createTestStore();
    const event = makeIntentEvent();
    const stored = store.appendEvent(event);

    expect(stored.event_id).toBe(event.event_id);
    expect(stored.event_type).toBe('intent');
  });

  it('persists payload as JSON (round-trips correctly)', () => {
    const store = createTestStore();
    const event = makeIntentEvent();
    store.appendEvent(event);

    const [retrieved] = store.getRecentEvents('proj-test', 1);
    const payload = retrieved.payload as IntentPayload;
    expect(payload.description).toBe('Refactor auth module');
    expect(payload.files_affected).toEqual(['src/auth/index.ts']);
  });

  it('throws on duplicate event_id', () => {
    const store = createTestStore();
    const event = makeIntentEvent({ event_id: 'fixed-id' });
    store.appendEvent(event);
    expect(() => store.appendEvent(event)).toThrow();
  });

  it('increments event count', () => {
    const store = createTestStore();
    expect(store.getEventCount('proj-test')).toBe(0);
    store.appendEvent(makeIntentEvent());
    store.appendEvent(makeIntentEvent());
    expect(store.getEventCount('proj-test')).toBe(2);
  });
});

// ─── markDelivered ────────────────────────────────────────────────────────────

describe('EventStore.markDelivered', () => {
  it('marks an event as delivered to a session', () => {
    const store = createTestStore();
    const event = makeIntentEvent({ event_id: 'evt-delivered' });
    store.appendEvent(event);

    store.markDelivered('evt-delivered', 'sess-bob');

    // Event should no longer appear as undelivered for sess-bob
    const undelivered = store.getUndeliveredEvents('sess-bob', 'proj-test', 0);
    expect(undelivered.find((e) => e.event_id === 'evt-delivered')).toBeUndefined();
  });

  it('is idempotent — double-marking does not duplicate', () => {
    const store = createTestStore();
    const event = makeIntentEvent({ event_id: 'evt-idem', session_id: 'sess-alice' });
    store.appendEvent(event);

    store.markDelivered('evt-idem', 'sess-bob');
    store.markDelivered('evt-idem', 'sess-bob');

    const undelivered = store.getUndeliveredEvents('sess-bob', 'proj-test', 0);
    expect(undelivered.find((e) => e.event_id === 'evt-idem')).toBeUndefined();
  });

  it('does not affect other sessions', () => {
    const store = createTestStore();
    const event = makeIntentEvent({ event_id: 'evt-partial', session_id: 'sess-alice' });
    store.appendEvent(event);

    store.markDelivered('evt-partial', 'sess-bob');

    // sess-carol should still see it as undelivered
    const undelivered = store.getUndeliveredEvents('sess-carol', 'proj-test', 0);
    expect(undelivered.find((e) => e.event_id === 'evt-partial')).toBeDefined();
  });

  it('silently ignores unknown event_id', () => {
    const store = createTestStore();
    expect(() => store.markDelivered('nonexistent', 'sess-bob')).not.toThrow();
  });
});

// ─── getUndeliveredEvents ─────────────────────────────────────────────────────

describe('EventStore.getUndeliveredEvents', () => {
  it('excludes events from the requesting session', () => {
    const store = createTestStore();
    store.appendEvent(makeIntentEvent({ event_id: 'own-event', session_id: 'sess-alice' }));

    const undelivered = store.getUndeliveredEvents('sess-alice', 'proj-test', 0);
    expect(undelivered.find((e) => e.event_id === 'own-event')).toBeUndefined();
  });

  it('returns events from partner sessions not yet delivered', () => {
    const store = createTestStore();
    store.appendEvent(
      makeIntentEvent({ event_id: 'partner-evt', session_id: 'sess-bob', developer: 'Bob' })
    );

    const undelivered = store.getUndeliveredEvents('sess-alice', 'proj-test', 0);
    expect(undelivered.find((e) => e.event_id === 'partner-evt')).toBeDefined();
  });

  it('filters by since timestamp', () => {
    const store = createTestStore();
    const old = makeIntentEvent({ event_id: 'old-evt', session_id: 'sess-bob', created_at: 100 });
    const recent = makeIntentEvent({ event_id: 'new-evt', session_id: 'sess-bob', created_at: 200 });
    store.appendEvent(old);
    store.appendEvent(recent);

    const undelivered = store.getUndeliveredEvents('sess-alice', 'proj-test', 150);
    expect(undelivered.find((e) => e.event_id === 'old-evt')).toBeUndefined();
    expect(undelivered.find((e) => e.event_id === 'new-evt')).toBeDefined();
  });

  it('excludes events from different projects', () => {
    const store = createTestStore();
    store.appendEvent(
      makeIntentEvent({ event_id: 'other-proj', session_id: 'sess-bob', project_id: 'proj-other' })
    );

    const undelivered = store.getUndeliveredEvents('sess-alice', 'proj-test', 0);
    expect(undelivered.find((e) => e.event_id === 'other-proj')).toBeUndefined();
  });

  it('returns events ordered by created_at ascending', () => {
    const store = createTestStore();
    store.appendEvent(
      makeIntentEvent({ event_id: 'b-evt', session_id: 'sess-bob', created_at: 200 })
    );
    store.appendEvent(
      makeIntentEvent({ event_id: 'a-evt', session_id: 'sess-bob', created_at: 100 })
    );

    const undelivered = store.getUndeliveredEvents('sess-alice', 'proj-test', 0);
    const ids = undelivered.map((e) => e.event_id);
    expect(ids.indexOf('a-evt')).toBeLessThan(ids.indexOf('b-evt'));
  });
});

// ─── getRecentEvents ──────────────────────────────────────────────────────────

describe('EventStore.getRecentEvents', () => {
  it('respects the limit', () => {
    const store = createTestStore();
    for (let i = 0; i < 5; i++) {
      store.appendEvent(makeIntentEvent({ event_id: `e-${i}` }));
    }
    const events = store.getRecentEvents('proj-test', 3);
    expect(events).toHaveLength(3);
  });

  it('filters by event type when provided', () => {
    const store = createTestStore();
    store.appendEvent(makeIntentEvent({ event_id: 'intent-1' }));
    store.appendEvent(makeDecisionEvent({ event_id: 'decision-1' }));

    const intentOnly = store.getRecentEvents('proj-test', 10, ['intent']);
    expect(intentOnly.every((e) => e.event_type === 'intent')).toBe(true);
    expect(intentOnly.find((e) => e.event_id === 'decision-1')).toBeUndefined();
  });

  it('returns multiple filtered types when requested', () => {
    const store = createTestStore();
    store.appendEvent(makeIntentEvent({ event_id: 'intent-1' }));
    store.appendEvent(makeDecisionEvent({ event_id: 'decision-1' }));

    const mixed = store.getRecentEvents('proj-test', 10, ['intent', 'decision']);
    expect(mixed).toHaveLength(2);
  });

  it('returns empty array when no matching events', () => {
    const store = createTestStore();
    const events = store.getRecentEvents('proj-test', 10);
    expect(events).toHaveLength(0);
  });

  it('returns events in ascending created_at order', () => {
    const store = createTestStore();
    store.appendEvent(makeIntentEvent({ event_id: 'first', created_at: 100 }));
    store.appendEvent(makeIntentEvent({ event_id: 'second', created_at: 200 }));
    store.appendEvent(makeIntentEvent({ event_id: 'third', created_at: 300 }));

    const events = store.getRecentEvents('proj-test', 10);
    const ids = events.map((e) => e.event_id);
    expect(ids).toEqual(['first', 'second', 'third']);
  });
});

// ─── getDecisions ─────────────────────────────────────────────────────────────

describe('EventStore.getDecisions', () => {
  it('returns only decision events', () => {
    const store = createTestStore();
    store.appendEvent(makeIntentEvent({ event_id: 'not-decision' }));
    store.appendEvent(makeDecisionEvent({ event_id: 'is-decision' }));

    const decisions = store.getDecisions('proj-test');
    expect(decisions.every((e) => e.event_type === 'decision')).toBe(true);
  });

  it('filters by since timestamp when provided', () => {
    const store = createTestStore();
    store.appendEvent(makeDecisionEvent({ event_id: 'old-dec', created_at: 100 }));
    store.appendEvent(makeDecisionEvent({ event_id: 'new-dec', created_at: 500 }));

    const decisions = store.getDecisions('proj-test', 200);
    expect(decisions.find((e) => e.event_id === 'old-dec')).toBeUndefined();
    expect(decisions.find((e) => e.event_id === 'new-dec')).toBeDefined();
  });

  it('returns empty array for project with no decisions', () => {
    const store = createTestStore();
    expect(store.getDecisions('proj-empty')).toHaveLength(0);
  });
});

// ─── acquireFileLock ──────────────────────────────────────────────────────────

describe('EventStore.acquireFileLock', () => {
  it('returns true when lock is free', () => {
    const store = createTestStore();
    const result = store.acquireFileLock(
      'src/auth/index.ts', 'proj-test', 'sess-alice', 'Alice', 'Refactoring', true
    );
    expect(result).toBe(true);
  });

  it('returns false when file is locked by another session', () => {
    const store = createTestStore();
    store.acquireFileLock('src/auth/index.ts', 'proj-test', 'sess-alice', 'Alice', 'Refactoring', true);

    const result = store.acquireFileLock(
      'src/auth/index.ts', 'proj-test', 'sess-bob', 'Bob', 'Also refactoring', false
    );
    expect(result).toBe(false);
  });

  it('allows the same session to re-lock (idempotent)', () => {
    const store = createTestStore();
    store.acquireFileLock('src/auth/index.ts', 'proj-test', 'sess-alice', 'Alice', 'Initial', true);
    const result = store.acquireFileLock(
      'src/auth/index.ts', 'proj-test', 'sess-alice', 'Alice', 'Updated reason', true
    );
    expect(result).toBe(true);
  });

  it('allows different files to be locked by different sessions', () => {
    const store = createTestStore();
    const r1 = store.acquireFileLock('src/a.ts', 'proj-test', 'sess-alice', 'Alice', 'Working', true);
    const r2 = store.acquireFileLock('src/b.ts', 'proj-test', 'sess-bob', 'Bob', 'Working', true);
    expect(r1).toBe(true);
    expect(r2).toBe(true);
  });

  it('isolates locks by project_id', () => {
    const store = createTestStore();
    store.acquireFileLock('src/auth/index.ts', 'proj-a', 'sess-alice', 'Alice', 'Working', true);
    const result = store.acquireFileLock(
      'src/auth/index.ts', 'proj-b', 'sess-bob', 'Bob', 'Working', true
    );
    expect(result).toBe(true);
  });
});

// ─── releaseFileLock ──────────────────────────────────────────────────────────

describe('EventStore.releaseFileLock', () => {
  it('releases locks owned by the session', () => {
    const store = createTestStore();
    store.acquireFileLock('src/a.ts', 'proj-test', 'sess-alice', 'Alice', 'Working', true);
    store.releaseFileLock(['src/a.ts'], 'proj-test', 'sess-alice');

    const locks = store.getFileLocks('proj-test');
    expect(locks.find((l) => l.path === 'src/a.ts')).toBeUndefined();
  });

  it('does not release locks owned by another session', () => {
    const store = createTestStore();
    store.acquireFileLock('src/a.ts', 'proj-test', 'sess-alice', 'Alice', 'Working', true);
    store.releaseFileLock(['src/a.ts'], 'proj-test', 'sess-bob');

    const locks = store.getFileLocks('proj-test');
    expect(locks.find((l) => l.path === 'src/a.ts')).toBeDefined();
  });

  it('releases multiple paths in one call', () => {
    const store = createTestStore();
    store.acquireFileLock('src/a.ts', 'proj-test', 'sess-alice', 'Alice', 'Working', true);
    store.acquireFileLock('src/b.ts', 'proj-test', 'sess-alice', 'Alice', 'Working', true);
    store.releaseFileLock(['src/a.ts', 'src/b.ts'], 'proj-test', 'sess-alice');

    expect(store.getFileLocks('proj-test')).toHaveLength(0);
  });

  it('is a no-op for paths not locked by caller', () => {
    const store = createTestStore();
    expect(() => store.releaseFileLock(['src/nonexistent.ts'], 'proj-test', 'sess-alice')).not.toThrow();
  });
});

// ─── getFileLocks ─────────────────────────────────────────────────────────────

describe('EventStore.getFileLocks', () => {
  it('returns all locks for a project', () => {
    const store = createTestStore();
    store.acquireFileLock('src/a.ts', 'proj-test', 'sess-alice', 'Alice', 'Working', true);
    store.acquireFileLock('src/b.ts', 'proj-test', 'sess-bob', 'Bob', 'Working', false);

    const locks = store.getFileLocks('proj-test');
    expect(locks).toHaveLength(2);
    expect(locks.map((l) => l.path).sort()).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('excludes locks from other projects', () => {
    const store = createTestStore();
    store.acquireFileLock('src/a.ts', 'proj-a', 'sess-alice', 'Alice', 'Working', true);

    const locks = store.getFileLocks('proj-b');
    expect(locks).toHaveLength(0);
  });

  it('returns correct metadata with each lock', () => {
    const store = createTestStore();
    store.acquireFileLock('src/a.ts', 'proj-test', 'sess-alice', 'Alice', 'Refactoring login', true);

    const locks = store.getFileLocks('proj-test');
    expect(locks[0].developer).toBe('Alice');
    expect(locks[0].session_id).toBe('sess-alice');
    expect(locks[0].reason).toBe('Refactoring login');
  });
});

// ─── releaseAllLocksForSession ────────────────────────────────────────────────

describe('EventStore.releaseAllLocksForSession', () => {
  it('releases all locks for a session and returns their paths', () => {
    const store = createTestStore();
    store.acquireFileLock('src/a.ts', 'proj-test', 'sess-alice', 'Alice', 'Working', true);
    store.acquireFileLock('src/b.ts', 'proj-test', 'sess-alice', 'Alice', 'Working', true);
    store.acquireFileLock('src/c.ts', 'proj-test', 'sess-bob', 'Bob', 'Working', true);

    const released = store.releaseAllLocksForSession('proj-test', 'sess-alice');
    expect(released.sort()).toEqual(['src/a.ts', 'src/b.ts']);

    const remaining = store.getFileLocks('proj-test');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].session_id).toBe('sess-bob');
  });

  it('returns empty array when session has no locks', () => {
    const store = createTestStore();
    const released = store.releaseAllLocksForSession('proj-test', 'sess-nobody');
    expect(released).toHaveLength(0);
  });
});

// ─── lock conflict after release ─────────────────────────────────────────────

describe('File lock conflict and release cycle', () => {
  it('allows lock acquisition after previous owner releases', () => {
    const store = createTestStore();
    store.acquireFileLock('src/a.ts', 'proj-test', 'sess-alice', 'Alice', 'Working', true);
    store.releaseFileLock(['src/a.ts'], 'proj-test', 'sess-alice');

    const result = store.acquireFileLock(
      'src/a.ts', 'proj-test', 'sess-bob', 'Bob', 'Now my turn', true
    );
    expect(result).toBe(true);
  });
});
