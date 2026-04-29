import { createFileRoute } from "@tanstack/react-router";
import { Group, Panel, Separator } from "react-resizable-panels";
import { HeaderBar } from "@/components/-/mesh/HeaderBar";
import { FileTreePanel } from "@/components/-/mesh/FileTreePanel";
import { AgentGrid } from "@/components/-/mesh/AgentGrid";
import { TerminalPanel } from "@/components/-/mesh/TerminalPanel";
import { ActivityFeed } from "@/components/-/mesh/ActivityFeed";
import { StatusBar } from "@/components/-/mesh/StatusBar";
import { SetupScreen } from "@/components/-/mesh/SetupScreen";
import { useMesh } from "@/context/MeshContext";

export const Route = createFileRoute("/")({
  component: MeshDashboard,
  head: () => ({
    meta: [
      { title: "Mesh — Multi-Agent Command Center" },
      {
        name: "description",
        content:
          "Mesh is a real-time command center for coordinating multiple Claude Code instances across developers.",
      },
      { property: "og:title", content: "Mesh — Multi-Agent Command Center" },
      {
        property: "og:description",
        content:
          "Coordinate multiple Claude Code agents across your team in real time — locks, intents, decisions, and live terminal streams.",
      },
    ],
  }),
});

// Visible 1px separator with a wider invisible hit-target.
function HSep() {
  return (
    <Separator className="group relative w-px shrink-0 bg-border data-[separator-state=hover]:bg-border-strong data-[separator-state=drag]:bg-foreground/40 transition-colors cursor-col-resize">
      <span className="absolute inset-y-0 -left-1 -right-1" />
    </Separator>
  );
}

function VSep() {
  return (
    <Separator className="group relative h-px shrink-0 bg-border data-[separator-state=hover]:bg-border-strong data-[separator-state=drag]:bg-foreground/40 transition-colors cursor-row-resize">
      <span className="absolute inset-x-0 -top-1 -bottom-1" />
    </Separator>
  );
}

function MeshDashboard() {
  const { credentials } = useMesh();

  if (!credentials) {
    return <SetupScreen />;
  }

  return (
    <main className="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
      <HeaderBar />

      <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
        <Group
          id="mesh-outer"
          orientation="horizontal"
          className="flex h-full w-full"
        >
          <Panel id="files" defaultSize={18} minSize={10} className="min-w-0">
            <FileTreePanel />
          </Panel>

          <HSep />

          <Panel id="center" defaultSize={58} minSize={28} className="min-w-0">
            <Group
              id="mesh-center"
              orientation="vertical"
              className="flex flex-col h-full w-full"
            >
              <Panel id="agents" defaultSize={32} minSize={12} className="min-h-0">
                <AgentGrid />
              </Panel>

              <VSep />

              <Panel id="terminal" defaultSize={68} minSize={20} className="min-h-0">
                <TerminalPanel />
              </Panel>
            </Group>
          </Panel>

          <HSep />

          <Panel id="activity" defaultSize={24} minSize={14} className="min-w-0">
            <ActivityFeed />
          </Panel>
        </Group>
      </div>

      <StatusBar />
    </main>
  );
}
