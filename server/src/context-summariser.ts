import { EventStore } from './event-store';
import { SessionRegistry } from './session-registry';
import {
  PairEvent,
  PartnerContext,
  DecisionPayload,
  FileLockPayload,
  QuestionPayload,
  AnswerPayload,
  BlockerPayload,
  BlockerResolvedPayload,
  HeartbeatPayload,
} from './types';

export class ContextSummariser {
  constructor(
    private eventStore: EventStore,
    private sessionRegistry: SessionRegistry
  ) {}

  buildPartnerContext(sessionId: string, projectId: string): PartnerContext {
    const session = this.sessionRegistry.getSession(sessionId);
    if (!session) {
      return {
        developer: '',
        session_id: sessionId,
        branch: '',
        current_task: '',
        active_files: [],
        status: 'idle',
        recent_decisions: [],
        active_locks: [],
        open_questions: [],
        open_blockers: [],
        last_updated: Date.now(),
      };
    }

    // Most recent heartbeat
    const heartbeat = session.heartbeat;

    // Last 5 decisions from this session
    const decisionEvents = this.eventStore.getRecentEvents(projectId, 200, ['decision'])
      .filter(e => e.session_id === sessionId)
      .slice(-5);
    const recent_decisions = decisionEvents.map(e => e.payload as DecisionPayload);

    // Active locks for this session
    const allLocks = this.eventStore.getFileLocks(projectId);
    const sessionLocks = allLocks.filter(l => l.session_id === sessionId);
    const active_locks: FileLockPayload[] = sessionLocks.map(l => ({
      paths: [l.path],
      reason: l.reason,
      exclusive: true,
    }));

    // Open questions (no matching answer)
    const questionEvents = this.eventStore.getRecentEvents(projectId, 500, ['question'])
      .filter(e => e.session_id === sessionId);
    const answerEvents = this.eventStore.getRecentEvents(projectId, 500, ['answer']);
    const answeredIds = new Set(answerEvents.map(e => (e.payload as AnswerPayload).question_id));
    const open_questions = questionEvents
      .filter(e => !answeredIds.has((e.payload as QuestionPayload).question_id))
      .map(e => e.payload as QuestionPayload);

    // Open blockers (no matching resolved)
    const blockerEvents = this.eventStore.getRecentEvents(projectId, 500, ['blocker'])
      .filter(e => e.session_id === sessionId);
    const resolvedEvents = this.eventStore.getRecentEvents(projectId, 500, ['blocker_resolved']);
    const resolvedIds = new Set(resolvedEvents.map(e => (e.payload as BlockerResolvedPayload).blocker_id));
    const open_blockers = blockerEvents
      .filter(e => !resolvedIds.has((e.payload as BlockerPayload).blocker_id))
      .map(e => e.payload as BlockerPayload);

    return {
      developer: session.developer_name,
      session_id: sessionId,
      branch: session.branch,
      current_task: heartbeat?.current_task ?? '',
      active_files: heartbeat?.active_files ?? [],
      status: heartbeat?.status ?? 'idle',
      recent_decisions,
      active_locks,
      open_questions,
      open_blockers,
      last_updated: session.last_seen,
    };
  }

  buildProjectSummary(projectId: string): PartnerContext[] {
    const sessions = this.sessionRegistry.getSessionsForProject(projectId);
    return sessions.map(s => this.buildPartnerContext(s.session_id, projectId));
  }
}
