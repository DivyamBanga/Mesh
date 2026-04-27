import Database from 'better-sqlite3';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

export interface Project {
  project_id: string;
  name: string;
  invite_code: string;
  secret: string;
  created_at: number;
}

export class ProjectManager {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  createProject(name: string): Project {
    const project_id = uuidv4();
    const invite_code = this.generateInviteCode();
    const secret = crypto.randomBytes(32).toString('base64');
    const created_at = Date.now();

    this.db.prepare(`
      INSERT INTO projects (project_id, name, invite_code, secret, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(project_id, name, invite_code, secret, created_at);

    return { project_id, name, invite_code, secret, created_at };
  }

  getProject(projectId: string): Project | undefined {
    return this.db.prepare('SELECT * FROM projects WHERE project_id = ?')
      .get(projectId) as Project | undefined;
  }

  getProjectByInviteCode(inviteCode: string): Project | undefined {
    return this.db.prepare('SELECT * FROM projects WHERE invite_code = ?')
      .get(inviteCode.toUpperCase()) as Project | undefined;
  }

  generateAuthToken(projectSecret: string, projectId: string, sessionId: string, developerName: string): string {
    const message = `${projectId}:${sessionId}:${developerName}`;
    return crypto.createHmac('sha256', projectSecret).update(message).digest('hex');
  }

  validateAuthToken(authToken: string, projectId: string, sessionId: string, developerName: string): boolean {
    const project = this.getProject(projectId);
    if (!project) return false;
    const expected = this.generateAuthToken(project.secret, projectId, sessionId, developerName);
    // constant-time comparison
    try {
      return crypto.timingSafeEqual(Buffer.from(authToken, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return false;
    }
  }

  private generateInviteCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'MESH-';
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    // Ensure uniqueness
    const existing = this.db.prepare('SELECT invite_code FROM projects WHERE invite_code = ?').get(code);
    if (existing) return this.generateInviteCode();
    return code;
  }
}
