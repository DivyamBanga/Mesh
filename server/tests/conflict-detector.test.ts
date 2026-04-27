import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { EventStore } from '../src/event-store';
import { SessionRegistry } from '../src/session-registry';
import { ConflictDetector } from '../src/conflict-detector';
import { PairEvent, IntentPayload, FileLockPayload, DecisionPayload, HeartbeatPayload, BlockerPayload } from '../src/types';

function createTestSetup() {
  const db = new Database(':memory:');
  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf-8');
  db.exec(schema);
  const eventStore = EventStore.createFromDb(db);
  const registry = new SessionRegistry(db);
  const detector = new ConflictDetector(eventStore, registry);
  return { db, eventStore, registry, detector };
}

function makeIntentEvent(opts: {
  session_id: string;
  description: string;
  files?: string[];
  project_id?: string;
}): PairEvent {
  const payload: IntentPayload = {
    description: opts.description,
    files_affected: opts.files ?? [],
    estimated_scope: 'medium',
    reversible: true,
  };
  return {
    event_id: `evt-${Math.random().toString(36).slice(2)}`,
    project_id: opts.project_id ?? 'proj-test',
    session_id: opts.session_id,
    developer: opts.session_id,
    event_type: 'intent',
    payload,
    created_at: Date.now(),
  };
}

function makeLockEvent(opts: {
  session_id: string;
  paths: string[];
  project_id?: string;
}): PairEvent {
  const payload: FileLockPayload = {
    paths: opts.paths,
    reason: 'Working on it',
    exclusive: true,
  };
  return {
    event_id: `evt-${Math.random().toString(36).slice(2)}`,
    project_id: opts.project_id ?? 'proj-test',
    session_id: opts.session_id,
    developer: opts.session_id,
    event_type: 'file_lock',
    payload,
    created_at: Date.now(),
  };
}

function makeDecisionEvent(opts: {
  session_id: string;
  summary?: string;
  project_id?: string;
}): PairEvent {
  const payload: DecisionPayload = {
    category: 'api_contract',
    summary: opts.summary ?? 'REST API for auth',
    rationale: 'Standard REST approach for the api layer',
    affected_files: ['src/api/auth.ts'],
    rejected_alternatives: [],
  };
  return {
    event_id: `evt-${Math.random().toString(36).slice(2)}`,
    project_id: opts.project_id ?? 'proj-test',
    session_id: opts.session_id,
    developer: opts.session_id,
    event_type: 'decision',
    payload,
    created_at: Date.now(),
  };
}

// ─── File overlap: formal lock ────────────────────────────────────────────────

describe('ConflictDetector — file overlap with formal lock', () => {
  it('returns critical conflict when incoming intent overlaps a formal lock', () => {
    const { eventStore, registry, detector } = createTestSetup();
    registry.registerSession('sess-alice', 'proj-test', 'Alice', 'main');
    registry.registerSession('sess-bob', 'proj-test', 'Bob', 'main');

    // Alice locks the file
    eventStore.acquireFileLock('src/auth/index.ts', 'proj-test', 'sess-alice', 'Alice', 'Refactoring', true);

    // Bob broadcasts intent on same file
    const event = makeIntentEvent({ session_id: 'sess-bob', description: 'refactor login', files: ['src/auth/index.ts'] });
    const conflicts = detector.detect(event);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].type).toBe('file_overlap');
    expect(conflicts[0].severity).toBe('critical');
    expect(conflicts[0].sessions_involved).toContain('sess-alice');
    expect(conflicts[0].sessions_involved).toContain('sess-bob');
  });

  it('returns critical conflict when incoming file_lock overlaps existing lock', () => {
    const { eventStore, registry, detector } = createTestSetup();
    registry.registerSession('sess-alice', 'proj-test', 'Alice', 'main');
    registry.registerSession('sess-bob', 'proj-test', 'Bob', 'main');

    eventStore.acquireFileLock('src/api/routes.ts', 'proj-test', 'sess-alice', 'Alice', 'Working', true);

    const lockEvent = makeLockEvent({ session_id: 'sess-bob', paths: ['src/api/routes.ts'] });
    const conflicts = detector.detect(lockEvent);

    expect(conflicts[0].severity).toBe('critical');
    expect(conflicts[0].type).toBe('file_overlap');
  });

  it('returns no conflict when files do not overlap', () => {
    const { eventStore, registry, detector } = createTestSetup();
    registry.registerSession('sess-alice', 'proj-test', 'Alice', 'main');
    registry.registerSession('sess-bob', 'proj-test', 'Bob', 'main');

    eventStore.acquireFileLock('src/auth/index.ts', 'proj-test', 'sess-alice', 'Alice', 'Refactoring', true);

    const event = makeIntentEvent({ session_id: 'sess-bob', description: 'build routes', files: ['src/routes/api.ts'] });
    const conflicts = detector.detect(event);

    expect(conflicts).toHaveLength(0);
  });
});

// ─── File overlap: heartbeat active_files ────────────────────────────────────

describe('ConflictDetector — file overlap with heartbeat', () => {
  it('returns warning when file is in partner heartbeat active_files (no formal lock)', () => {
    const { registry, detector } = createTestSetup();
    registry.registerSession('sess-alice', 'proj-test', 'Alice', 'main');
    registry.registerSession('sess-bob', 'proj-test', 'Bob', 'main');
    registry.updateHeartbeat('sess-alice', {
      current_task: 'Auth work',
      active_files: ['src/auth/login.ts'],
      status: 'working',
    });

    const event = makeIntentEvent({ session_id: 'sess-bob', description: 'login flow', files: ['src/auth/login.ts'] });
    const conflicts = detector.detect(event);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].severity).toBe('warning');
    expect(conflicts[0].type).toBe('file_overlap');
  });

  it('does not duplicate: formal lock takes precedence, no extra warning', () => {
    const { eventStore, registry, detector } = createTestSetup();
    registry.registerSession('sess-alice', 'proj-test', 'Alice', 'main');
    registry.registerSession('sess-bob', 'proj-test', 'Bob', 'main');

    // Alice has formal lock AND heartbeat on same file
    eventStore.acquireFileLock('src/auth/login.ts', 'proj-test', 'sess-alice', 'Alice', 'Working', true);
    registry.updateHeartbeat('sess-alice', {
      current_task: 'Auth work',
      active_files: ['src/auth/login.ts'],
      status: 'working',
    });

    const event = makeIntentEvent({ session_id: 'sess-bob', description: 'refactor', files: ['src/auth/login.ts'] });
    const conflicts = detector.detect(event);

    // Should have exactly 1 critical conflict (from formal lock), NOT a duplicate warning
    const criticals = conflicts.filter(c => c.severity === 'critical');
    expect(criticals).toHaveLength(1);
  });
});

// ─── Semantic intent detection ────────────────────────────────────────────────

describe('ConflictDetector — semantic intent detection', () => {
  it('detects shared identifiers between intent descriptions', () => {
    const { registry, detector } = createTestSetup();
    registry.registerSession('sess-alice', 'proj-test', 'Alice', 'main');
    registry.registerSession('sess-bob', 'proj-test', 'Bob', 'main');

    // Alice broadcasts intent with AuthService identifier
    const aliceEvent = makeIntentEvent({ session_id: 'sess-alice', description: 'Implement AuthService login method' });
    detector.detect(aliceEvent); // populates intent window

    // Bob broadcasts intent also referencing AuthService
    const bobEvent = makeIntentEvent({ session_id: 'sess-bob', description: 'Refactor AuthService for OAuth' });
    const conflicts = detector.detect(bobEvent);

    const semantic = conflicts.filter(c => c.type === 'intent_semantic');
    expect(semantic).toHaveLength(1);
    expect(semantic[0].severity).toBe('warning');
    expect(semantic[0].description).toContain('AuthService');
  });

  it('does not conflict with own previous intents', () => {
    const { registry, detector } = createTestSetup();
    registry.registerSession('sess-alice', 'proj-test', 'Alice', 'main');

    const e1 = makeIntentEvent({ session_id: 'sess-alice', description: 'Implement AuthService' });
    detector.detect(e1);
    const e2 = makeIntentEvent({ session_id: 'sess-alice', description: 'Refactor AuthService' });
    const conflicts = detector.detect(e2);

    expect(conflicts.filter(c => c.type === 'intent_semantic')).toHaveLength(0);
  });

  it('returns no conflict when descriptions share no identifiers', () => {
    const { registry, detector } = createTestSetup();
    registry.registerSession('sess-alice', 'proj-test', 'Alice', 'main');
    registry.registerSession('sess-bob', 'proj-test', 'Bob', 'main');

    const e1 = makeIntentEvent({ session_id: 'sess-alice', description: 'Build the login page UI' });
    detector.detect(e1);
    const e2 = makeIntentEvent({ session_id: 'sess-bob', description: 'Set up database migrations' });
    const conflicts = detector.detect(e2);

    expect(conflicts.filter(c => c.type === 'intent_semantic')).toHaveLength(0);
  });

  it('keeps a sliding window of last 10 intents per project', () => {
    const { registry, detector } = createTestSetup();
    registry.registerSession('sess-alice', 'proj-test', 'Alice', 'main');
    registry.registerSession('sess-bob', 'proj-test', 'Bob', 'main');

    // Push 11 Alice events — first one should be evicted
    for (let i = 0; i < 11; i++) {
      detector.detect(makeIntentEvent({ session_id: 'sess-alice', description: `Implement AuthController step ${i}` }));
    }

    // Bob references AuthController — should still match (last 10 include it)
    const bobEvent = makeIntentEvent({ session_id: 'sess-bob', description: 'Use AuthController in routes' });
    const conflicts = detector.detect(bobEvent);
    expect(conflicts.filter(c => c.type === 'intent_semantic').length).toBeGreaterThan(0);
  });
});

// ─── API contract opportunity ─────────────────────────────────────────────────

describe('ConflictDetector — API contract blocker matching', () => {
  it('flags opportunity when api_contract decision can resolve open blocker', () => {
    const { eventStore, registry, detector } = createTestSetup();
    registry.registerSession('sess-alice', 'proj-test', 'Alice', 'main');
    registry.registerSession('sess-bob', 'proj-test', 'Bob', 'main');

    // Bob has an open blocker waiting for API
    const blockerEvent: PairEvent = {
      event_id: 'blocker-1',
      project_id: 'proj-test',
      session_id: 'sess-bob',
      developer: 'Bob',
      event_type: 'blocker',
      payload: {
        blocker_id: 'b-001',
        description: 'Cannot proceed without API contract',
        waiting_for: 'api endpoints definition',
      } as BlockerPayload,
      created_at: Date.now(),
    };
    eventStore.appendEvent(blockerEvent);

    // Alice makes an api_contract decision
    const decisionEvent = makeDecisionEvent({ session_id: 'sess-alice', summary: 'Define REST API for auth' });
    const conflicts = detector.detect(decisionEvent);

    const apiConflicts = conflicts.filter(c => c.type === 'api_contract');
    expect(apiConflicts.length).toBeGreaterThan(0);
    expect(apiConflicts[0].severity).toBe('warning');
  });

  it('does not flag when blocker is already resolved', () => {
    const { eventStore, registry, detector } = createTestSetup();
    registry.registerSession('sess-alice', 'proj-test', 'Alice', 'main');
    registry.registerSession('sess-bob', 'proj-test', 'Bob', 'main');

    eventStore.appendEvent({
      event_id: 'blocker-1',
      project_id: 'proj-test',
      session_id: 'sess-bob',
      developer: 'Bob',
      event_type: 'blocker',
      payload: { blocker_id: 'b-001', description: 'Need api contract', waiting_for: 'api definition' },
      created_at: Date.now(),
    });
    eventStore.appendEvent({
      event_id: 'resolved-1',
      project_id: 'proj-test',
      session_id: 'sess-alice',
      developer: 'Alice',
      event_type: 'blocker_resolved',
      payload: { blocker_id: 'b-001', resolution: 'Defined the API' },
      created_at: Date.now(),
    });

    const decisionEvent = makeDecisionEvent({ session_id: 'sess-alice' });
    const conflicts = detector.detect(decisionEvent);
    const apiConflicts = conflicts.filter(c => c.type === 'api_contract');
    expect(apiConflicts).toHaveLength(0);
  });
});
