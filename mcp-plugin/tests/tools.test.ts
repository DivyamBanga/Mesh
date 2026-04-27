import { EventEmitter } from 'events';
import { MeshTools, PluginConfig } from '../src/tools';
import { MeshWsClient } from '../src/ws-client';
import { PairEvent, IntentPayload, FileLockPayload, DecisionPayload, AnswerPayload, ConflictReport } from '../src/types';

// ── Stub client ───────────────────────────────────────────────────────────────

class StubClient extends EventEmitter {
  public sent: any[] = [];
  public _state: 'connected' | 'connecting' | 'disconnected' = 'connected';

  get state() { return this._state; }

  send(msg: any) {
    this.sent.push(msg);
  }

  lastSent(): any {
    return this.sent[this.sent.length - 1];
  }

  /** Simulate the server sending an ack for the last event. */
  ackLast() {
    const last = this.lastSent();
    if (last?.event?.event_id) {
      this.emit('ack', { type: 'ack', event_id: last.event.event_id });
    }
  }

  /** Simulate a conflict arriving. */
  sendConflict(conflicts: ConflictReport[]) {
    this.emit('conflict', { type: 'conflict', conflicts });
  }
}

const config: PluginConfig = {
  project_id: 'proj-test',
  session_id: 'sess-alice',
  developer_name: 'Alice',
  branch: 'main',
  server_host: 'localhost',
  server_port: 3747,
};

function makeTools(client: StubClient): MeshTools {
  return new MeshTools(client as unknown as MeshWsClient, config);
}

// ── mesh_broadcast_intent ─────────────────────────────────────────────────────

describe('MeshTools.broadcastIntent', () => {
  it('constructs correct IntentPayload and sends event', async () => {
    const client = new StubClient();
    const tools = makeTools(client);

    // Trigger ack after send
    client.on('newListener', () => {});
    setImmediate(() => client.ackLast());

    const result = await tools.broadcastIntent({
      description: 'Refactor auth module',
      files_affected: ['src/auth/index.ts'],
      estimated_scope: 'medium',
      reversible: true,
    });

    const sent = client.sent[0];
    expect(sent.type).toBe('event');
    expect(sent.event.event_type).toBe('intent');

    const payload = sent.event.payload as IntentPayload;
    expect(payload.description).toBe('Refactor auth module');
    expect(payload.files_affected).toEqual(['src/auth/index.ts']);
    expect(payload.estimated_scope).toBe('medium');
    expect(payload.reversible).toBe(true);

    expect(result.status).toBe('broadcast');
    expect(result.event_id).toBeDefined();
    expect(result.conflicts).toEqual([]);
  });

  it('returns conflicts when conflict arrives before ack', async () => {
    const client = new StubClient();
    const tools = makeTools(client);

    const fakeConflict: ConflictReport = {
      conflict_id: 'c1',
      type: 'file_overlap',
      severity: 'critical',
      description: 'File is locked',
      sessions_involved: ['sess-bob'],
      files_involved: ['src/auth/index.ts'],
      recommendation: 'Coordinate first',
    };

    // Emit conflict then ack
    setImmediate(() => {
      client.sendConflict([fakeConflict]);
      client.ackLast();
    });

    const result = await tools.broadcastIntent({
      description: 'Refactor auth',
      files_affected: ['src/auth/index.ts'],
      estimated_scope: 'small',
      reversible: true,
    });

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].severity).toBe('critical');
  });

  it('returns offline status when disconnected', async () => {
    const client = new StubClient();
    client._state = 'disconnected';
    const tools = makeTools(client);

    const result = await tools.broadcastIntent({
      description: 'test',
      files_affected: [],
      estimated_scope: 'small',
      reversible: true,
    });

    expect(result.status).toBe('offline');
    expect((result as any).queued).toBe(true);
  });

  it('resolves after timeout (5s) with empty conflicts', async () => {
    jest.useFakeTimers();
    const client = new StubClient();
    const tools = makeTools(client);

    const promise = tools.broadcastIntent({
      description: 'test timeout',
      files_affected: [],
      estimated_scope: 'small',
      reversible: false,
    });

    jest.advanceTimersByTime(5001);
    const result = await promise;

    expect(result.status).toBe('broadcast');
    expect(result.conflicts).toEqual([]);
    jest.useRealTimers();
  }, 10000);
});

// ── mesh_lock_files ───────────────────────────────────────────────────────────

describe('MeshTools.lockFiles', () => {
  it('constructs correct FileLockPayload', async () => {
    const client = new StubClient();
    const tools = makeTools(client);
    setImmediate(() => client.ackLast());

    await tools.lockFiles({ paths: ['src/api/routes.ts'], reason: 'Editing', exclusive: true });

    const sent = client.sent[0];
    expect(sent.event.event_type).toBe('file_lock');
    const payload = sent.event.payload as FileLockPayload;
    expect(payload.paths).toEqual(['src/api/routes.ts']);
    expect(payload.exclusive).toBe(true);
  });

  it('returns locked status on success', async () => {
    const client = new StubClient();
    const tools = makeTools(client);
    setImmediate(() => client.ackLast());

    const result = await tools.lockFiles({ paths: ['src/a.ts'], reason: 'test', exclusive: false });
    expect(result.status).toBe('locked');
  });

  it('returns conflict status when conflict received', async () => {
    const client = new StubClient();
    const tools = makeTools(client);

    setImmediate(() => {
      client.sendConflict([{
        conflict_id: 'c2',
        type: 'file_overlap',
        severity: 'critical',
        description: 'locked',
        sessions_involved: ['sess-bob'],
        files_involved: ['src/a.ts'],
        recommendation: 'wait',
      }]);
      client.ackLast();
    });

    const result = await tools.lockFiles({ paths: ['src/a.ts'], reason: 'test', exclusive: true });
    expect(result.status).toBe('conflict');
    expect(result.conflicts).toHaveLength(1);
  });
});

// ── mesh_unlock_files ─────────────────────────────────────────────────────────

describe('MeshTools.unlockFiles', () => {
  it('sends file_unlock event', async () => {
    const client = new StubClient();
    const tools = makeTools(client);

    const result = await tools.unlockFiles({ paths: ['src/a.ts', 'src/b.ts'] });

    const sent = client.sent[0];
    expect(sent.event.event_type).toBe('file_unlock');
    expect(sent.event.payload.paths).toEqual(['src/a.ts', 'src/b.ts']);
    expect(result.status).toBe('unlocked');
  });
});

// ── mesh_record_decision ──────────────────────────────────────────────────────

describe('MeshTools.recordDecision', () => {
  it('constructs correct DecisionPayload', async () => {
    const client = new StubClient();
    const tools = makeTools(client);
    setImmediate(() => client.ackLast());

    const result = await tools.recordDecision({
      category: 'architecture',
      summary: 'Use hexagonal architecture',
      rationale: 'Better testability',
      affected_files: ['src/'],
      rejected_alternatives: ['MVC'],
    });

    const sent = client.sent[0];
    expect(sent.event.event_type).toBe('decision');
    const payload = sent.event.payload as DecisionPayload;
    expect(payload.category).toBe('architecture');
    expect(payload.rejected_alternatives).toEqual(['MVC']);
    expect(result.status).toBe('recorded');
    expect(result.decision_id).toBeDefined();
  });
});

// ── mesh_ask_partner ──────────────────────────────────────────────────────────

describe('MeshTools.askPartner', () => {
  it('returns sent status immediately when not urgent', async () => {
    const client = new StubClient();
    const tools = makeTools(client);

    const result = await tools.askPartner({ text: 'What DB?', context: '', urgent: false });
    expect(result.status).toBe('sent');
    expect(result.question_id).toBeDefined();

    const sent = client.sent[0];
    expect(sent.event.event_type).toBe('question');
    expect(sent.event.payload.urgent).toBe(false);
  });

  it('blocks until matching answer when urgent', async () => {
    const client = new StubClient();
    const tools = makeTools(client);

    // Send the answer after a short delay
    const promise = tools.askPartner({ text: 'What auth strategy?', context: '', urgent: true });

    setImmediate(() => {
      const sent = client.sent[0];
      const question_id = sent.event.payload.question_id;

      const answerEvent: PairEvent = {
        event_id: 'evt-ans',
        project_id: 'proj-test',
        session_id: 'sess-bob',
        developer: 'Bob',
        event_type: 'answer',
        payload: { question_id, text: 'JWT with RS256' } as AnswerPayload,
        created_at: Date.now(),
      };
      client.emit('peer_event', answerEvent);
    });

    const result = await promise;
    expect(result.status).toBe('answered');
    expect(result.answer).toBe('JWT with RS256');
  });

  it('returns timeout after 120s when urgent and no answer', async () => {
    jest.useFakeTimers();
    const client = new StubClient();
    const tools = makeTools(client);

    const promise = tools.askPartner({ text: 'Question', context: '', urgent: true });
    jest.advanceTimersByTime(120001);
    const result = await promise;

    expect(result.status).toBe('timeout');
    jest.useRealTimers();
  }, 15000);

  it('ignores answer events for different question_id', async () => {
    const client = new StubClient();
    const tools = makeTools(client);

    const promise = tools.askPartner({ text: 'My question', context: '', urgent: true });

    setImmediate(() => {
      // Wrong question_id
      const wrongAnswer: PairEvent = {
        event_id: 'evt-ans-wrong',
        project_id: 'proj-test',
        session_id: 'sess-bob',
        developer: 'Bob',
        event_type: 'answer',
        payload: { question_id: 'different-qid', text: 'Not for you' } as AnswerPayload,
        created_at: Date.now(),
      };
      client.emit('peer_event', wrongAnswer);

      // Correct answer shortly after
      const sent = client.sent[0];
      const question_id = sent.event.payload.question_id;
      const rightAnswer: PairEvent = {
        event_id: 'evt-ans-right',
        project_id: 'proj-test',
        session_id: 'sess-bob',
        developer: 'Bob',
        event_type: 'answer',
        payload: { question_id, text: 'Correct answer' } as AnswerPayload,
        created_at: Date.now(),
      };
      client.emit('peer_event', rightAnswer);
    });

    const result = await promise;
    expect(result.answer).toBe('Correct answer');
  });
});

// ── mesh_answer_question ──────────────────────────────────────────────────────

describe('MeshTools.answerQuestion', () => {
  it('sends answer event with correct payload', async () => {
    const client = new StubClient();
    const tools = makeTools(client);

    const result = await tools.answerQuestion({ question_id: 'qid-1', answer: 'Use JWT' });

    const sent = client.sent[0];
    expect(sent.event.event_type).toBe('answer');
    expect(sent.event.payload.question_id).toBe('qid-1');
    expect(sent.event.payload.text).toBe('Use JWT');
    expect(result.status).toBe('sent');
  });
});

// ── mesh_declare_blocker ──────────────────────────────────────────────────────

describe('MeshTools.declareBlocker', () => {
  it('sends blocker event and returns blocker_id', async () => {
    const client = new StubClient();
    const tools = makeTools(client);

    const result = await tools.declareBlocker({
      description: 'Waiting for DB schema',
      waiting_for: 'migrations/001_init.sql',
    });

    const sent = client.sent[0];
    expect(sent.event.event_type).toBe('blocker');
    expect(sent.event.payload.description).toBe('Waiting for DB schema');
    expect(result.status).toBe('declared');
    expect(result.blocker_id).toBeDefined();
  });
});

// ── mesh_resolve_blocker ──────────────────────────────────────────────────────

describe('MeshTools.resolveBlocker', () => {
  it('sends blocker_resolved event', async () => {
    const client = new StubClient();
    const tools = makeTools(client);

    const result = await tools.resolveBlocker({ blocker_id: 'b-001', resolution: 'Schema merged' });

    const sent = client.sent[0];
    expect(sent.event.event_type).toBe('blocker_resolved');
    expect(sent.event.payload.blocker_id).toBe('b-001');
    expect(sent.event.payload.resolution).toBe('Schema merged');
    expect(result.status).toBe('resolved');
  });
});

// ── mesh_heartbeat ────────────────────────────────────────────────────────────

describe('MeshTools.sendHeartbeat', () => {
  it('sends heartbeat event with correct payload', async () => {
    const client = new StubClient();
    const tools = makeTools(client);

    const result = await tools.sendHeartbeat({
      current_task: 'Building auth module',
      active_files: ['src/auth/index.ts'],
      status: 'working',
    });

    const sent = client.sent[0];
    expect(sent.event.event_type).toBe('heartbeat');
    expect(sent.event.payload.status).toBe('working');
    expect(sent.event.payload.current_task).toBe('Building auth module');
    expect(result.status).toBe('sent');
  });

  it('includes correct session and project metadata on all events', async () => {
    const client = new StubClient();
    const tools = makeTools(client);

    await tools.sendHeartbeat({ current_task: 'test', active_files: [], status: 'idle' });

    const sent = client.sent[0];
    expect(sent.event.session_id).toBe('sess-alice');
    expect(sent.event.project_id).toBe('proj-test');
    expect(sent.event.developer).toBe('Alice');
  });
});
