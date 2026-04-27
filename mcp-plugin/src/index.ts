#!/usr/bin/env node
import { execSync } from 'child_process';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { MeshWsClient } from './ws-client';
import { MeshTools } from './tools';
import { MeshResources } from './resources';

// ── Config ──────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    process.stderr.write(`[mesh] ERROR: ${name} is required\n`);
    process.exit(1);
  }
  return val;
}

function detectBranch(): string {
  try {
    return execSync('git branch --show-current', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'main';
  }
}

const MESH_HOST = process.env.MESH_HOST ?? 'localhost';
const MESH_PORT = parseInt(process.env.MESH_PORT ?? '3747', 10);
const MESH_PROJECT_ID = requireEnv('MESH_PROJECT_ID');
const MESH_SESSION_ID = requireEnv('MESH_SESSION_ID');
const MESH_DEVELOPER_NAME = requireEnv('MESH_DEVELOPER_NAME');
const MESH_BRANCH = process.env.MESH_BRANCH ?? detectBranch();
const MESH_AUTH_TOKEN = requireEnv('MESH_AUTH_TOKEN');

// ── WebSocket client ─────────────────────────────────────────────────────────

const wsClient = new MeshWsClient(MESH_HOST, MESH_PORT, {
  session_id: MESH_SESSION_ID,
  project_id: MESH_PROJECT_ID,
  developer_name: MESH_DEVELOPER_NAME,
  branch: MESH_BRANCH,
  auth_token: MESH_AUTH_TOKEN,
});

// Log peer events to stderr so they are visible in Claude Code's tool output
wsClient.on('peer_connected', (msg) => {
  process.stderr.write(`[mesh] Peer connected: ${msg.developer_name} on ${msg.branch}\n`);
});

wsClient.on('peer_disconnected', (msg) => {
  process.stderr.write(`[mesh] Peer disconnected: ${msg.developer_name}\n`);
});

wsClient.on('server_error', (msg) => {
  process.stderr.write(`[mesh] Server error: ${msg.message}\n`);
  if (msg.message === 'invalid_auth') {
    process.stderr.write('[mesh] Authentication failed — check MESH_AUTH_TOKEN. Not retrying.\n');
    wsClient.close();
  }
});

wsClient.connect();

// ── Tools & resources ────────────────────────────────────────────────────────

const meshTools = new MeshTools(wsClient, {
  project_id: MESH_PROJECT_ID,
  session_id: MESH_SESSION_ID,
  developer_name: MESH_DEVELOPER_NAME,
  branch: MESH_BRANCH,
  server_host: MESH_HOST,
  server_port: MESH_PORT,
});

const meshResources = new MeshResources(meshTools);
meshResources.start();

// ── MCP server ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'mesh', version: '1.0.0' },
  { capabilities: { tools: {}, resources: {} } }
);

// Tool list
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'mesh_broadcast_intent',
      description: 'Broadcast what you are about to do before starting any task that touches shared code.',
      inputSchema: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'What you are about to do' },
          files_affected: { type: 'array', items: { type: 'string' }, description: 'Relative file paths you plan to touch' },
          estimated_scope: { type: 'string', enum: ['small', 'medium', 'large'] },
          reversible: { type: 'boolean', description: 'Whether this can be easily undone' },
        },
        required: ['description', 'files_affected', 'estimated_scope', 'reversible'],
      },
    },
    {
      name: 'mesh_lock_files',
      description: 'Lock files when you begin actively editing them.',
      inputSchema: {
        type: 'object',
        properties: {
          paths: { type: 'array', items: { type: 'string' }, description: 'File paths to lock' },
          reason: { type: 'string', description: 'Why these files are being locked' },
          exclusive: { type: 'boolean', description: 'Whether other Claudes should not touch these files' },
        },
        required: ['paths', 'reason', 'exclusive'],
      },
    },
    {
      name: 'mesh_unlock_files',
      description: 'Release file locks when you finish editing.',
      inputSchema: {
        type: 'object',
        properties: {
          paths: { type: 'array', items: { type: 'string' }, description: 'File paths to release' },
        },
        required: ['paths'],
      },
    },
    {
      name: 'mesh_record_decision',
      description: 'Record an architectural or technical decision.',
      inputSchema: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['architecture', 'library', 'api_contract', 'pattern', 'naming', 'other'] },
          summary: { type: 'string', description: 'One sentence description of the decision' },
          rationale: { type: 'string', description: 'Why this decision was made' },
          affected_files: { type: 'array', items: { type: 'string' } },
          rejected_alternatives: { type: 'array', items: { type: 'string' }, description: 'What was considered and rejected' },
        },
        required: ['category', 'summary', 'rationale', 'affected_files', 'rejected_alternatives'],
      },
    },
    {
      name: 'mesh_ask_partner',
      description: 'Ask a partner Claude a question. Set urgent=true to block until answered.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The question' },
          context: { type: 'string', description: 'Relevant context for the question' },
          urgent: { type: 'boolean', description: 'Whether to block until answered (120s timeout)' },
        },
        required: ['text', 'context', 'urgent'],
      },
    },
    {
      name: 'mesh_answer_question',
      description: 'Answer a question from a partner Claude.',
      inputSchema: {
        type: 'object',
        properties: {
          question_id: { type: 'string', description: 'The question_id from the partner context' },
          answer: { type: 'string', description: 'Your answer' },
        },
        required: ['question_id', 'answer'],
      },
    },
    {
      name: 'mesh_declare_blocker',
      description: 'Declare that you are blocked waiting for something a partner is building.',
      inputSchema: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'What you are blocked on' },
          waiting_for: { type: 'string', description: 'What specifically is needed to unblock' },
        },
        required: ['description', 'waiting_for'],
      },
    },
    {
      name: 'mesh_resolve_blocker',
      description: 'Resolve a previously declared blocker.',
      inputSchema: {
        type: 'object',
        properties: {
          blocker_id: { type: 'string', description: 'The blocker_id to resolve' },
          resolution: { type: 'string', description: 'How it was resolved' },
        },
        required: ['blocker_id', 'resolution'],
      },
    },
    {
      name: 'mesh_get_partner_context',
      description: 'Get a full summary of what all partner developers are currently doing. Call this at the start of every new task.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'mesh_heartbeat',
      description: 'Send a heartbeat to keep the server updated with your current status. Call every 2-3 minutes.',
      inputSchema: {
        type: 'object',
        properties: {
          current_task: { type: 'string', description: 'What you are currently working on' },
          active_files: { type: 'array', items: { type: 'string' }, description: 'Files you are currently working in' },
          status: { type: 'string', enum: ['working', 'thinking', 'waiting', 'idle'] },
        },
        required: ['current_task', 'active_files', 'status'],
      },
    },
  ],
}));

// Tool dispatch
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    let result: unknown;

    switch (name) {
      case 'mesh_broadcast_intent':
        result = await meshTools.broadcastIntent(args as any);
        break;
      case 'mesh_lock_files':
        result = await meshTools.lockFiles(args as any);
        break;
      case 'mesh_unlock_files':
        result = await meshTools.unlockFiles(args as any);
        break;
      case 'mesh_record_decision':
        result = await meshTools.recordDecision(args as any);
        break;
      case 'mesh_ask_partner':
        result = await meshTools.askPartner(args as any);
        break;
      case 'mesh_answer_question':
        result = await meshTools.answerQuestion(args as any);
        break;
      case 'mesh_declare_blocker':
        result = await meshTools.declareBlocker(args as any);
        break;
      case 'mesh_resolve_blocker':
        result = await meshTools.resolveBlocker(args as any);
        break;
      case 'mesh_get_partner_context':
        result = await meshTools.getPartnerContext();
        break;
      case 'mesh_heartbeat':
        result = await meshTools.sendHeartbeat(args as any);
        break;
      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (err: any) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// Resources
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [meshResources.getResourceDefinition()],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri !== meshResources.uri) {
    return { contents: [] };
  }
  const text = await meshResources.readResource();
  return {
    contents: [
      {
        uri: meshResources.uri,
        mimeType: 'text/plain',
        text,
      },
    ],
  };
});

// ── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  process.stderr.write(`[mesh] MCP plugin started (session: ${MESH_SESSION_ID})\n`);
});
