import { useState } from 'react';
import { MeshApi, type MeshCredentials as Creds } from '@/lib/mesh-api';
import { useMesh } from '@/context/MeshContext';

type Tab = 'create' | 'join';

function MeshLogo() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-8 w-8 text-foreground/85"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
    >
      <path
        d="M5 5 L19 5 M5 5 L12 12 M19 5 L12 12 M5 5 L5 19 M19 5 L19 19 M12 12 L5 19 M12 12 L19 19 M5 19 L19 19"
        opacity="0.55"
      />
      {([[5, 5], [19, 5], [12, 12], [5, 19], [19, 19]] as [number, number][]).map(
        ([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r={1.6} fill="currentColor" stroke="none" />
        ),
      )}
    </svg>
  );
}

export function SetupScreen() {
  const { configure } = useMesh();
  const [tab, setTab] = useState<Tab>('create');
  const [serverUrl, setServerUrl] = useState('http://localhost:3747');
  const [projectName, setProjectName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!projectName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await MeshApi.createProject(serverUrl.trim(), projectName.trim());
      const creds: Creds = {
        serverUrl: serverUrl.trim(),
        projectId: result.project_id,
        projectSecret: result.project_secret,
        projectName: projectName.trim(),
        inviteCode: result.invite_code,
      };
      configure(creds);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const code = inviteCode.trim().toUpperCase();
    if (!code) return;
    setLoading(true);
    setError(null);
    try {
      const result = await MeshApi.joinProject(serverUrl.trim(), code, 'conductor');
      const creds: Creds = {
        serverUrl: serverUrl.trim(),
        projectId: result.project_id,
        projectSecret: result.project_secret,
        projectName: code, // use invite code as display name until we know the real name
        inviteCode: code,
      };
      configure(creds);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const tabCls = (t: Tab) =>
    `px-4 py-1.5 text-[12px] border-b-2 transition-colors ${
      tab === t
        ? 'border-foreground/85 text-foreground'
        : 'border-transparent text-muted-foreground hover:text-foreground'
    }`;

  const inputCls =
    'w-full bg-background border border-border rounded-sm px-3 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground outline-none focus:border-foreground/40 transition-colors';

  return (
    <main className="h-screen w-screen flex items-center justify-center bg-background text-foreground">
      <div className="w-full max-w-sm border border-border rounded-sm bg-surface overflow-hidden">
        {/* Header */}
        <div className="flex flex-col items-center gap-2 px-6 pt-8 pb-5">
          <MeshLogo />
          <div>
            <div className="text-[15px] font-semibold text-foreground text-center font-sans-ui">
              Mesh Conductor
            </div>
            <div className="text-[12px] text-muted-foreground text-center mt-0.5">
              Multi-agent command center
            </div>
          </div>
        </div>

        {/* Server URL */}
        <div className="px-6 pb-4">
          <label className="block text-[11px] text-muted-foreground uppercase tracking-wider mb-1.5">
            Server URL
          </label>
          <input
            className={inputCls}
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="http://localhost:3747"
          />
        </div>

        {/* Tabs */}
        <div className="flex border-t border-border px-6 gap-0">
          <button type="button" className={tabCls('create')} onClick={() => setTab('create')}>
            Create project
          </button>
          <button type="button" className={tabCls('join')} onClick={() => setTab('join')}>
            Join project
          </button>
        </div>

        {/* Form */}
        <div className="px-6 py-5">
          {tab === 'create' ? (
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-[11px] text-muted-foreground uppercase tracking-wider mb-1.5">
                  Project name
                </label>
                <input
                  className={inputCls}
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="payments-platform"
                  autoFocus
                />
              </div>
              {error && (
                <div className="text-[12px] text-status-red bg-status-red/10 border border-status-red/30 rounded-sm px-3 py-2">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={loading || !projectName.trim()}
                className="w-full py-2 bg-foreground text-background text-[13px] font-medium rounded-sm hover:bg-foreground/90 disabled:opacity-40 transition-colors"
              >
                {loading ? 'Creating…' : 'Create project'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleJoin} className="space-y-4">
              <div>
                <label className="block text-[11px] text-muted-foreground uppercase tracking-wider mb-1.5">
                  Invite code
                </label>
                <input
                  className={`${inputCls} uppercase tracking-widest`}
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="MESH-XXXX"
                  autoFocus
                />
              </div>
              {error && (
                <div className="text-[12px] text-status-red bg-status-red/10 border border-status-red/30 rounded-sm px-3 py-2">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={loading || !inviteCode.trim()}
                className="w-full py-2 bg-foreground text-background text-[13px] font-medium rounded-sm hover:bg-foreground/90 disabled:opacity-40 transition-colors"
              >
                {loading ? 'Joining…' : 'Join project'}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
