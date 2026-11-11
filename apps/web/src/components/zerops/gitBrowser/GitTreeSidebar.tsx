/**
 * The repository's folders at the page's commit beside its file or folder: each folder read when
 * it is first opened, at most four at once, so a large repository is never walked whole. It opens
 * expanded down to the page's path; on narrow screens it is not shown.
 */
import { FileTree, useFileTree } from "@pierre/trees/react";
import type { GitTree } from "@t3tools/shared/hqGitBrowse/tree";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TREE_UNSAFE_CSS } from "~/components/files/treeStyle";
import { useTheme } from "~/hooks/useTheme";
import { T3_PIERRE_ICONS } from "~/pierre-icons";
import { useGitBrowseReads } from "~/zerops/useGitBrowse";
import type { RepoPathTarget } from "./RepoMarkdown";
import {
  foldersOpenedAt,
  foldersToAsk,
  rowPath,
  treeShape,
  syncTree,
} from "./GitTreeSidebar.logic";

export function GitTreeSidebar({
  appId,
  repo,
  sha,
  path,
  kind,
  onOpen,
}: RepoPathTarget & {
  readonly appId: string;
  readonly repo: string;
  readonly sha: string;
  readonly onOpen: (target: RepoPathTarget) => void;
}) {
  const { resolvedTheme } = useTheme();
  const at = useMemo(() => ({ path, kind }), [path, kind]);
  // Opened folders stay opened (and held) while the page stays on this commit.
  const [opened, setOpened] = useState<ReadonlyArray<string>>(() => foldersOpenedAt(at));
  const [asked, setAsked] = useState<ReadonlyArray<string>>([]);
  const open = useCallback(
    (folders: ReadonlyArray<string>) =>
      setOpened((previous) => {
        const fresh = folders.filter((folder) => !previous.includes(folder));
        return fresh.length === 0 ? previous : [...previous, ...fresh];
      }),
    [],
  );
  // A page opened further down opens the folders on its way.
  const [openedAt, setOpenedAt] = useState(at);
  if (openedAt !== at) {
    setOpenedAt(at);
    open(foldersOpenedAt(at));
  }
  // Folders the person closed stay closed when listings arrive.
  const collapsed = useRef(new Set<string>());

  const { views } = useGitBrowseReads(
    asked.map((path) => ({ appId, repo, read: "tree" as const, params: { sha, path } })),
    true,
  );
  const folders = useMemo(() => {
    const read = new Map<string, GitTree>();
    asked.forEach((folder, index) => {
      const view = views[index];
      if (view?.state === "known") read.set(folder, view.answer);
    });
    return read;
  }, [asked, views]);
  const settled = useMemo(
    () =>
      new Set(
        asked.filter((_, index) => views[index] !== undefined && views[index]!.state !== "unread"),
      ),
    [asked, views],
  );
  const next = foldersToAsk(opened, asked, settled);
  if (next.length !== asked.length || next.some((folder, index) => folder !== asked[index]))
    setAsked(next);

  const shape = useMemo(() => treeShape(opened, folders, at), [opened, folders, at]);
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  });
  // Selection the page itself sets is the page's path, not a request to open it again.
  const syncing = useRef(false);
  const { model } = useFileTree({
    density: "compact",
    initialExpansion: "closed",
    flattenEmptyDirectories: false,
    icons: T3_PIERRE_ICONS,
    paths: [],
    search: false,
    unsafeCSS: TREE_UNSAFE_CSS,
    onSelectionChange: (selected) => {
      const row = selected.at(-1);
      if (syncing.current || row === undefined) return;
      onOpenRef.current({ path: rowPath(row), kind: row.endsWith("/") ? "tree" : "file" });
    },
  });
  useEffect(() => {
    syncing.current = true;
    syncTree(model, shape, at, collapsed.current);
    syncing.current = false;
  }, [model, shape, at]);
  // A folder opened in the tree is read then: the tree tells no one, so its rows are watched.
  useEffect(
    () =>
      model.subscribe(() => {
        if (syncing.current) return;
        const expanded: Array<string> = [];
        for (const row of shape.rows) {
          const item = row.endsWith("/") ? model.getItem(row) : null;
          if (item === null || item === undefined || !("isExpanded" in item)) continue;
          if (item.isExpanded()) {
            collapsed.current.delete(row);
            expanded.push(rowPath(row));
          } else collapsed.current.add(row);
        }
        open(expanded);
      }),
    [model, shape, open],
  );
  return (
    <aside aria-label="Folders" className="hidden min-h-0 w-64 shrink-0 flex-col lg:flex">
      <FileTree
        model={model}
        aria-label={`${repo} folders`}
        className="min-h-96 flex-1 overflow-hidden"
        style={{
          colorScheme: resolvedTheme,
          ["--trees-fg-override" as string]: "var(--contrast-foreground)",
        }}
      />
    </aside>
  );
}
