import { EventEmitter } from 'events';
import { MeshWsClient, ConnectionState } from '../src/ws-client';

// ── Mock WebSocket ────────────────────────────────────────────────────────────
// We mock the 'ws' module to avoid real network connections.

jest.mock('ws', () => {
  const { EventEmitter } = require('events');

  class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    readyState = MockWebSocket.OPEN;
    sent: string[] = [];

    constructor(public url: string) {
      super();
      // Defer open to next tick so tests can attach listeners first
      setImmediate(() => this.emit('open'));
    }

    send(data: string) {
      this.sent.push(data);
    }

    close() {
      this.readyState = MockWebSocket.CLOSED;
      this.emit('close', 1000, '');
    }

    // Test helper: simulate receiving a message from the server
    simulateMessage(data: any) {
      this.emit('message', JSON.stringify(data));
    }
  }

  MockWebSocket.OPEN = 1;
  return MockWebSocket;
});

// After mocking, import ws so tests can get the mock instance
import WebSocket from 'ws';

const MockWebSocket = WebSocket as any;

function makeClient(): MeshWsClient {
  return new MeshWsClient('localhost', 3747, {
    session_id: 'sess-test',
    project_id: 'proj-test',
    developer_name: 'Tester',
    branch: 'main',
    auth_token: 'token-abc',
  });
}

describe('MeshWsClient — connection state', () => {
  it('starts in disconnected state', () => {
    const client = makeClient();
    expect(client.state).toBe('disconnected');
  });

  it('transitions to connecting on connect()', () => {
    const client = makeClient();
    client.connect();
    expect(client.state).toBe('connecting');
    client.close();
  });

  it('transitions to connected after receiving joined ack', (done) => {
    const client = makeClient();
    client.connect();

    client.on('state_change', (state: ConnectionState) => {
      if (state === 'connected') {
        client.close();
        done();
      }
    });

    // Wait for the WS to open and send join, then simulate server ack
    setImmediate(() => {
      const ws = (client as any).ws as InstanceType<typeof MockWebSocket>;
      ws?.simulateMessage({ type: 'ack', message: 'joined' });
    });
  });
});

describe('MeshWsClient — send', () => {
  it('sends messages directly when connected', (done) => {
    const client = makeClient();
    client.connect();

    setImmediate(() => {
      const ws = (client as any).ws as InstanceType<typeof MockWebSocket>;
      ws?.simulateMessage({ type: 'ack', message: 'joined' });

      setImmediate(() => {
        client.send({ type: 'event', event: { event_id: 'e1' } });
        // First sent message is the JOIN, second is our event
        const events = ws.sent.map((s: string) => JSON.parse(s));
        const sentEvent = events.find((m: any) => m.type === 'event');
        expect(sentEvent).toBeDefined();
        expect(sentEvent.event.event_id).toBe('e1');
        client.close();
        done();
      });
    });
  });

  it('queues messages when disconnected and flushes on connect', (done) => {
    const client = makeClient();
    // Send before connecting
    client.send({ type: 'event', event: { event_id: 'queued-1' } });
    expect((client as any).queue).toHaveLength(1);

    client.connect();

    setImmediate(() => {
      const ws = (client as any).ws as InstanceType<typeof MockWebSocket>;
      ws?.simulateMessage({ type: 'ack', message: 'joined' });

      setImmediate(() => {
        // Queue should be drained
        expect((client as any).queue).toHaveLength(0);
        const sentMessages = ws.sent.map((s: string) => JSON.parse(s));
        const flushed = sentMessages.find((m: any) => m?.event?.event_id === 'queued-1');
        expect(flushed).toBeDefined();
        client.close();
        done();
      });
    });
  });
});

describe('MeshWsClient — event emission', () => {
  it('emits peer_connected for peer_connected messages', (done) => {
    const client = makeClient();
    client.connect();

    client.on('peer_connected', (msg) => {
      expect(msg.developer_name).toBe('Alice');
      client.close();
      done();
    });

    setImmediate(() => {
      const ws = (client as any).ws as InstanceType<typeof MockWebSocket>;
      ws?.simulateMessage({ type: 'ack', message: 'joined' });
      setImmediate(() => {
        ws?.simulateMessage({ type: 'peer_connected', developer_name: 'Alice', branch: 'main' });
      });
    });
  });

  it('emits conflict for conflict messages', (done) => {
    const client = makeClient();
    client.connect();

    client.on('conflict', (msg) => {
      expect(msg.conflicts).toHaveLength(1);
      client.close();
      done();
    });

    setImmediate(() => {
      const ws = (client as any).ws as InstanceType<typeof MockWebSocket>;
      ws?.simulateMessage({ type: 'ack', message: 'joined' });
      setImmediate(() => {
        ws?.simulateMessage({ type: 'conflict', conflicts: [{ conflict_id: 'c1', type: 'file_overlap' }] });
      });
    });
  });

  it('emits peer_event for event messages from partner', (done) => {
    const client = makeClient();
    client.connect();

    client.on('peer_event', (event) => {
      expect(event.event_type).toBe('intent');
      client.close();
      done();
    });

    setImmediate(() => {
      const ws = (client as any).ws as InstanceType<typeof MockWebSocket>;
      ws?.simulateMessage({ type: 'ack', message: 'joined' });
      setImmediate(() => {
        ws?.simulateMessage({ type: 'event', event: { event_type: 'intent', payload: {} } });
      });
    });
  });
});

describe('MeshWsClient — reconnection', () => {
  it('schedules reconnect after unexpected server close', () => {
    // Don't use fake timers here — they intercept setImmediate in the WS mock
    const client = makeClient();
    client.connect();

    // Directly emit close on the underlying WS to simulate server drop
    const ws = (client as any).ws as InstanceType<typeof MockWebSocket>;
    // Manually trigger close without going through the mock open flow
    (client as any)._setState('connected');
    (client as any).closing = false;
    (client as any).ws = ws;

    // Simulate unexpected close
    ws?.emit('close', 1006, '');

    expect(client.state).toBe('disconnected');
    expect((client as any).reconnectTimer).not.toBeNull();

    client.close(); // cleanup
    expect((client as any).reconnectTimer).toBeNull();
  });

  it('does not reconnect after explicit close()', () => {
    const client = makeClient();
    client.connect();
    client.close();

    expect(client.state).toBe('disconnected');
    expect((client as any).reconnectTimer).toBeNull();
  });
});
