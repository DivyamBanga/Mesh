import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useMesh } from "@/context/MeshContext";
import type { FileLockEntry } from "@/lib/mesh-api";

// ─── Tree types ───────────────────────────────────────────────────────────────

type Lock = { developer: string };
type FileNode = {
  name: string;
  kind?: "ts" | "tsx" | "json" | "md";
  lock?: Lock;
};
type DirNode = {
  name: string;
  children: Array<DirNode | FileNode>;
  open?: boolean;
};

function isDir(n: DirNode | FileNode): n is DirNode {
  return (n as DirNode).children !== undefined;
}

function extKind(name: string): FileNode["kind"] | undefined {
  const ext = name.split(".").pop();
  if (ext === "ts" || ext === "tsx" || ext === "json" || ext === "md")
    return ext as FileNode["kind"];
  return undefined;
}

function buildTree(locks: FileLockEntry[]): DirNode {
  const root: DirNode = { name: ".", children: [] };
  for (const lock of locks) {
    const parts = lock.path.split("/");
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const dirName = parts[i];
      let dir = cur.children.find(
        (c): c is DirNode => isDir(c) && c.name === dirName,
      );
      if (!dir) {
        dir = { name: dirName, children: [], open: true };
        cur.children.push(dir);
      }
      cur = dir;
    }
    const fileName = parts[parts.length - 1];
    cur.children.push({
      name: fileName,
      kind: extKind(fileName),
      lock: { developer: lock.developer },
    });
  }
  return root;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FileIcon({ kind }: { kind?: FileNode["kind"] }) {
  if (kind === "ts" || kind === "tsx")
    return <span className="text-[10px] font-bold text-muted-foreground w-4 text-center">TS</span>;
  if (kind === "json")
    return <span className="text-[10px] font-bold text-muted-foreground w-4 text-center">{"{}"}</span>;
  if (kind === "md")
    return <span className="text-[10px] font-bold text-muted-foreground w-4 text-center">#</span>;
  return <span className="w-4" />;
}

function LockBadge({ lock }: { lock: Lock }) {
  return (
    <span className="ml-auto px-1.5 py-[1px] text-[9.5px] leading-none rounded-full border border-border bg-surface-3 text-foreground/75 uppercase tracking-wider">
      {lock.developer}
    </span>
  );
}

function TreeNode({ node, depth }: { node: DirNode | FileNode; depth: number }) {
  const [open, setOpen] = useState(isDir(node) ? (node.open ?? true) : false);
  const indent = { paddingLeft: `${depth * 12 + 6}px` };

  if (isDir(node)) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={indent}
          className="flex items-center gap-1 w-full text-left py-[3px] pr-2 text-[12px] text-foreground/85 hover:bg-surface-2 transition-colors"
        >
          {open ? (
            <ChevronDown className="h-3 w-3 text-subtle" />
          ) : (
            <ChevronRight className="h-3 w-3 text-subtle" />
          )}
          <span className="text-foreground/90">{node.name}/</span>
        </button>
        {open && (
          <div>
            {node.children.map((c, i) => (
              <TreeNode key={i} node={c} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      style={indent}
      className="group flex items-center gap-2 py-[3px] pr-2 text-[12px] text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-colors cursor-default"
    >
      <FileIcon kind={node.kind} />
      <span className="truncate">{node.name}</span>
      {node.lock && <LockBadge lock={node.lock} />}
    </div>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

export function FileTreePanel() {
  const { fileLocks } = useMesh();
  const tree = buildTree(fileLocks);
  const hasLocks = fileLocks.length > 0;

  return (
    <aside className="h-full w-full bg-surface flex flex-col min-h-0">
      <div className="flex items-center justify-between px-3 h-8 border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>Locked files</span>
        <span className="px-1.5 py-[1px] rounded-sm bg-surface-2 text-foreground/70 normal-case tracking-normal text-[10.5px]">
          {fileLocks.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin py-1">
        {hasLocks ? (
          tree.children.map((c, i) => <TreeNode key={i} node={c} depth={0} />)
        ) : (
          <div className="flex items-center justify-center h-16 text-[11.5px] text-muted-foreground">
            No locked files
          </div>
        )}
      </div>
    </aside>
  );
}
