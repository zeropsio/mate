/**
 * A folder of a commit: each entry's name, size and what it is, folders first as HQ lists them.
 * Past {@link PLAIN_ROWS} entries only the rows in view are drawn.
 */
import type { GitTreeEntry } from "@t3tools/shared/hqGitBrowse/tree";
import { entryLabel } from "@t3tools/client-runtime/zerops/gitBrowse/tree";
import { fileSize } from "@t3tools/client-runtime/zerops/gitBrowse/blob";
import { LegendList } from "@legendapp/list/react";
import { FileIcon, FolderIcon, LinkIcon, PackageIcon } from "lucide-react";
import type { MouseEvent } from "react";

/** Rows drawn as a plain list; a longer folder draws only the rows in view. */
const PLAIN_ROWS = 100;
const ROW_HEIGHT = 40;
/** The tallest a long folder's list stands before it scrolls inside itself. */
const LONG_LIST_HEIGHT = 640;

const ICONS = { file: FileIcon, folder: FolderIcon, symlink: LinkIcon, submodule: PackageIcon };

const plainClick = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

export interface GitDirectoryListProps {
  readonly entries: ReadonlyArray<GitTreeEntry>;
  /** HQ stopped listing before the folder's end. */
  readonly truncated: boolean;
  readonly hrefOf: (entry: GitTreeEntry) => string;
  readonly onOpen: (entry: GitTreeEntry) => void;
}

function Row({
  entry,
  hrefOf,
  onOpen,
}: { readonly entry: GitTreeEntry } & Pick<GitDirectoryListProps, "hrefOf" | "onOpen">) {
  const Icon = ICONS[entry.type];
  return (
    <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border">
      {entry.type === "submodule" ? (
        <span className="flex min-w-0 items-center gap-3 text-sm text-foreground">
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">
            {entry.name} · submodule {entry.sha.slice(0, 7)}
          </span>
        </span>
      ) : (
        <a
          className="flex min-w-0 items-center gap-3 rounded-sm text-sm text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          href={hrefOf(entry)}
          onClick={(event) => {
            if (!plainClick(event)) return;
            event.preventDefault();
            onOpen(entry);
          }}
        >
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">{entry.name}</span>
        </a>
      )}
      <span className="flex shrink-0 items-center gap-4 text-xs text-muted-foreground">
        {entry.size === undefined ? null : <span>{fileSize(entry.size)}</span>}
        <span>{entryLabel(entry.type)}</span>
      </span>
    </div>
  );
}

export function GitDirectoryList({ entries, truncated, hrefOf, onOpen }: GitDirectoryListProps) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {entries.length === 0 && !truncated ? (
        <p className="text-sm text-muted-foreground">No files here.</p>
      ) : entries.length > PLAIN_ROWS ? (
        <LegendList<GitTreeEntry>
          data={entries as Array<GitTreeEntry>}
          keyExtractor={(entry) => entry.path}
          renderItem={({ item }) => <Row entry={item} hrefOf={hrefOf} onOpen={onOpen} />}
          estimatedItemSize={ROW_HEIGHT}
          style={{ height: Math.min(entries.length * ROW_HEIGHT, LONG_LIST_HEIGHT) }}
        />
      ) : (
        <div>
          {entries.map((entry) => (
            <Row key={entry.path} entry={entry} hrefOf={hrefOf} onOpen={onOpen} />
          ))}
        </div>
      )}
      {truncated ? (
        <p className="text-sm text-muted-foreground">
          Only the first entries are shown. Clone the repository to read the whole folder.
        </p>
      ) : null}
    </div>
  );
}
