import * as dotenv from 'dotenv';
dotenv.config();

import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import express from 'express';
import Database from 'better-sqlite3';
import { EventStore } from './event-store';
import { SessionRegistry } from './session-registry';
import { ConflictDetector } from './conflict-detector';
import { ContextSummariser } from './context-summariser';
import { ProjectManager } from './project-manager';
import { createRestRouter } from './rest-api';
import { WsHub } from './ws-hub';

const PORT = parseInt(process.env.PORT ?? '3747', 10);
const DB_PATH = process.env.DB_PATH ?? './mesh.db';

// Initialize SQLite
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schemaPath = path.join(__dirname, '..', 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf-8');
db.exec(schema);

// Create module instances
const eventStore = EventStore.createFromDb(db);
const sessionRegistry = new SessionRegistry(db);
const projectManager = new ProjectManager(db);
const conflictDetector = new ConflictDetector(eventStore, sessionRegistry);
const contextSummariser = new ContextSummariser(eventStore, sessionRegistry);

// Express app
const app = express();
app.use(express.json());

// CORS — allow Conductor UI and any local dev origin
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

// WebSocket hub (attaches to http.Server)
const server = http.createServer(app);
const hub = new WsHub(server, sessionRegistry, eventStore, conflictDetector, projectManager);

// REST routes
const router = createRestRouter(
  eventStore,
  sessionRegistry,
  contextSummariser,
  projectManager,
  hub.conflictStore
);
app.use(router);

// Stale session cleanup
setInterval(() => {
  sessionRegistry.cleanStaleSessions(300000);
}, 30000);

// Start
const sessionCount = sessionRegistry.getTotalSessionCount();
const row = (db as any).prepare('SELECT COUNT(*) as count FROM events').get() as { count: number };
const eventCount = row.count;

server.listen(PORT, () => {
  console.log(`Mesh server running on port ${PORT}`);
  console.log(`  Sessions in DB: ${sessionCount}`);
  console.log(`  DB path: ${DB_PATH}`);
});

export { app, server };
// db is not exported due to nominal type constraints from better-sqlite3
