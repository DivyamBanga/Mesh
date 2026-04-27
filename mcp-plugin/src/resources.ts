import { MeshTools } from './tools';

const RESOURCE_URI = 'mesh://partner-context';
const REFRESH_INTERVAL_MS = 60000;

export class MeshResources {
  private cache: string = 'Partner context not yet loaded.';
  private lastRefresh = 0;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private tools: MeshTools) {}

  start(): void {
    this.refresh();
    this.refreshTimer = setInterval(() => this.refresh(), REFRESH_INTERVAL_MS);
  }

  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  async readResource(): Promise<string> {
    // If cache is stale (older than refresh interval), refresh synchronously
    if (Date.now() - this.lastRefresh > REFRESH_INTERVAL_MS) {
      await this.refresh();
    }
    return this.cache;
  }

  getResourceDefinition() {
    return {
      uri: RESOURCE_URI,
      name: 'Partner Developer Context',
      description: 'Current state of all partner Claude Code sessions in this project',
      mimeType: 'text/plain',
    };
  }

  get uri(): string {
    return RESOURCE_URI;
  }

  private async refresh(): Promise<void> {
    try {
      const { summary } = await this.tools.getPartnerContext();
      this.cache = summary;
      this.lastRefresh = Date.now();
    } catch {
      // Keep stale cache on error
    }
  }
}
