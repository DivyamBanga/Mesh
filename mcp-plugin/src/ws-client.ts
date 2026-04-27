import { EventEmitter } from 'events';
import WebSocket from 'ws';

export type ConnectionState = 'connected' | 'connecting' | 'disconnected';

export interface JoinConfig {
  session_id: string;
  project_id: string;
  developer_name: string;
  branch: string;
  auth_token: string;
}

export class MeshWsClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private readonly maxReconnectDelay = 30000;
  private _state: ConnectionState = 'disconnected';
  private queue: any[] = [];
  private closing = false;

  constructor(
    private host: string,
    private port: number,
    private config: JoinConfig
  ) {
    super();
  }

  get state(): ConnectionState {
    return this._state;
  }

  connect(): void {
    if (this._state === 'connected' || this._state === 'connecting') return;
    this._setState('connecting');
    this._connect();
  }

  private _connect(): void {
    const url = `ws://${this.host}:${this.port}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('open', () => {
      this.reconnectDelay = 1000;
      ws.send(JSON.stringify({ type: 'join', ...this.config }));
    });

    ws.on('message', (data) => {
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      // First ack after join means we're fully connected
      if (msg.type === 'ack' && msg.message === 'joined' && this._state !== 'connected') {
        this._setState('connected');
        this._flushQueue();
      }

      this.emit('message', msg);

      // Emit typed events for tool handlers to subscribe
      if (msg.type === 'ack') this.emit('ack', msg);
      if (msg.type === 'conflict') this.emit('conflict', msg);
      if (msg.type === 'event') this.emit('peer_event', msg.event);
      if (msg.type === 'peer_connected') this.emit('peer_connected', msg);
      if (msg.type === 'peer_disconnected') this.emit('peer_disconnected', msg);
      if (msg.type === 'error') this.emit('server_error', msg);
    });

    ws.on('close', () => {
      this.ws = null;
      if (!this.closing) {
        this._setState('disconnected');
        this._scheduleReconnect();
      }
    });

    ws.on('error', (err) => {
      // Will be followed by close
      process.stderr.write(`[mesh] WebSocket error: ${err.message}\n`);
    });
  }

  send(message: any): void {
    const payload = JSON.stringify(message);
    if (this._state === 'connected' && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
    } else {
      // Queue while reconnecting
      this.queue.push(message);
    }
  }

  close(): void {
    this.closing = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this._setState('disconnected');
  }

  private _setState(state: ConnectionState): void {
    this._state = state;
    this.emit('state_change', state);
  }

  private _scheduleReconnect(): void {
    if (this.closing) return;
    this.reconnectTimer = setTimeout(() => {
      if (!this.closing) {
        process.stderr.write(`[mesh] Reconnecting... (delay: ${this.reconnectDelay}ms)\n`);
        this._connect();
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      }
    }, this.reconnectDelay);
  }

  private _flushQueue(): void {
    const pending = this.queue.splice(0);
    for (const msg of pending) {
      this.send(msg);
    }
  }
}
