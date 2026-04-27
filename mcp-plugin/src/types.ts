export type EventType =
  | 'intent'
  | 'file_lock'
  | 'file_unlock'
  | 'decision'
  | 'question'
  | 'answer'
  | 'blocker'
  | 'blocker_resolved'
  | 'heartbeat';

export interface PairEvent {
  event_id: string;
  project_id: string;
  session_id: string;
  developer: string;
  event_type: EventType;
  payload: EventPayload;
  created_at: number;
}

export type EventPayload =
  | IntentPayload
  | FileLockPayload
  | FileUnlockPayload
  | DecisionPayload
  | QuestionPayload
  | AnswerPayload
  | BlockerPayload
  | BlockerResolvedPayload
  | HeartbeatPayload;

export interface IntentPayload {
  description: string;
  files_affected: string[];
  estimated_scope: 'small' | 'medium' | 'large';
  reversible: boolean;
}

export interface FileLockPayload {
  paths: string[];
  reason: string;
  exclusive: boolean;
}

export interface FileUnlockPayload {
  paths: string[];
}

export interface DecisionPayload {
  category: 'architecture' | 'library' | 'api_contract' | 'pattern' | 'naming' | 'other';
  summary: string;
  rationale: string;
  affected_files: string[];
  rejected_alternatives: string[];
}

export interface QuestionPayload {
  question_id: string;
  text: string;
  context: string;
  urgent: boolean;
}

export interface AnswerPayload {
  question_id: string;
  text: string;
}

export interface BlockerPayload {
  blocker_id: string;
  description: string;
  waiting_for: string;
}

export interface BlockerResolvedPayload {
  blocker_id: string;
  resolution: string;
}

export interface HeartbeatPayload {
  current_task: string;
  active_files: string[];
  status: 'working' | 'thinking' | 'waiting' | 'idle';
}

export interface ConflictReport {
  conflict_id: string;
  type: 'file_overlap' | 'intent_semantic' | 'api_contract';
  severity: 'warning' | 'critical';
  description: string;
  sessions_involved: string[];
  files_involved: string[];
  recommendation: string;
}

export interface PartnerContext {
  developer: string;
  session_id: string;
  branch: string;
  current_task: string;
  active_files: string[];
  status: string;
  recent_decisions: DecisionPayload[];
  active_locks: FileLockPayload[];
  open_questions: QuestionPayload[];
  open_blockers: BlockerPayload[];
  last_updated: number;
}
