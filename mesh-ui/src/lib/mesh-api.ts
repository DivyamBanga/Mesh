export interface SessionSummary {
  session_id: string;
  developer_name: string;
  branch: string;
  ws_connected: boolean;
  last_seen: number;
  connected_at: number;
  status: 'working' | 'thinking' | 'waiting' | 'idle';
  current_task: string;
}

export interface FileLockEntry {
  path: string;
  project_id: string;
  session_id: string;
  developer: string;
  locked_at: number;
  reason: string;
}

export interface EventEntry {
  event_id: string;
  project_id: string;
  session_id: string;
  developer: string;
  event_type: string;
  payload: any;
  created_at: number;
}

export interface ConflictEntry {
  conflict_id: string;
  type: string;
  severity: 'warning' | 'critical';
  description: string;
  sessions_involved: string[];
  files_involved: string[];
  recommendation: string;
}

export class MeshApi {
  constructor(
    private serverUrl: string,
    private projectId: string,
    private projectSecret: string,
  ) {}

  private get headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.projectSecret}`,
    };
  }

  async getSessions(): Promise<SessionSummary[]> {
    const res = await fetch(`${this.serverUrl}/api/project/${this.projectId}/sessions`, {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`getSessions: ${res.status}`);
    return res.json();
  }

  async getEvents(limit = 100): Promise<EventEntry[]> {
    const res = await fetch(
      `${this.serverUrl}/api/project/${this.projectId}/events?limit=${limit}`,
      { headers: this.headers },
    );
    if (!res.ok) throw new Error(`getEvents: ${res.status}`);
    return res.json();
  }

  async getLocks(): Promise<FileLockEntry[]> {
    const res = await fetch(`${this.serverUrl}/api/project/${this.projectId}/locks`, {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`getLocks: ${res.status}`);
    return res.json();
  }

  async getDecisions(): Promise<EventEntry[]> {
    const res = await fetch(`${this.serverUrl}/api/project/${this.projectId}/decisions`, {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`getDecisions: ${res.status}`);
    return res.json();
  }

  async getConflicts(): Promise<ConflictEntry[]> {
    const res = await fetch(`${this.serverUrl}/api/project/${this.projectId}/conflicts`, {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`getConflicts: ${res.status}`);
    return res.json();
  }

  static async createProject(
    serverUrl: string,
    name: string,
  ): Promise<{ project_id: string; invite_code: string; project_secret: string }> {
    const res = await fetch(`${serverUrl}/api/project/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  static async joinProject(
    serverUrl: string,
    inviteCode: string,
    developerName: string,
  ): Promise<{ project_id: string; project_secret: string }> {
    const res = await fetch(`${serverUrl}/api/project/${inviteCode}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ developer_name: developerName }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }
}
