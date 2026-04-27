# Mesh — Product Requirements Document
### AI-native command center for collaborative Claude Code development

---

## Overview

Mesh is a **Conductor-style command center** that connects multiple developers' Claude Code instances into a single, real-time orchestration interface. Think of it as mission control for AI-driven development — when you start a hackathon, personal project, or team sprint, you open Mesh and immediately see every connected Claude Code instance, what each is building, which files are locked, what decisions have been made, and where conflicts are forming.

The core insight: modern AI-assisted development with Claude Code is powerful for a single developer, but when 2-5 developers each run their own Claude Code session on a shared codebase, chaos emerges. Files conflict, decisions contradict, efforts duplicate. Mesh solves this by making every Claude Code instance aware of every other — automatically sharing intent, decisions, file ownership, and questions — while giving the team a unified Conductor UI to observe and coordinate the entire operation.

**The Conductor** is Mesh's primary interface: a persistent, browser-based command center with four core panels — an **Agent Grid** showing every connected Claude Code instance and its live status, a **Terminal** for your own Claude Code session, a **File Explorer** with real-time lock and ownership indicators, and an **Activity Feed** streaming every event, decision, and conflict across the team. One-click project setup, invite codes for teammates, and zero-config MCP integration make it possible to go from "I just had an idea" to "4 Claude Code agents coordinated and building" in under 60 seconds.

This document is structured as step-by-step implementation instructions for Claude to build the complete system end to end.

---

## Product Vision — The Conductor Experience

### The User Journey

1. **Open Mesh** → Land on the setup screen. Two options: **Create Project** or **Join Project**.
2. **Create a project** → Enter project name and your name. Mesh generates a short invite code (e.g., `MESH-X7K9`) and launches the Conductor.
3. **Share the code** → Teammates enter the code (via Mesh UI or CLI: `mesh join MESH-X7K9 --name "Alex"`). Their Claude Code instances auto-connect via MCP.
4. **The Conductor activates** → The main screen shows all connected agents in real-time. You see who's working on what, which files are locked, what decisions are being made, and where conflicts form — all without asking anyone.
5. **Work flows** → Each Claude Code instance automatically broadcasts intent, locks files, records decisions, asks questions, and coordinates through the Mesh protocol. The Conductor displays everything.

### Why This Matters

- **Hackathons**: 4 developers, 12 hours, one codebase. Without Mesh, half the time is spent on "wait, are you editing that file?" and "I already built that." With Mesh, every Claude knows what every other Claude is doing.
- **Team sprints**: Parallel feature development without stepping on each other's code. Architectural decisions made by one Claude are instantly visible to all others.
- **Open source**: Contributors can see maintainer's Claude working on the same area and coordinate in real-time.

---

## System Architecture

Before implementing anything, understand the five components and how they connect:

```
                              ┌─────────────────────────┐
                              │   MESH CONDUCTOR UI     │
                              │   (Browser-based)       │
                              │                         │
                              │  Agent Grid · Terminal  │
                              │  File Tree · Activity   │
                              └────────────┬────────────┘
                                           │ WebSocket (observe) + REST
                                           │
Developer A (Machine A)                    │              Developer B (Machine B)
┌─────────────────────────┐                │             ┌─────────────────────────┐
│  Claude Code            │                │             │  Claude Code            │
│  + Mesh MCP plugin      │◄───────────────┼────────────►│  + Mesh MCP plugin      │
└────────────┬────────────┘                │             └────────────┬────────────┘
             │                             │                          │
             │ MCP (stdio)                 │                          │ MCP (stdio)
             │                             │                          │
             ▼                             ▼                          ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              Mesh Server                                        │
│                                                                                 │
│  WebSocket hub  ·  Session registry  ·  Conflict detector  ·  Conductor API    │
│  Event store    ·  Context summariser ·  REST API          ·  Project manager  │
└─────────────────────────────────────┬───────────────────────────────────────────┘
                                      │
                              ┌───────▼───────┐
                              │  State store  │
                              │  (SQLite)     │
                              └───────────────┘
```

The Mesh MCP plugin runs locally on each developer's machine and connects to the central Mesh server over WebSocket. Claude Code talks to the plugin over stdio (standard MCP transport). The Conductor UI connects as a WebSocket observer and REST client. The central server handles all routing, conflict detection, project management, and state persistence.

---

## Section 1 — Repository Structure

Create the following directory layout before writing any code:

```
mesh/
├── server/
│   ├── src/
│   │   ├── index.ts              # Server entry point
│   │   ├── ws-hub.ts             # WebSocket connection hub
│   │   ├── session-registry.ts   # Developer session management
│   │   ├── event-store.ts        # Event persistence (SQLite)
│   │   ├── conflict-detector.ts  # File and intent conflict logic
│   │   ├── context-summariser.ts # Rolling context summary per session
│   │   ├── project-manager.ts    # Project creation, invite codes, settings
│   │   ├── rest-api.ts           # HTTP endpoints for Conductor + API
│   │   └── types.ts              # Shared type definitions
│   ├── package.json
│   ├── tsconfig.json
│   └── schema.sql                # Database schema
│
├── mcp-plugin/
│   ├── src/
│   │   ├── index.ts              # MCP server entry point
│   │   ├── tools.ts              # MCP tool definitions
│   │   ├── resources.ts          # MCP resource definitions
│   │   ├── ws-client.ts          # WebSocket client to Mesh server
│   │   └── types.ts              # Shared types (symlinked from server)
│   ├── package.json
│   └── tsconfig.json
│
├── conductor/
│   ├── index.html                # Conductor UI — main entry point
│   ├── styles.css                # Conductor styles
│   └── app.js                    # Conductor application logic
│
├── claude-md-templates/
│   ├── CLAUDE.md.mesh            # Template to add to team's CLAUDE.md
│   └── .mesh.json.example        # Per-project config example
│
├── scripts/
│   ├── setup.sh                  # One-command setup script
│   └── generate-session-key.ts   # Session key generator
│
└── README.md
```

---

## Section 2 — Data Model and Database Schema

Implement `schema.sql` with the following tables. Run this schema on SQLite at server startup.

### Sessions table

Stores each developer's active session.

```sql
CREATE TABLE IF NOT EXISTS sessions (
  session_id     TEXT PRIMARY KEY,
  developer_name TEXT NOT NULL,
  project_id     TEXT NOT NULL,
  branch         TEXT NOT NULL,
  connected_at   INTEGER NOT NULL,
  last_seen      INTEGER NOT NULL,
  ws_connected   INTEGER NOT NULL DEFAULT 1
);
```

### Events table

Append-only log of everything that has happened in a project session. Never delete rows — only append.

```sql
CREATE TABLE IF NOT EXISTS events (
  event_id      TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL,
  session_id    TEXT NOT NULL,
  developer     TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  payload       TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  delivered_to  TEXT NOT NULL DEFAULT '[]'
);
```

Event types are:
- `intent` — developer's Claude is about to do something
- `file_lock` — developer's Claude has active edits on specific paths
- `file_unlock` — developer's Claude has released a path lock
- `decision` — architectural or technical decision made
- `question` — Claude is asking the partner Claude something
- `answer` — response to a question
- `blocker` — Claude is blocked waiting for something
- `blocker_resolved` — a previously declared blocker is cleared
- `heartbeat` — connection keepalive with current working state

### File locks table

Current file lock state derived from events, kept in sync for fast conflict checking.

```sql
CREATE TABLE IF NOT EXISTS file_locks (
  path        TEXT NOT NULL,
  project_id  TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  developer   TEXT NOT NULL,
  locked_at   INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  PRIMARY KEY (path, project_id)
);
```

### Decisions table

Persistent record of architectural decisions, queryable by future Claude sessions.

```sql
CREATE TABLE IF NOT EXISTS decisions (
  decision_id  TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL,
  session_id   TEXT NOT NULL,
  developer    TEXT NOT NULL,
  category     TEXT NOT NULL,
  summary      TEXT NOT NULL,
  rationale    TEXT NOT NULL,
  affected     TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
```

---

## Section 3 — Shared Type Definitions

Implement `types.ts` (shared between server and plugin via symlink or copy) with these exact types:

```typescript
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
```

---

## Section 4 — Server Implementation

### 4.1 WebSocket Hub (`ws-hub.ts`)

The hub manages all WebSocket connections. Implement with the following behaviour:

- Accept incoming WebSocket connections on port 3747 (configurable via `MESH_PORT`)
- Each connection sends a `JOIN` message on connect: `{ type: 'join', session_id, project_id, developer_name, branch, auth_token }`
- Validate the auth token against `project_id` using HMAC-SHA256 (key = project secret, message = `project_id:session_id:developer_name`)
- Register the connection in the session registry
- Route all subsequent messages by `project_id` — a message from session A only goes to other sessions in the same project
- On disconnect, mark the session as disconnected in the registry, retain all its events and locks, send a `peer_disconnected` notification to remaining sessions
- Send a `peer_connected` notification to all sessions in a project when a new peer joins, including the joining peer's current context summary

Message types the hub sends to clients:
- `peer_connected` — a new developer joined
- `peer_disconnected` — a developer disconnected
- `event` — a PairEvent from another session
- `conflict` — a ConflictReport triggered by a new event
- `ack` — acknowledgement that an event was received and stored
- `error` — authentication or protocol error

Observer connections (type `observe` in join message) receive all broadcasts but cannot send events. Used by the Conductor UI.

### 4.2 Session Registry (`session-registry.ts`)

Manages in-memory session state with SQLite persistence. Implement:

- `registerSession(sessionId, projectId, developerName, branch, wsConnection)` — adds to memory and DB
- `updateHeartbeat(sessionId, payload: HeartbeatPayload)` — updates last_seen and in-memory status
- `getSessionsForProject(projectId)` — returns all sessions (connected and recently disconnected)
- `getPartnerContexts(sessionId, projectId)` — returns `PartnerContext[]` for all other sessions, excluding the caller
- `markDisconnected(sessionId)` — sets ws_connected = 0, retains all data
- `cleanStaleSessions(maxAgeMs)` — removes sessions disconnected longer than maxAgeMs

### 4.3 Event Store (`event-store.ts`)

Append-only event persistence. Implement:

- `appendEvent(event: PairEvent)` — writes to events table, returns the stored event
- `markDelivered(eventId, sessionId)` — updates delivered_to JSON array for a specific session
- `getUndeliveredEvents(sessionId, projectId, since: number)` — returns events not yet delivered to the given session, ordered by created_at
- `getRecentEvents(projectId, limit, eventTypes?)` — returns the N most recent events, optionally filtered by type
- `getDecisions(projectId, since?)` — returns all decision events, optionally filtered by timestamp
- `acquireFileLock(path, projectId, sessionId, developer, reason, exclusive)` — inserts into file_locks, returns false if locked by another session
- `releaseFileLock(paths, projectId, sessionId)` — deletes locks owned by this session
- `getFileLocks(projectId)` — returns all current locks for a project

### 4.4 Conflict Detector (`conflict-detector.ts`)

Runs on every incoming event before it is broadcast. Implement three detection modes:

**File overlap detection** — triggered on `intent` and `file_lock` events:
- Get all current file locks from the event store
- Compare the incoming event's `files_affected` or `paths` against existing locks from different sessions
- Overlap with another session's formal lock → `ConflictReport` severity `critical`
- Overlap with another session's heartbeat `active_files` but no formal lock → severity `warning`

**Semantic intent detection** — triggered on `intent` events:
- Maintain a sliding window of the last 10 intent events per project in memory
- Use keyword matching to detect semantic conflicts: if an incoming intent description shares identifiers with a recent intent from another session, generate a `ConflictReport` severity `warning`
- Extract identifiers using this regex: `[A-Z][a-zA-Z]+|[a-z][a-zA-Z]{3,}(?:Service|Controller|Module|Handler|Manager|Client|Store|Repository)`

**API contract opportunity detection** — triggered on `decision` events with category `api_contract`:
- Compare against open blockers from other sessions that mention waiting for an API contract
- If a match is found, generate a `ConflictReport` noting the blocker can be resolved, severity `warning` (positive conflict — opportunity to coordinate)

The conflict detector returns `ConflictReport[] | []`. The hub broadcasts non-empty reports to all affected sessions before broadcasting the original event.

### 4.5 Context Summariser (`context-summariser.ts`)

Generates a `PartnerContext` for each session on demand. Implement:

- `buildPartnerContext(sessionId, projectId)` — queries the event store and session registry to build a complete PartnerContext:
  - Most recent heartbeat → `current_task`, `active_files`, `status`
  - Last 5 decision events → `recent_decisions`
  - All current file locks → `active_locks`
  - All open questions (no corresponding answer) → `open_questions`
  - All open blockers (no corresponding resolved event) → `open_blockers`
- `buildProjectSummary(projectId)` — builds PartnerContext for all sessions in a project, returns as an array

### 4.6 REST API (`rest-api.ts`)

Expose the following HTTP endpoints using Express:

```
GET  /api/project/:projectId/sessions        — all sessions for a project
GET  /api/project/:projectId/events          — recent events (query: limit, types)
GET  /api/project/:projectId/locks           — current file locks
GET  /api/project/:projectId/decisions       — all decisions
GET  /api/project/:projectId/context         — full partner context for all sessions
GET  /api/project/:projectId/conflicts       — recent conflict reports (in-memory, last 100)
POST /api/project/:projectId/session/create  — create a new session, returns session_id + auth_token
GET  /health                                 — server health check
```

All endpoints except `/health` require an `Authorization: Bearer <project-secret>` header.

### 4.7 Server Entry Point (`index.ts`)

Wire everything together in this order:

1. Load `.env` with dotenv
2. Initialise SQLite with schema.sql
3. Create instances of all modules
4. Start the HTTP server with REST API on `PORT` (default 3747)
5. Attach the WebSocket server to the same port at path `/ws`
6. Start a 30-second interval calling `session-registry.cleanStaleSessions(300000)`
7. Log on startup: port, number of existing sessions in DB, number of events in DB

---

## Section 5 — MCP Plugin Implementation

The MCP plugin runs on each developer's machine as a stdio MCP server. Claude Code connects to it. The plugin connects outward to the central Mesh server.

### 5.1 WebSocket Client (`ws-client.ts`)

Manages the connection from the plugin to the Mesh server:

- Connect to `ws://<MESH_HOST>:<MESH_PORT>/ws` on startup
- Send the `JOIN` message immediately on connect
- Reconnect automatically on disconnect with exponential backoff (start 1s, max 30s)
- Maintain an in-memory queue of events received while MCP tools were not actively listening
- Expose an `EventEmitter` interface so tool handlers can subscribe to incoming events
- Expose a `send(message)` method for tool handlers to publish events
- Track connection state: `connected | connecting | disconnected`

### 5.2 MCP Tool Definitions (`tools.ts`)

Implement the following MCP tools. Each tool sends an event to the server and waits for an `ack` before returning.

---

#### `mesh_broadcast_intent`

Claude calls this before beginning any task that touches shared code.

Input schema:
```json
{
  "description": "string — what Claude is about to do",
  "files_affected": "string[] — relative file paths Claude plans to touch",
  "estimated_scope": "small | medium | large",
  "reversible": "boolean — whether this can be easily undone"
}
```

Behaviour:
1. Construct an `IntentPayload` from inputs
2. Send as a `PairEvent` with type `intent`
3. Wait for `ack` or `conflict` response (5-second timeout)
4. If a `conflict` is received before `ack`, return the conflict report as the tool result so Claude can surface it to the developer
5. Return: `{ status: 'broadcast', event_id, conflicts: ConflictReport[] }`

---

#### `mesh_lock_files`

Claude calls this when it begins actively editing specific files.

Input schema:
```json
{
  "paths": "string[] — relative file paths to lock",
  "reason": "string — why these files are being locked",
  "exclusive": "boolean — whether other Claudes should not touch these files at all"
}
```

Behaviour:
1. Send `file_lock` event to server
2. Server attempts to acquire locks — returns success or conflict
3. Return: `{ status: 'locked' | 'conflict', paths, conflicts: ConflictReport[] }`

---

#### `mesh_unlock_files`

Claude calls this when it finishes editing files.

Input schema:
```json
{
  "paths": "string[] — paths to release"
}
```

Behaviour: Send `file_unlock` event, return `{ status: 'unlocked', paths }`

---

#### `mesh_record_decision`

Claude calls this after making a significant architectural or technical decision.

Input schema:
```json
{
  "category": "architecture | library | api_contract | pattern | naming | other",
  "summary": "string — one sentence description of the decision",
  "rationale": "string — why this decision was made",
  "affected_files": "string[]",
  "rejected_alternatives": "string[] — what was considered and rejected"
}
```

Behaviour: Send `decision` event, return `{ status: 'recorded', decision_id }`

---

#### `mesh_ask_partner`

Claude calls this when it needs information the partner Claude is more likely to know.

Input schema:
```json
{
  "text": "string — the question",
  "context": "string — relevant context for the question",
  "urgent": "boolean — whether the questioner will block until answered"
}
```

Behaviour:
1. Generate a `question_id` (UUID)
2. Send `question` event
3. If `urgent`, wait for an `answer` event matching `question_id` (120-second timeout)
4. If not urgent, return immediately with `{ status: 'sent', question_id }`
5. If urgent and answer received, return `{ status: 'answered', question_id, answer: string }`
6. If urgent and timeout, return `{ status: 'timeout', question_id }`

---

#### `mesh_answer_question`

Claude calls this when it receives a question event from a partner.

Input schema:
```json
{
  "question_id": "string",
  "answer": "string"
}
```

Behaviour: Send `answer` event, return `{ status: 'sent' }`

---

#### `mesh_declare_blocker`

Claude calls this when it is waiting for something the partner has or is building.

Input schema:
```json
{
  "description": "string — what Claude is blocked on",
  "waiting_for": "string — what specifically is needed to unblock"
}
```

Behaviour: Send `blocker` event, return `{ status: 'declared', blocker_id }`

---

#### `mesh_resolve_blocker`

Claude calls this when it was previously blocked and is now unblocked.

Input schema:
```json
{
  "blocker_id": "string",
  "resolution": "string — how it was resolved"
}
```

Behaviour: Send `blocker_resolved` event, return `{ status: 'resolved' }`

---

#### `mesh_get_partner_context`

Claude calls this at the start of any new task to understand what partners are doing.

Input schema: `{}`

Behaviour:
1. Call `GET /api/project/:projectId/context` on the server
2. Format the response as a structured text block Claude can reason about
3. Return a human-readable summary and the raw PartnerContext array

Return format:
```
PARTNER CONTEXT — updated <timestamp>

[Developer Name] on branch <branch>
Status: <status>
Currently: <current_task>
Active files: <list>
Recent decisions:
  - <summary> (<category>)
Active locks: <paths>
Open questions: <questions>
Open blockers: <blockers>
```

---

#### `mesh_heartbeat`

Claude calls this on a regular cadence (every 2-3 minutes of active work) to keep the server updated.

Input schema:
```json
{
  "current_task": "string",
  "active_files": "string[]",
  "status": "working | thinking | waiting | idle"
}
```

Behaviour: Send `heartbeat` event, return `{ status: 'sent' }`

---

### 5.3 MCP Resource Definitions (`resources.ts`)

Expose one MCP resource Claude Code can read at any time:

**Resource URI:** `mesh://partner-context`

**Resource content:** The same output as `mesh_get_partner_context` but as a readable resource that Claude Code automatically injects into context. Refresh every 60 seconds or on explicit read.

**Resource metadata:**
```json
{
  "uri": "mesh://partner-context",
  "name": "Partner Developer Context",
  "description": "Current state of all partner Claude Code sessions in this project",
  "mimeType": "text/plain"
}
```

### 5.4 MCP Plugin Entry Point (`index.ts`)

1. Load configuration from environment:
   - `MESH_HOST` (default: `localhost`)
   - `MESH_PORT` (default: `3747`)
   - `MESH_PROJECT_ID` (required)
   - `MESH_SESSION_ID` (required — unique per developer)
   - `MESH_DEVELOPER_NAME` (required)
   - `MESH_BRANCH` (auto-detect from `git branch --show-current` if not set)
   - `MESH_AUTH_TOKEN` (required)

2. Connect the WebSocket client to the server

3. Create and start an MCP server over stdio with all tools and resources registered

4. Handle incoming events from the WebSocket client:
   - `conflict` event → store in memory, surface in next `mesh_broadcast_intent` or `mesh_lock_files` call
   - `question` event → store in pending questions list, available via `mesh_get_partner_context`
   - `peer_connected` / `peer_disconnected` → update local partner state, log to stderr
   - `event` from partner → update cached partner context

---

## Section 6 — CLAUDE.md Instructions Template

Create `claude-md-templates/CLAUDE.md.pair`. Teams append this block to their project's `CLAUDE.md`. Claude Code injects `CLAUDE.md` into every session's context automatically.

```markdown
## Mesh — Collaboration Protocol

You are working in a collaborative session with other developers. Each developer
has their own Claude Code instance. You coordinate through the Mesh system.

### When to use Mesh tools

**Always call `mesh_get_partner_context` at the start of every new task.**
Read what your partners are working on before planning your approach.

**Call `mesh_broadcast_intent` before:**
- Refactoring any existing code
- Changing function signatures, types, or interfaces
- Adding or removing dependencies
- Modifying database schemas or migrations
- Changing API contracts (request/response shapes)
- Any task estimated to take more than 15 minutes

**Call `mesh_lock_files` when:**
- You begin actively editing a file
- The file is critical and concurrent edits would cause complex conflicts
- You are generating large changes that will touch many lines

**Call `mesh_unlock_files` when:**
- You have finished editing and committed changes
- You are pausing work on a file for more than a few minutes

**Call `mesh_record_decision` when:**
- You choose a library, framework, or major dependency
- You define an API contract or interface that partners will depend on
- You establish a naming convention or code pattern for the project
- You reject an approach in favour of another

**Call `mesh_ask_partner` when:**
- You need to know about code your partner owns
- You are about to make an assumption about something your partner is building
- You encounter something that looks like it conflicts with your partner's recent work

**Call `mesh_heartbeat` every few minutes during active work.**

### How to surface conflicts

If any Mesh tool returns a `conflicts` array with one or more items,
surface them to the developer immediately before proceeding. Describe each
conflict clearly and ask whether to continue, pause, or coordinate.

### General principles

- Do not silently modify files in a partner's active locks or heartbeat
  active_files without first broadcasting intent and asking if coordination
  is needed.
- Prefer `mesh_ask_partner` over assumptions when working near code your
  partner owns.
- Record decisions promptly — the decision log is shared context for the
  whole team.
```

---

## Section 7 — Conductor UI Implementation

The Conductor is Mesh's primary user interface — a browser-based command center that gives the team full visibility into all connected Claude Code instances. It replaces the concept of a simple dashboard with a rich, interactive workspace.

Build the Conductor at `conductor/index.html` as a single-page application. It connects to the REST API and a WebSocket observer connection for live updates. No build step required — opens directly in a browser.

### 7.1 Setup Screen (First Run)

On first load (no project configured in localStorage), show the setup screen:

**Layout:** Centered card with Mesh logo, title, and subtitle. Below, two cards side by side:

- **Create Project** — Generates a new project session:
  - Form fields: Project Name, Your Name
  - On submit: calls `POST /api/project/create` to get `project_id`, `invite_code`, `auth_token`
  - Stores config in localStorage, transitions to Conductor
  
- **Join Project** — Connects to existing session:
  - Form fields: Invite Code, Your Name
  - On submit: calls `POST /api/project/:inviteCode/join` to get session credentials
  - Stores config in localStorage, transitions to Conductor

**Invite codes:** Short, memorable format: `MESH-XXXX` (4 alphanumeric characters). Generated server-side. Shareable via copy button, QR code, or CLI command: `mesh join MESH-X7K9 --name "Alex"`.

### 7.2 Conductor Layout — Four-Panel Grid

The main Conductor uses a CSS Grid layout with this structure:

```
┌──────────────────────────────────────────────────────────────────┐
│  Header Bar                                                      │
├──────────┬───────────────────────────────────┬───────────────────┤
│          │   Agent Grid (top ~40%)           │                   │
│  FILE    │   ┌──────┐ ┌──────┐ ┌──────┐     │   ACTIVITY        │
│  TREE    │   │Divya │ │Alex  │ │Sam   │     │   FEED            │
│          │   │🟢 YOU│ │🟢    │ │🟡    │     │                   │
│  src/    │   └──────┘ └──────┘ └──────┘     │   (tabbed:        │
│  ├─ api/ │                                   │    Events /       │
│  ├─ auth/│───────────────────────────────────│    Decisions /    │
│  └─ ...  │   Your Terminal (bottom ~60%)     │    Comms)         │
│          │   ❯ claude                        │                   │
│          │   Building auth module...         │                   │
│          │   ⚡ mesh_broadcast_intent         │                   │
│          │   ✓ No conflicts detected         │                   │
├──────────┴───────────────────────────────────┴───────────────────┤
│  Status Bar                                                      │
└──────────────────────────────────────────────────────────────────┘
```

**Grid specification:**
```css
grid-template-rows: 52px 1fr 32px;
grid-template-columns: 260px 1fr 340px;
grid-template-areas:
  "header header header"
  "filetree center activity"
  "status status status";
```

### 7.3 Header Bar

The header bar spans the full width and contains:

- **Mesh logo + wordmark** (left) — SVG mesh network icon + "Mesh" text
- **Project name** — Bold, clickable to open project settings
- **Invite code** — Monospace, clickable to open invite modal
- **Agent dots** — Small colored dots (green/amber/red) for each connected agent, with count label
- **Session timer** — Elapsed time since project creation. Styled as a pill with clock icon. Useful for hackathons with time limits
- **Action buttons** (right) — Invite (+), Settings (gear)

### 7.4 File Explorer (Left Panel)

A project file tree with real-time collaboration indicators:

- **Standard tree view**: folders (expandable) and files, indented by depth
- **File type icons**: TypeScript (blue "TS"), JSON (amber "{}"), CSS (purple "#"), Markdown ("M"), generic (diamond)
- **Lock indicators**: colored badges on locked files:
  - **Your locks**: cyan badge "You"
  - **Partner locks**: purple badge with developer name
  - **Other locks**: rose badge with developer name
- **Changed file indicators**: subtle highlight on files modified in current session
- **File count** in panel header

Clicking a file could open it in the terminal view (future enhancement).

### 7.5 Agent Grid (Center Top)

The primary visualization showing all connected Claude Code instances. Uses `grid-template-columns: repeat(auto-fill, minmax(240px, 1fr))` for responsive card layout.

**Each agent card displays:**

- **Top accent bar** (2px): color indicates status (green=working, amber=thinking, purple=waiting, grey=idle)
- **Avatar** (initials, gradient background unique to each developer)
- **Name** with "YOU" badge for the current user
- **Branch name** in monospace
- **Status dot** with glow animation (pulsing for active states)
- **Current task** description (2-line clamp)
- **Meta bar**: file count, lock count, status label

**"You" card styling:** Distinguished border color (cyan) and subtle glow to identify your own agent at a glance.

**Status dot animations:**
- `working` — green, gentle pulse glow (2s cycle)
- `thinking` — amber, faster pulse (1.5s cycle)
- `waiting` — purple, steady glow
- `idle` — grey, no animation

**Live updates:** Cards update in real-time as heartbeat events arrive. Status changes animate smoothly.

### 7.6 Terminal Panel (Center Bottom)

A terminal-like interface showing your Claude Code session output. This is the primary workspace where the developer interacts with their own Claude Code.

**Features:**
- **Dark terminal background** with monospace font (JetBrains Mono)
- **Tab bar**: "Your Claude" (active, with green dot) and "Mesh Logs" (system-level events)
- **Output types**, each visually distinct:
  - **Prompt lines**: cyan color, "❯" prefix
  - **Claude output**: secondary text color
  - **Tool calls**: purple left-border card with lightning icon, tool name bold, detail text
  - **File changes**: green left-border card with file path header, diff-style +/- lines
  - **Success messages**: green "✓" prefix
  - **Warning messages**: amber
  - **Error messages**: rose
  - **Thinking indicator**: amber with blink animation
- **Input area**: bottom bar with "❯" prompt and text input for sending messages to Claude
- **Auto-scroll**: always scrolls to newest output

**Mesh-specific tool calls rendered specially:**
- `mesh_broadcast_intent` — shows intent description and conflict check result
- `mesh_lock_files` — shows locked paths and success/conflict status
- `mesh_get_partner_context` — shows formatted partner summary
- `mesh_record_decision` — shows decision category and summary

### 7.7 Activity Panel (Right)

A tabbed panel with three views:

**Events Tab (default):**
- Chronological list of all events from all sessions
- Each row: timestamp (monospace), event type badge (color-coded), developer name (bold), event text, file tags
- Conflict events: red background highlight with left border
- Auto-scrolls to newest event
- Events animate in with fade + slide-up

**Decisions Tab:**
- List of all architectural decisions
- Each item: category badge (green), summary (bold), rationale, developer name + timestamp
- Sortable and filterable by category

**Communications Tab:**
- Question/Answer threads between Claude instances
- Questions: purple "Q" circle, from-developer label, question text
- Answers: green left-border card, nested under the question
- Unanswered questions: "Awaiting response..." italic placeholder
- Badge on tab when new questions arrive

### 7.8 Status Bar (Bottom)

A slim bar showing system state:

- **Connection status**: green dot + "Connected" (or red dot + "Disconnected")
- **Lock count**: amber indicator with current lock count
- **Event count**: total events in session
- **Conflict count**: total conflicts detected
- **Server URL**: right-aligned, monospace, subtle (e.g., `ws://localhost:3747`)

### 7.9 Invite Modal

Triggered by the invite button or clicking the invite code. Displays:

- Modal title: "Invite Collaborators"
- Description text explaining the invite process
- **Invite code**: large, monospace, with copy button
- **CLI command**: `mesh join MESH-X7K9 --name "TeammateName"` in a code block
- Close button

### 7.10 Toast Notifications

Real-time notifications that appear in the top-right corner:

- **Conflict** (red border): conflict detection alerts
- **Info** (cyan border): peer connect/disconnect, status changes
- **Success** (green border): successful operations

Toasts auto-dismiss after 5 seconds with fade + slide animation.

### Event Type Colour Coding

| Event type | Colour | Badge style |
|---|---|---|
| `intent` | Blue (#3b82f6) | Blue background glow |
| `file_lock` | Amber (#f59e0b) | Amber background glow |
| `file_unlock` | Grey | Subtle grey |
| `decision` | Green (#10b981) | Green background glow |
| `question` | Purple (#8b5cf6) | Purple background glow |
| `answer` | Light purple (#a78bfa) | Lighter purple |
| `blocker` | Red (#ef4444) | Red background glow |
| `blocker_resolved` | Light green (#6ee7b7) | Light green |
| `heartbeat` | Subtle grey | Nearly invisible (collapsed by default) |
| `conflict` | Bright red | Solid red badge, white text |

### Design System

**Color palette (dark theme):**
- Background root: `#06080f`
- Surface: `#0c1019`
- Card: `#111728`
- Card hover: `#161d30`
- Border: `#1e2740`
- Border light: `#283352`
- Text primary: `#e8ecf4`
- Text secondary: `#8b95ad`
- Text muted: `#4b5574`
- Accent cyan: `#06b6d4`
- Accent purple: `#8b5cf6`
- Success green: `#10b981`
- Warning amber: `#f59e0b`
- Error rose: `#ef4444`
- Info blue: `#3b82f6`

**Typography:**
- UI: Inter (Google Fonts), fallback system-ui
- Code/Terminal: JetBrains Mono (Google Fonts), fallback monospace

**Effects:**
- Gradient accents on focus states and key UI elements
- Glow animations on status dots (box-shadow with color)
- Smooth transitions (150ms ease for interactions, 300ms for layout)
- Fade + slide animations for new content

### Observer WebSocket Connection

The Conductor connects to the server as an observer:

```json
{ "type": "observe", "project_id": "...", "auth_token": "..." }
```

Observer connections receive all project broadcasts but cannot send events. This ensures the Conductor is read-only and does not interfere with Claude Code sessions.

### 7.11 Future Conductor Enhancements (Post-MVP)

These features are documented for future iterations:

- **Drag-to-resize panels**: allow users to resize the file tree, agent grid, and activity panel
- **Multiple terminal tabs**: switch between viewing different team members' Claude output
- **Kanban/task board**: visual task assignment across agents
- **Git graph**: real-time branch visualization showing where each agent's branch is relative to main
- **Voice/video hooks**: integration with Discord or Slack for team communication alongside AI coordination
- **QR code invites**: generate a QR code for the invite link for in-person hackathons
- **Hackathon timer**: countdown mode with milestones and deadline warnings
- **Export session report**: generate a markdown summary of all decisions, events, and outcomes

---

## Section 8 — Setup Script and Developer Onboarding

### `scripts/setup.sh`

Write a shell script that does the following when run from the project root:

1. Check for Node.js 20+ and npm
2. `cd server && npm install && npm run build`
3. `cd mcp-plugin && npm install && npm run build`
4. Generate a project secret (32 random bytes, base64)
5. Write `server/.env` with:
   - `PORT=3747`
   - `PROJECT_SECRET=<generated>`
   - `DB_PATH=./mesh.db`
6. For each developer name provided as a script argument, call `npx ts-node scripts/generate-session-key.ts <name>` and output:
   - Session ID
   - Auth token
   - The exact environment variable lines for their shell profile
7. Print the exact JSON block to add to each developer's Claude Code `settings.json`

### `scripts/generate-session-key.ts`

Takes a developer name as argument. Generates:
- `session_id` — `<developer_name>-<uuid4>`
- `auth_token` — HMAC-SHA256(`project_id:session_id:developer_name`, project_secret), hex-encoded

Outputs JSON with all fields needed to configure the plugin.

### MCP plugin configuration block

The README must include the exact JSON block for Claude Code's `settings.json`:

```json
{
  "mcpServers": {
    "mesh": {
      "command": "node",
      "args": ["/path/to/mesh/mcp-plugin/dist/index.js"],
      "env": {
        "MESH_HOST": "localhost",
        "MESH_PORT": "3747",
        "MESH_PROJECT_ID": "<your-project-id>",
        "MESH_SESSION_ID": "<your-session-id>",
        "MESH_DEVELOPER_NAME": "<your-name>",
        "MESH_AUTH_TOKEN": "<your-auth-token>"
      }
    }
  }
}
```

---

## Section 9 — Error Handling and Edge Cases

Implement handling for all of the following:

**Network interruption:** The MCP plugin's WebSocket client reconnects automatically. During the reconnection window, tool calls that require server acknowledgement return `{ status: 'offline', queued: true }`. Events are queued locally and flushed on reconnect.

**Server restart:** On reconnect, the plugin calls `GET /api/project/:projectId/events?since=<last_event_timestamp>` to retrieve missed events and update local state.

**Session timeout:** If a session's `last_seen` is more than 5 minutes old and `ws_connected` is 0, the session registry moves it to stale status. Its locks are automatically released with a `file_unlock` event marked `[session-timeout]`. A `peer_disconnected` event is broadcast.

**Conflicting file locks:** If Claude A holds a lock on a file and Claude B tries to lock it, the server returns the conflict immediately in the `mesh_lock_files` response. Claude B's plugin returns this to Claude without broadcasting to other sessions.

**Circular questions:** If Claude A asks Claude B a question and Claude B asks Claude A a question before either is answered, the server detects the cycle (same session IDs in question events within 30 seconds) and notifies both: "Circular question detected — one of you should answer first."

**Large payloads:** Cap all payload text fields at 2000 characters server-side. Return a `413` error for oversized events. The plugin truncates descriptions longer than 2000 characters before sending.

**Authentication failure:** If the auth token does not validate, the WebSocket connection is closed with code 4001 and message `invalid_auth`. The plugin logs the error to stderr and does not retry automatically — developer must fix configuration.

**No partners connected:** `mesh_get_partner_context` returns gracefully with an empty array and a message: "No partner sessions currently connected to this project." All other tools succeed normally — events are stored and will be delivered when partners connect.

**Partner sends malformed event:** The server validates all incoming event payloads against the EventPayload type before storing or broadcasting. Invalid events are rejected with a `400` error returned to the sender only.

---

## Section 10 — Testing Requirements

Write tests for each of the following before considering any section complete.

### Server unit tests

- `event-store.ts`: append, mark-delivered, get-undelivered, file lock acquire and release, lock conflict on acquire
- `conflict-detector.ts`: file overlap with formal lock (critical), file overlap with heartbeat (warning), semantic detection with known identifier pairs, API contract blocker matching
- `session-registry.ts`: register, heartbeat update, get-partner-contexts excludes self, clean-stale removes correct sessions
- `context-summariser.ts`: open questions correctly excludes answered questions, open blockers correctly excludes resolved blockers

### MCP plugin unit tests

- Each tool: constructs the correct event payload, handles `ack` correctly, handles `conflict` response correctly, handles timeout correctly
- `mesh_ask_partner` with `urgent: true`: blocks until answer received
- WebSocket client: reconnection logic with a mock server that drops connections, event queue flush on reconnect

### Integration tests

- **Round-trip:** Two plugin instances connecting to a real server instance, broadcasting an intent from one, verifying it is received by the other with correct payload
- **Conflict:** Two plugins locking the same file, verifying both receive the conflict report with correct severity
- **Reconnection:** Plugin disconnects, events are generated by partner, plugin reconnects and receives all missed events via catch-up query
- **Observer:** Conductor observer connection receives all events but cannot send
- **Session timeout:** Session goes stale, locks are auto-released, partner receives `peer_disconnected`

---

## Section 11 — README

Write a complete README with the following sections in this order:

1. **What is Mesh** — two paragraphs explaining the problem (multi-agent chaos) and solution (Conductor + coordination layer)
2. **The Conductor** — screenshot/description of the Conductor UI with callouts to each panel
3. **How it works** — the architecture diagram from this PRD rendered in ASCII
4. **Quick start** — minimum steps to get a team connected:
   - Clone the repo
   - Run `./scripts/setup.sh DeveloperA DeveloperB`
   - Add the config block to Claude Code settings on each machine
   - Add the CLAUDE.md block to the project's CLAUDE.md
   - Start the server: `cd server && npm start`
   - Open the Conductor: `open conductor/index.html` or visit `http://localhost:3747`
5. **Conductor guide** — how to use the Conductor UI: setup screen, agent grid, terminal, file explorer, activity feed, invite flow
6. **Configuration reference** — all environment variables, defaults, and descriptions
7. **Tool reference** — all MCP tools with input/output schemas
8. **Protocol reference** — all event types with payload schemas
9. **Self-hosting** — how to run the server on a remote machine (environment variables, nginx reverse proxy for HTTPS/WSS)
10. **Security model** — explanation of HMAC auth, what the project secret protects, what the auth token protects, what data is stored
11. **Extending Mesh** — how to add new event types and tools: add to `EventType`, add payload interface, add tool in `tools.ts`, add detection logic in `conflict-detector.ts` if needed

---

## Implementation Order

Build and verify each section in this exact sequence. Do not move to the next section until the current one passes its tests.

```
1.  types.ts                    — no dependencies, foundational
2.  schema.sql + event-store    — depends on types
3.  session-registry            — depends on types and event-store
4.  conflict-detector           — depends on event-store
5.  context-summariser          — depends on event-store + session-registry
6.  rest-api                    — depends on all above
7.  ws-hub                      — depends on all above
8.  server/index.ts             — wires everything, server is complete
9.  mcp-plugin/ws-client        — depends on types
10. mcp-plugin/tools            — depends on ws-client
11. mcp-plugin/resources        — depends on ws-client
12. mcp-plugin/index.ts         — plugin is complete
13. conductor/                  — depends on REST API and WebSocket observer
14. scripts/setup.sh            — depends on all of the above being buildable
15. Integration tests           — validates the full system end to end
16. README                      — written last, based on the real implementation
```

At each step, run the unit tests for that component before proceeding. The integration tests at step 15 validate the full system. Do not consider the project complete until all integration tests pass.