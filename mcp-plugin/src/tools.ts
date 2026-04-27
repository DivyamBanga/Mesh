import { v4 as uuidv4 } from 'uuid';
import { MeshWsClient } from './ws-client';
import {
  PairEvent,
  ConflictReport,
  IntentPayload,
  FileLockPayload,
  FileUnlockPayload,
  DecisionPayload,
  QuestionPayload,
  AnswerPayload,
  BlockerPayload,
  BlockerResolvedPayload,
  HeartbeatPayload,
  PartnerContext,
} from './types';

export interface PluginConfig {
  project_id: string;
  session_id: string;
  developer_name: string;
  branch: string;
  server_host: string;
  server_port: number;
}

export class MeshTools {
  constructor(
    private client: MeshWsClient,
    private config: PluginConfig
  ) {}

  // ── Helpers ──────────────────────────────────────────────────────────────

  private makeEvent(type: PairEvent['event_type'], payload: PairEvent['payload']): PairEvent {
    return {
      event_id: uuidv4(),
      project_id: this.config.project_id,
      session_id: this.config.session_id,
      developer: this.config.developer_name,
      event_type: type,
      payload,
      created_at: Date.now(),
    };
  }

  /** Send an event, wait for ack or conflict within timeoutMs. */
  private sendAndWait(
    event: PairEvent,
    timeoutMs: number
  ): Promise<{ ack: any; conflicts: ConflictReport[] }> {
    return new Promise((resolve) => {
      const conflicts: ConflictReport[] = [];
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ ack: null, conflicts });
      }, timeoutMs);

      const onConflict = (msg: any) => {
        if (msg.conflicts) conflicts.push(...msg.conflicts);
      };

      const onAck = (msg: any) => {
        if (msg.event_id !== event.event_id) return;
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve({ ack: msg, conflicts });
      };

      const cleanup = () => {
        this.client.off('conflict', onConflict);
        this.client.off('ack', onAck);
      };

      this.client.on('conflict', onConflict);
      this.client.on('ack', onAck);

      this.client.send({ type: 'event', event });
    });
  }

  /** Offline guard: if disconnected, return queued status. */
  private get isOffline(): boolean {
    return this.client.state === 'disconnected';
  }

  // ── Tool implementations ──────────────────────────────────────────────────

  async broadcastIntent(args: {
    description: string;
    files_affected: string[];
    estimated_scope: 'small' | 'medium' | 'large';
    reversible: boolean;
  }) {
    if (this.isOffline) {
      const event = this.makeEvent('intent', args as IntentPayload);
      this.client.send({ type: 'event', event });
      return { status: 'offline', queued: true, event_id: event.event_id, conflicts: [] };
    }

    const event = this.makeEvent('intent', args as IntentPayload);
    const { ack, conflicts } = await this.sendAndWait(event, 5000);
    return { status: 'broadcast', event_id: event.event_id, conflicts };
  }

  async lockFiles(args: {
    paths: string[];
    reason: string;
    exclusive: boolean;
  }) {
    if (this.isOffline) {
      const event = this.makeEvent('file_lock', args as FileLockPayload);
      this.client.send({ type: 'event', event });
      return { status: 'offline', queued: true, paths: args.paths, conflicts: [] };
    }

    const event = this.makeEvent('file_lock', args as FileLockPayload);
    const { ack, conflicts } = await this.sendAndWait(event, 5000);

    if (conflicts.length > 0) {
      return { status: 'conflict', paths: args.paths, conflicts };
    }
    return { status: 'locked', paths: args.paths, conflicts: [] };
  }

  async unlockFiles(args: { paths: string[] }) {
    const event = this.makeEvent('file_unlock', { paths: args.paths } as FileUnlockPayload);
    this.client.send({ type: 'event', event });
    return { status: 'unlocked', paths: args.paths };
  }

  async recordDecision(args: {
    category: DecisionPayload['category'];
    summary: string;
    rationale: string;
    affected_files: string[];
    rejected_alternatives: string[];
  }) {
    const payload: DecisionPayload = { ...args };
    const event = this.makeEvent('decision', payload);
    const decision_id = event.event_id;

    if (this.isOffline) {
      this.client.send({ type: 'event', event });
      return { status: 'offline', queued: true, decision_id };
    }

    await this.sendAndWait(event, 5000);
    return { status: 'recorded', decision_id };
  }

  async askPartner(args: { text: string; context: string; urgent: boolean }) {
    const question_id = uuidv4();
    const payload: QuestionPayload = {
      question_id,
      text: args.text,
      context: args.context,
      urgent: args.urgent,
    };
    const event = this.makeEvent('question', payload);
    this.client.send({ type: 'event', event });

    if (!args.urgent) {
      return { status: 'sent', question_id };
    }

    // Wait for matching answer event from partner
    return new Promise<{ status: string; question_id: string; answer?: string }>((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve({ status: 'timeout', question_id });
      }, 120000);

      const onPeerEvent = (peerEvent: PairEvent) => {
        if (peerEvent.event_type !== 'answer') return;
        const ans = peerEvent.payload as AnswerPayload;
        if (ans.question_id !== question_id) return;
        clearTimeout(timer);
        cleanup();
        resolve({ status: 'answered', question_id, answer: ans.text });
      };

      const cleanup = () => this.client.off('peer_event', onPeerEvent);
      this.client.on('peer_event', onPeerEvent);
    });
  }

  async answerQuestion(args: { question_id: string; answer: string }) {
    const payload: AnswerPayload = { question_id: args.question_id, text: args.answer };
    const event = this.makeEvent('answer', payload);
    this.client.send({ type: 'event', event });
    return { status: 'sent' };
  }

  async declareBlocker(args: { description: string; waiting_for: string }) {
    const blocker_id = uuidv4();
    const payload: BlockerPayload = {
      blocker_id,
      description: args.description,
      waiting_for: args.waiting_for,
    };
    const event = this.makeEvent('blocker', payload);
    this.client.send({ type: 'event', event });
    return { status: 'declared', blocker_id };
  }

  async resolveBlocker(args: { blocker_id: string; resolution: string }) {
    const payload: BlockerResolvedPayload = {
      blocker_id: args.blocker_id,
      resolution: args.resolution,
    };
    const event = this.makeEvent('blocker_resolved', payload);
    this.client.send({ type: 'event', event });
    return { status: 'resolved' };
  }

  async getPartnerContext(): Promise<{ summary: string; contexts: PartnerContext[] }> {
    const url = `http://${this.config.server_host}:${this.config.server_port}/api/project/${this.config.project_id}/context`;

    let contexts: PartnerContext[] = [];
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${(this.client as any)['config']?.auth_token ?? ''}` },
      });
      if (res.ok) {
        const all = (await res.json()) as PartnerContext[];
        contexts = all.filter(c => c.session_id !== this.config.session_id);
      }
    } catch {
      // Server unreachable
    }

    if (contexts.length === 0) {
      return {
        summary: 'No partner sessions currently connected to this project.',
        contexts: [],
      };
    }

    const ts = new Date().toISOString();
    const lines: string[] = [`PARTNER CONTEXT — updated ${ts}`, ''];

    for (const ctx of contexts) {
      lines.push(`[${ctx.developer}] on branch ${ctx.branch}`);
      lines.push(`Status: ${ctx.status}`);
      lines.push(`Currently: ${ctx.current_task || '(none)'}`);
      lines.push(`Active files: ${ctx.active_files.length ? ctx.active_files.join(', ') : '(none)'}`);

      if (ctx.recent_decisions.length) {
        lines.push('Recent decisions:');
        for (const d of ctx.recent_decisions) {
          lines.push(`  - ${d.summary} (${d.category})`);
        }
      }

      const lockPaths = ctx.active_locks.flatMap(l => l.paths);
      lines.push(`Active locks: ${lockPaths.length ? lockPaths.join(', ') : '(none)'}`);

      if (ctx.open_questions.length) {
        lines.push('Open questions:');
        for (const q of ctx.open_questions) {
          lines.push(`  - [${q.question_id}] ${q.text}`);
        }
      }

      if (ctx.open_blockers.length) {
        lines.push('Open blockers:');
        for (const b of ctx.open_blockers) {
          lines.push(`  - [${b.blocker_id}] ${b.description} (waiting for: ${b.waiting_for})`);
        }
      }

      lines.push('');
    }

    return { summary: lines.join('\n'), contexts };
  }

  async sendHeartbeat(args: {
    current_task: string;
    active_files: string[];
    status: HeartbeatPayload['status'];
  }) {
    const payload: HeartbeatPayload = { ...args };
    const event = this.makeEvent('heartbeat', payload);
    this.client.send({ type: 'event', event });
    return { status: 'sent' };
  }
}
