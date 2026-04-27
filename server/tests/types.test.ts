import {
  EventType,
  PairEvent,
  IntentPayload,
  FileLockPayload,
  FileUnlockPayload,
  DecisionPayload,
  QuestionPayload,
  AnswerPayload,
  BlockerPayload,
  BlockerResolvedPayload,
  HeartbeatPayload,
  ConflictReport,
  PartnerContext,
} from '../src/types';

// These tests verify the structural integrity of type definitions by constructing
// valid objects and confirming TypeScript accepts them. Runtime checks validate
// that expected field shapes are present.

describe('EventType union', () => {
  const validTypes: EventType[] = [
    'intent',
    'file_lock',
    'file_unlock',
    'decision',
    'question',
    'answer',
    'blocker',
    'blocker_resolved',
    'heartbeat',
  ];

  it('includes all 9 expected event types', () => {
    expect(validTypes).toHaveLength(9);
  });

  it('contains every required type', () => {
    expect(validTypes).toContain('intent');
    expect(validTypes).toContain('file_lock');
    expect(validTypes).toContain('file_unlock');
    expect(validTypes).toContain('decision');
    expect(validTypes).toContain('question');
    expect(validTypes).toContain('answer');
    expect(validTypes).toContain('blocker');
    expect(validTypes).toContain('blocker_resolved');
    expect(validTypes).toContain('heartbeat');
  });
});

describe('IntentPayload', () => {
  it('accepts valid small intent', () => {
    const p: IntentPayload = {
      description: 'Refactor auth module',
      files_affected: ['src/auth/index.ts'],
      estimated_scope: 'small',
      reversible: true,
    };
    expect(p.estimated_scope).toBe('small');
    expect(p.reversible).toBe(true);
    expect(Array.isArray(p.files_affected)).toBe(true);
  });

  it('accepts all scope values', () => {
    const scopes: IntentPayload['estimated_scope'][] = ['small', 'medium', 'large'];
    scopes.forEach((s) => {
      const p: IntentPayload = {
        description: 'test',
        files_affected: [],
        estimated_scope: s,
        reversible: false,
      };
      expect(p.estimated_scope).toBe(s);
    });
  });
});

describe('FileLockPayload', () => {
  it('accepts valid lock payload', () => {
    const p: FileLockPayload = {
      paths: ['src/api/routes.ts', 'src/api/types.ts'],
      reason: 'Rewriting API routes',
      exclusive: true,
    };
    expect(p.paths).toHaveLength(2);
    expect(p.exclusive).toBe(true);
  });
});

describe('FileUnlockPayload', () => {
  it('accepts valid unlock payload', () => {
    const p: FileUnlockPayload = { paths: ['src/api/routes.ts'] };
    expect(p.paths).toHaveLength(1);
  });
});

describe('DecisionPayload', () => {
  const categories: DecisionPayload['category'][] = [
    'architecture',
    'library',
    'api_contract',
    'pattern',
    'naming',
    'other',
  ];

  it('accepts all valid categories', () => {
    categories.forEach((cat) => {
      const p: DecisionPayload = {
        category: cat,
        summary: 'Use Zod for validation',
        rationale: 'Type-safe, composable schemas',
        affected_files: ['src/validators/index.ts'],
        rejected_alternatives: ['Joi', 'Yup'],
      };
      expect(p.category).toBe(cat);
    });
  });

  it('stores rejected alternatives', () => {
    const p: DecisionPayload = {
      category: 'library',
      summary: 'Use Zod',
      rationale: 'Better TS support',
      affected_files: [],
      rejected_alternatives: ['Joi', 'Yup'],
    };
    expect(p.rejected_alternatives).toEqual(['Joi', 'Yup']);
  });
});

describe('QuestionPayload', () => {
  it('accepts urgent question', () => {
    const p: QuestionPayload = {
      question_id: 'q-001',
      text: 'What auth strategy are you using?',
      context: 'Building the API gateway',
      urgent: true,
    };
    expect(p.urgent).toBe(true);
    expect(p.question_id).toBe('q-001');
  });
});

describe('AnswerPayload', () => {
  it('links answer to question via question_id', () => {
    const p: AnswerPayload = {
      question_id: 'q-001',
      text: 'JWT with RS256',
    };
    expect(p.question_id).toBe('q-001');
  });
});

describe('BlockerPayload', () => {
  it('accepts valid blocker', () => {
    const p: BlockerPayload = {
      blocker_id: 'b-001',
      description: 'Waiting for DB schema',
      waiting_for: 'migrations/001_init.sql',
    };
    expect(p.blocker_id).toBe('b-001');
  });
});

describe('BlockerResolvedPayload', () => {
  it('references original blocker', () => {
    const p: BlockerResolvedPayload = {
      blocker_id: 'b-001',
      resolution: 'Schema was committed',
    };
    expect(p.blocker_id).toBe('b-001');
  });
});

describe('HeartbeatPayload', () => {
  const statuses: HeartbeatPayload['status'][] = ['working', 'thinking', 'waiting', 'idle'];

  it('accepts all valid status values', () => {
    statuses.forEach((status) => {
      const p: HeartbeatPayload = {
        current_task: 'Building auth module',
        active_files: ['src/auth/index.ts'],
        status,
      };
      expect(p.status).toBe(status);
    });
  });
});

describe('PairEvent', () => {
  it('constructs a valid intent event', () => {
    const payload: IntentPayload = {
      description: 'Add login endpoint',
      files_affected: ['src/routes/auth.ts'],
      estimated_scope: 'medium',
      reversible: true,
    };
    const event: PairEvent = {
      event_id: 'evt-001',
      project_id: 'proj-abc',
      session_id: 'sess-xyz',
      developer: 'Alice',
      event_type: 'intent',
      payload,
      created_at: Date.now(),
    };
    expect(event.event_type).toBe('intent');
    expect((event.payload as IntentPayload).description).toBe('Add login endpoint');
  });

  it('constructs a valid decision event', () => {
    const payload: DecisionPayload = {
      category: 'architecture',
      summary: 'Use hexagonal architecture',
      rationale: 'Better testability',
      affected_files: ['src/'],
      rejected_alternatives: ['MVC'],
    };
    const event: PairEvent = {
      event_id: 'evt-002',
      project_id: 'proj-abc',
      session_id: 'sess-xyz',
      developer: 'Bob',
      event_type: 'decision',
      payload,
      created_at: Date.now(),
    };
    expect(event.event_type).toBe('decision');
  });
});

describe('ConflictReport', () => {
  it('accepts file_overlap critical conflict', () => {
    const report: ConflictReport = {
      conflict_id: 'conf-001',
      type: 'file_overlap',
      severity: 'critical',
      description: 'Both sessions are editing src/auth/index.ts',
      sessions_involved: ['sess-a', 'sess-b'],
      files_involved: ['src/auth/index.ts'],
      recommendation: 'Coordinate before proceeding',
    };
    expect(report.type).toBe('file_overlap');
    expect(report.severity).toBe('critical');
  });

  it('accepts intent_semantic warning', () => {
    const report: ConflictReport = {
      conflict_id: 'conf-002',
      type: 'intent_semantic',
      severity: 'warning',
      description: 'Semantic overlap detected on AuthService',
      sessions_involved: ['sess-a', 'sess-b'],
      files_involved: [],
      recommendation: 'Check for duplication',
    };
    expect(report.type).toBe('intent_semantic');
    expect(report.severity).toBe('warning');
  });

  it('accepts api_contract type', () => {
    const report: ConflictReport = {
      conflict_id: 'conf-003',
      type: 'api_contract',
      severity: 'warning',
      description: 'API contract can resolve blocker',
      sessions_involved: ['sess-a'],
      files_involved: [],
      recommendation: 'Share the contract',
    };
    expect(report.type).toBe('api_contract');
  });
});

describe('PartnerContext', () => {
  it('constructs a complete partner context', () => {
    const ctx: PartnerContext = {
      developer: 'Alice',
      session_id: 'sess-alice',
      branch: 'feature/auth',
      current_task: 'Building login flow',
      active_files: ['src/auth/login.ts'],
      status: 'working',
      recent_decisions: [],
      active_locks: [],
      open_questions: [],
      open_blockers: [],
      last_updated: Date.now(),
    };
    expect(ctx.developer).toBe('Alice');
    expect(ctx.branch).toBe('feature/auth');
    expect(Array.isArray(ctx.recent_decisions)).toBe(true);
  });
});
