import { v4 as uuidv4 } from 'uuid';
import {
  PairEvent,
  ConflictReport,
  IntentPayload,
  FileLockPayload,
  HeartbeatPayload,
  BlockerPayload,
  DecisionPayload,
} from './types';
import { EventStore } from './event-store';
import { SessionRegistry } from './session-registry';

const IDENTIFIER_REGEX = /[A-Z][a-zA-Z]+|[a-z][a-zA-Z]{3,}(?:Service|Controller|Module|Handler|Manager|Client|Store|Repository)/g;

export class ConflictDetector {
  // projectId -> last 10 intent events
  private intentWindow: Map<string, PairEvent[]> = new Map();

  constructor(
    private eventStore: EventStore,
    private sessionRegistry: SessionRegistry
  ) {}

  detect(event: PairEvent): ConflictReport[] {
    const conflicts: ConflictReport[] = [];

    if (event.event_type === 'intent' || event.event_type === 'file_lock') {
      conflicts.push(...this.detectFileOverlap(event));
    }

    if (event.event_type === 'intent') {
      conflicts.push(...this.detectSemanticConflict(event));
      this.updateIntentWindow(event);
    }

    if (event.event_type === 'decision') {
      const payload = event.payload as DecisionPayload;
      if (payload.category === 'api_contract') {
        conflicts.push(...this.detectApiContractOpportunity(event));
      }
    }

    return conflicts;
  }

  private detectFileOverlap(event: PairEvent): ConflictReport[] {
    const conflicts: ConflictReport[] = [];
    const existingLocks = this.eventStore.getFileLocks(event.project_id);
    const locksByOthers = existingLocks.filter(l => l.session_id !== event.session_id);

    // Get files from this event
    let incomingFiles: string[] = [];
    if (event.event_type === 'intent') {
      incomingFiles = (event.payload as IntentPayload).files_affected;
    } else if (event.event_type === 'file_lock') {
      incomingFiles = (event.payload as FileLockPayload).paths;
    }

    if (incomingFiles.length === 0) return [];

    // Check against formal locks
    for (const lock of locksByOthers) {
      if (incomingFiles.includes(lock.path)) {
        conflicts.push({
          conflict_id: uuidv4(),
          type: 'file_overlap',
          severity: 'critical',
          description: `File "${lock.path}" is locked by ${lock.developer}. Reason: ${lock.reason}`,
          sessions_involved: [event.session_id, lock.session_id],
          files_involved: [lock.path],
          recommendation: `Coordinate with ${lock.developer} before editing this file.`,
        });
      }
    }

    // Check against heartbeat active_files (warning only, no formal lock)
    const lockedPaths = new Set(existingLocks.map(l => l.path));
    const partners = this.sessionRegistry.getConnectedSessionsForProject(event.project_id)
      .filter(s => s.session_id !== event.session_id);

    for (const partner of partners) {
      if (!partner.heartbeat) continue;
      for (const activeFile of partner.heartbeat.active_files) {
        if (incomingFiles.includes(activeFile) && !lockedPaths.has(activeFile)) {
          conflicts.push({
            conflict_id: uuidv4(),
            type: 'file_overlap',
            severity: 'warning',
            description: `File "${activeFile}" is in ${partner.developer_name}'s active working set (no formal lock).`,
            sessions_involved: [event.session_id, partner.session_id],
            files_involved: [activeFile],
            recommendation: `Consider checking with ${partner.developer_name} before editing.`,
          });
        }
      }
    }

    return conflicts;
  }

  private detectSemanticConflict(event: PairEvent): ConflictReport[] {
    const conflicts: ConflictReport[] = [];
    const incomingDescription = (event.payload as IntentPayload).description;
    const incomingIdentifiers = new Set(incomingDescription.match(IDENTIFIER_REGEX) ?? []);

    if (incomingIdentifiers.size === 0) return [];

    const window = this.intentWindow.get(event.project_id) ?? [];
    const partnersIntents = window.filter(e => e.session_id !== event.session_id);

    for (const partnerEvent of partnersIntents) {
      const partnerDesc = (partnerEvent.payload as IntentPayload).description;
      const partnerIdentifiers = new Set(partnerDesc.match(IDENTIFIER_REGEX) ?? []);

      const overlap = [...incomingIdentifiers].filter(id => partnerIdentifiers.has(id));
      if (overlap.length > 0) {
        const partnerSession = this.sessionRegistry.getSession(partnerEvent.session_id);
        const partnerName = partnerSession?.developer_name ?? partnerEvent.developer;
        conflicts.push({
          conflict_id: uuidv4(),
          type: 'intent_semantic',
          severity: 'warning',
          description: `Semantic overlap with ${partnerName}'s recent intent. Shared identifiers: ${overlap.join(', ')}`,
          sessions_involved: [event.session_id, partnerEvent.session_id],
          files_involved: [],
          recommendation: `Check if you are building the same thing as ${partnerName}.`,
        });
      }
    }

    return conflicts;
  }

  private detectApiContractOpportunity(event: PairEvent): ConflictReport[] {
    const conflicts: ConflictReport[] = [];
    const decisionPayload = event.payload as DecisionPayload;

    const recentEvents = this.eventStore.getRecentEvents(event.project_id, 200, ['blocker']);
    const resolvedIds = new Set(
      this.eventStore.getRecentEvents(event.project_id, 200, ['blocker_resolved'])
        .map(e => (e.payload as any).blocker_id)
    );

    const openBlockers = recentEvents.filter(e =>
      e.session_id !== event.session_id &&
      !resolvedIds.has((e.payload as any).blocker_id)
    );

    for (const blockerEvent of openBlockers) {
      const blockerPayload = blockerEvent.payload as any;
      const waitingFor: string = blockerPayload.waiting_for ?? '';
      // Simple keyword match: if blocker mentions 'api' or 'contract' and the decision summary/rationale share keywords
      const decisionText = `${decisionPayload.summary} ${decisionPayload.rationale}`.toLowerCase();
      if (waitingFor.toLowerCase().includes('api') || decisionText.includes('api')) {
        const partnerSession = this.sessionRegistry.getSession(blockerEvent.session_id);
        const partnerName = partnerSession?.developer_name ?? blockerEvent.developer;
        conflicts.push({
          conflict_id: uuidv4(),
          type: 'api_contract',
          severity: 'warning',
          description: `Your API contract decision may resolve ${partnerName}'s blocker: "${blockerPayload.description}"`,
          sessions_involved: [event.session_id, blockerEvent.session_id],
          files_involved: decisionPayload.affected_files,
          recommendation: `Notify ${partnerName} that the API contract has been defined.`,
        });
      }
    }

    return conflicts;
  }

  private updateIntentWindow(event: PairEvent): void {
    const window = this.intentWindow.get(event.project_id) ?? [];
    window.push(event);
    if (window.length > 10) window.shift();
    this.intentWindow.set(event.project_id, window);
  }
}
