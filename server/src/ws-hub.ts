import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import { v4 as uuidv4 } from 'uuid';
import {
  PairEvent,
  ConflictReport,
  HeartbeatPayload,
  FileLockPayload,
  FileUnlockPayload,
} from './types';
import { SessionRegistry } from './session-registry';
import { EventStore } from './event-store';
import { ConflictDetector } from './conflict-detector';
import { ProjectManager } from './project-manager';

interface ConnectedClient {
  ws: WebSocket;
  session_id: string;
  project_id: string;
  developer_name: string;
  type: 'peer' | 'observer';
}

// In-memory recent conflicts (last 100 per project)
class ConflictStore {
  private store: Map<string, ConflictReport[]> = new Map();

  add(projectId: string, conflicts: ConflictReport[]): void {
    const list = this.store.get(projectId) ?? [];
    list.push(...conflicts);
    if (list.length > 100) list.splice(0, list.length - 100);
    this.store.set(projectId, list);
  }

  getRecent(projectId: string): ConflictReport[] {
    return this.store.get(projectId) ?? [];
  }
}

export { ConflictStore };

export class WsHub {
  private wss: WebSocketServer;
  private clients: Map<string, ConnectedClient> = new Map(); // sessionId -> client
  public conflictStore: ConflictStore;

  constructor(
    server: http.Server,
    private sessionRegistry: SessionRegistry,
    private eventStore: EventStore,
    private conflictDetector: ConflictDetector,
    private projectManager: ProjectManager
  ) {
    this.conflictStore = new ConflictStore();
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws) => this.handleConnection(ws));
  }

  private handleConnection(ws: WebSocket): void {
    let client: ConnectedClient | null = null;

    ws.on('message', (data) => {
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        this.sendTo(ws, { type: 'error', message: 'invalid_json' });
        return;
      }

      if (!client) {
        // First message must be JOIN or OBSERVE
        if (msg.type === 'join') {
          client = this.handleJoin(ws, msg);
        } else if (msg.type === 'observe') {
          client = this.handleObserve(ws, msg);
        } else {
          this.sendTo(ws, { type: 'error', message: 'expected_join' });
          ws.close(4001, 'expected_join');
        }
        return;
      }

      // Subsequent messages
      if (client.type === 'observer') {
        this.sendTo(ws, { type: 'error', message: 'observers_cannot_send' });
        return;
      }

      this.handlePeerMessage(client, msg);
    });

    ws.on('close', () => {
      if (client) {
        this.handleDisconnect(client);
      }
    });

    ws.on('error', (err) => {
      console.error('WS error:', err.message);
    });
  }

  private handleJoin(ws: WebSocket, msg: any): ConnectedClient | null {
    const { session_id, project_id, developer_name, branch, auth_token } = msg;

    if (!session_id || !project_id || !developer_name || !auth_token) {
      this.sendTo(ws, { type: 'error', message: 'missing_fields' });
      ws.close(4001, 'missing_fields');
      return null;
    }

    const valid = this.projectManager.validateAuthToken(auth_token, project_id, session_id, developer_name);
    if (!valid) {
      this.sendTo(ws, { type: 'error', message: 'invalid_auth' });
      ws.close(4001, 'invalid_auth');
      return null;
    }

    const session = this.sessionRegistry.registerSession(session_id, project_id, developer_name, branch ?? 'main', ws);

    const client: ConnectedClient = {
      ws,
      session_id,
      project_id,
      developer_name,
      type: 'peer',
    };
    this.clients.set(session_id, client);

    // Notify peers
    this.broadcastToProject(project_id, session_id, {
      type: 'peer_connected',
      session_id,
      developer_name,
      branch: branch ?? 'main',
    }, true); // include self

    this.sendTo(ws, { type: 'ack', message: 'joined' });
    return client;
  }

  private handleObserve(ws: WebSocket, msg: any): ConnectedClient | null {
    const { project_id, auth_token } = msg;
    if (!project_id || !auth_token) {
      this.sendTo(ws, { type: 'error', message: 'missing_fields' });
      ws.close(4001, 'missing_fields');
      return null;
    }
    // For observer, validate using project secret directly
    const project = this.projectManager.getProject(project_id);
    if (!project || project.secret !== auth_token) {
      this.sendTo(ws, { type: 'error', message: 'invalid_auth' });
      ws.close(4001, 'invalid_auth');
      return null;
    }

    const observerId = `observer-${uuidv4()}`;
    const client: ConnectedClient = {
      ws,
      session_id: observerId,
      project_id,
      developer_name: 'observer',
      type: 'observer',
    };
    this.clients.set(observerId, client);
    this.sendTo(ws, { type: 'ack', message: 'observing' });
    return client;
  }

  private handlePeerMessage(client: ConnectedClient, msg: any): void {
    if (msg.type !== 'event') {
      this.sendTo(client.ws, { type: 'error', message: 'unknown_message_type' });
      return;
    }

    const event: PairEvent = msg.event;
    if (!event || !event.event_type || !event.payload) {
      this.sendTo(client.ws, { type: 'error', message: 'invalid_event' });
      return;
    }

    // Validate payload size
    const payloadStr = JSON.stringify(event.payload);
    if (payloadStr.length > 2000) {
      this.sendTo(client.ws, { type: 'error', message: 'payload_too_large', code: 413 });
      return;
    }

    // Ensure event metadata
    event.session_id = client.session_id;
    event.project_id = client.project_id;
    event.developer = client.developer_name;
    if (!event.event_id) event.event_id = uuidv4();
    if (!event.created_at) event.created_at = Date.now();

    // Handle file lock/unlock server-side
    if (event.event_type === 'file_lock') {
      const payload = event.payload as FileLockPayload;
      const conflicts: ConflictReport[] = [];
      let allLocked = true;
      for (const path of payload.paths) {
        const ok = this.eventStore.acquireFileLock(
          path, client.project_id, client.session_id, client.developer_name,
          payload.reason, payload.exclusive
        );
        if (!ok) {
          allLocked = false;
          const existingLocks = this.eventStore.getFileLocks(client.project_id);
          const lock = existingLocks.find(l => l.path === path);
          if (lock) {
            conflicts.push({
              conflict_id: uuidv4(),
              type: 'file_overlap',
              severity: 'critical',
              description: `File "${path}" is already locked by ${lock.developer}`,
              sessions_involved: [client.session_id, lock.session_id],
              files_involved: [path],
              recommendation: `Wait for ${lock.developer} to unlock the file.`,
            });
          }
        }
      }
      if (conflicts.length > 0) {
        this.sendTo(client.ws, { type: 'conflict', conflicts, status: 'conflict' });
        return;
      }
    }

    if (event.event_type === 'file_unlock') {
      const payload = event.payload as FileUnlockPayload;
      this.eventStore.releaseFileLock(payload.paths, client.project_id, client.session_id);
    }

    if (event.event_type === 'heartbeat') {
      this.sessionRegistry.updateHeartbeat(client.session_id, event.payload as HeartbeatPayload);
    }

    // Run conflict detection
    const conflicts = this.conflictDetector.detect(event);
    if (conflicts.length > 0) {
      this.conflictStore.add(client.project_id, conflicts);
      this.broadcastToProject(client.project_id, null, { type: 'conflict', conflicts });
    }

    // Persist
    this.eventStore.appendEvent(event);

    // Ack to sender
    this.sendTo(client.ws, { type: 'ack', event_id: event.event_id });

    // Broadcast to peers (not back to sender, not observers separately handled)
    this.broadcastToProject(client.project_id, client.session_id, { type: 'event', event });
  }

  private handleDisconnect(client: ConnectedClient): void {
    this.clients.delete(client.session_id);

    if (client.type === 'peer') {
      this.sessionRegistry.markDisconnected(client.session_id);

      // Auto-release locks after timeout is handled by cleanStaleSessions
      this.broadcastToProject(client.project_id, client.session_id, {
        type: 'peer_disconnected',
        session_id: client.session_id,
        developer_name: client.developer_name,
      });
    }
  }

  private broadcastToProject(
    projectId: string,
    excludeSessionId: string | null,
    message: any,
    includeSelf = false
  ): void {
    for (const [id, c] of this.clients) {
      if (c.project_id !== projectId) continue;
      if (!includeSelf && c.session_id === excludeSessionId) continue;
      if (c.ws.readyState === WebSocket.OPEN) {
        this.sendTo(c.ws, message);
      }
    }
  }

  private sendTo(ws: WebSocket, message: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}
