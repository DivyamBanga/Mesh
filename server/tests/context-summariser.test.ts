import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { EventStore } from '../src/event-store';
import { SessionRegistry } from '../src/session-registry';
import { ContextSummariser } from '../src/context-summariser';
import { PairEvent, QuestionPayload, AnswerPayload, BlockerPayload, BlockerResolvedPayload, DecisionPayload } from '../src/types';

function createTestSetup() {
  const db = new Database(':memory:');
  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf-8');
  db.exec(schema);
  const eventStore = EventStore.createFromDb(db);
  const registry = new SessionRegistry(db);
  const summariser = new ContextSummariser(eventStore, registry);
  return { eventStore, registry, summariser };
}

function makeEvent(opts: {
  event_id: string;
  session_id: string;
  event_type: string;
  payload: any;
  project_id?: string;
}): PairEvent {
  return {
    event_id: opts.event_id,
    project_id: opts.project_id ?? 'proj-test',
    session_id: opts.session_id,
    developer: opts.session_id,
    event_type: opts.event_type as any,
    payload: opts.payload,
    created_at: Date.now(),
  };
}

describe('ContextSummariser.buildPartnerContext', () => {
  it('returns empty context for unknown session', () => {
    const { summariser } = createTestSetup();
    const ctx = summariser.buildPartnerContext('nonexistent', 'proj-test');
    expect(ctx.developer).toBe('');
    expect(ctx.open_questions).toHaveLength(0);
  });

  it('includes heartbeat data', () => {
    const { registry, summariser } = createTestSetup();
    registry.registerSession('sess-alice', 'proj-test', 'Alice', 'main');
    registry.updateHeartbeat('sess-alice', {
      current_task: 'Building login',
      active_files: ['src/auth/login.ts'],
      status: 'working',
    });

    const ctx = summariser.buildPartnerContext('sess-alice', 'proj-test');
    expect(ctx.current_task).toBe('Building login');
    expect(ctx.status).toBe('working');
    expect(ctx.active_files).toContain('src/auth/login.ts');
  });

  it('includes last 5 decisions', () => {
    const { eventStore, registry, summariser } = createTestSetup();
    registry.registerSession('sess-alice', 'proj-test', 'Alice', 'main');

    for (let i = 0; i < 7; i++) {
      eventStore.appendEvent(makeEvent({
        event_id: `dec-${i}`,
        session_id: 'sess-alice',
        event_type: 'decision',
        payload: {
          category: 'architecture',
          summary: `Decision ${i}`,
          rationale: 'test',
          affected_files: [],
          rejected_alternatives: [],
        } as DecisionPayload,
      }));
    }

    const ctx = summariser.buildPartnerContext('sess-alice', 'proj-test');
    expect(ctx.recent_decisions).toHaveLength(5);
  });

  it('open_questions excludes answered questions', () => {
    const { eventStore, registry, summariser } = createTestSetup();
    registry.registerSession('sess-alice', 'proj-test', 'Alice', 'main');

    // Two questions
    eventStore.appendEvent(makeEvent({
      event_id: 'q1',
      session_id: 'sess-alice',
      event_type: 'question',
      payload: { question_id: 'qid-1', text: 'What auth?', context: '', urgent: false } as QuestionPayload,
    }));
    eventStore.appendEvent(makeEvent({
      event_id: 'q2',
      session_id: 'sess-alice',
      event_type: 'question',
      payload: { question_id: 'qid-2', text: 'DB choice?', context: '', urgent: false } as QuestionPayload,
    }));

    // Answer only the first
    eventStore.appendEvent(makeEvent({
      event_id: 'a1',
      session_id: 'sess-bob',
      event_type: 'answer',
      payload: { question_id: 'qid-1', text: 'JWT' } as AnswerPayload,
    }));

    const ctx = summariser.buildPartnerContext('sess-alice', 'proj-test');
    expect(ctx.open_questions).toHaveLength(1);
    expect(ctx.open_questions[0].question_id).toBe('qid-2');
  });

  it('open_blockers excludes resolved blockers', () => {
    const { eventStore, registry, summariser } = createTestSetup();
    registry.registerSession('sess-alice', 'proj-test', 'Alice', 'main');

    eventStore.appendEvent(makeEvent({
      event_id: 'b1',
      session_id: 'sess-alice',
      event_type: 'blocker',
      payload: { blocker_id: 'bid-1', description: 'Waiting for schema', waiting_for: 'schema.sql' } as BlockerPayload,
    }));
    eventStore.appendEvent(makeEvent({
      event_id: 'b2',
      session_id: 'sess-alice',
      event_type: 'blocker',
      payload: { blocker_id: 'bid-2', description: 'Waiting for API', waiting_for: 'api.ts' } as BlockerPayload,
    }));

    // Resolve only bid-1
    eventStore.appendEvent(makeEvent({
      event_id: 'br1',
      session_id: 'sess-bob',
      event_type: 'blocker_resolved',
      payload: { blocker_id: 'bid-1', resolution: 'Schema committed' } as BlockerResolvedPayload,
    }));

    const ctx = summariser.buildPartnerContext('sess-alice', 'proj-test');
    expect(ctx.open_blockers).toHaveLength(1);
    expect(ctx.open_blockers[0].blocker_id).toBe('bid-2');
  });

  it('includes active file locks for this session', () => {
    const { eventStore, registry, summariser } = createTestSetup();
    registry.registerSession('sess-alice', 'proj-test', 'Alice', 'main');
    eventStore.acquireFileLock('src/a.ts', 'proj-test', 'sess-alice', 'Alice', 'Working', true);
    eventStore.acquireFileLock('src/b.ts', 'proj-test', 'sess-alice', 'Alice', 'Working', true);

    const ctx = summariser.buildPartnerContext('sess-alice', 'proj-test');
    expect(ctx.active_locks).toHaveLength(2);
  });
});

describe('ContextSummariser.buildProjectSummary', () => {
  it('returns context for all sessions in the project', () => {
    const { registry, summariser } = createTestSetup();
    registry.registerSession('sess-alice', 'proj-test', 'Alice', 'main');
    registry.registerSession('sess-bob', 'proj-test', 'Bob', 'feature/auth');
    registry.registerSession('sess-carol', 'proj-other', 'Carol', 'main');

    const summary = summariser.buildProjectSummary('proj-test');
    expect(summary).toHaveLength(2);
    expect(summary.map(s => s.developer).sort()).toEqual(['Alice', 'Bob']);
  });

  it('returns empty array for project with no sessions', () => {
    const { summariser } = createTestSetup();
    expect(summariser.buildProjectSummary('proj-empty')).toHaveLength(0);
  });
});
