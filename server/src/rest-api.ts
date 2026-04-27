import express, { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { EventStore } from './event-store';
import { SessionRegistry } from './session-registry';
import { ContextSummariser } from './context-summariser';
import { ProjectManager } from './project-manager';
import { ConflictReport } from './types';

export function createRestRouter(
  eventStore: EventStore,
  sessionRegistry: SessionRegistry,
  contextSummariser: ContextSummariser,
  projectManager: ProjectManager,
  conflictStore: { getRecent: (projectId: string) => ConflictReport[] }
): Router {
  const router = Router();

  // Auth middleware for project routes
  function requireProjectAuth(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing Authorization header' });
      return;
    }
    const secret = authHeader.slice(7);
    const project = projectManager.getProject(req.params.projectId);
    if (!project || project.secret !== secret) {
      res.status(401).json({ error: 'Invalid project secret' });
      return;
    }
    next();
  }

  // Health check
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  // Create project
  router.post('/api/project/create', (req: Request, res: Response) => {
    const { name, developer_name } = req.body;
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const project = projectManager.createProject(name);
    // Create initial session if developer_name provided
    let session_id: string | undefined;
    let auth_token: string | undefined;
    if (developer_name) {
      session_id = `${developer_name}-${uuidv4()}`;
      auth_token = projectManager.generateAuthToken(project.secret, project.project_id, session_id, developer_name);
    }
    res.json({
      project_id: project.project_id,
      invite_code: project.invite_code,
      auth_token: session_id ? auth_token : undefined,
      session_id,
      project_secret: project.secret,
    });
  });

  // Join project via invite code
  router.post('/api/project/:inviteCode/join', (req: Request, res: Response) => {
    const project = projectManager.getProjectByInviteCode(req.params.inviteCode);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const { developer_name } = req.body;
    if (!developer_name) {
      res.status(400).json({ error: 'developer_name is required' });
      return;
    }
    const session_id = `${developer_name}-${uuidv4()}`;
    const auth_token = projectManager.generateAuthToken(project.secret, project.project_id, session_id, developer_name);
    res.json({
      project_id: project.project_id,
      session_id,
      auth_token,
      project_secret: project.secret,
    });
  });

  // Create session (used by setup script)
  router.post('/api/project/:projectId/session/create', requireProjectAuth, (req: Request, res: Response) => {
    const { developer_name } = req.body;
    if (!developer_name) {
      res.status(400).json({ error: 'developer_name is required' });
      return;
    }
    const project = projectManager.getProject(req.params.projectId)!;
    const session_id = `${developer_name}-${uuidv4()}`;
    const auth_token = projectManager.generateAuthToken(project.secret, project.project_id, session_id, developer_name);
    res.json({ session_id, auth_token });
  });

  // All project-scoped GET routes
  router.get('/api/project/:projectId/sessions', requireProjectAuth, (req: Request, res: Response) => {
    const sessions = sessionRegistry.getSessionsForProject(req.params.projectId);
    res.json(sessions.map(s => ({
      session_id: s.session_id,
      developer_name: s.developer_name,
      branch: s.branch,
      ws_connected: s.ws_connected,
      last_seen: s.last_seen,
      connected_at: s.connected_at,
      status: s.heartbeat?.status ?? 'idle',
      current_task: s.heartbeat?.current_task ?? '',
    })));
  });

  router.get('/api/project/:projectId/events', requireProjectAuth, (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string ?? '50', 10);
    const typesParam = req.query.types as string;
    const types = typesParam ? typesParam.split(',') as any[] : undefined;
    const events = eventStore.getRecentEvents(req.params.projectId, limit, types);
    res.json(events);
  });

  router.get('/api/project/:projectId/locks', requireProjectAuth, (req: Request, res: Response) => {
    const locks = eventStore.getFileLocks(req.params.projectId);
    res.json(locks);
  });

  router.get('/api/project/:projectId/decisions', requireProjectAuth, (req: Request, res: Response) => {
    const since = req.query.since ? parseInt(req.query.since as string, 10) : undefined;
    const decisions = eventStore.getDecisions(req.params.projectId, since);
    res.json(decisions);
  });

  router.get('/api/project/:projectId/context', requireProjectAuth, (req: Request, res: Response) => {
    const contexts = contextSummariser.buildProjectSummary(req.params.projectId);
    res.json(contexts);
  });

  router.get('/api/project/:projectId/conflicts', requireProjectAuth, (req: Request, res: Response) => {
    const conflicts = conflictStore.getRecent(req.params.projectId);
    res.json(conflicts);
  });

  return router;
}
