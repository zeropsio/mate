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

import { EmptyState } from "~/components/ui/empty";
import { Row } from "~/components/ui/row";
import { Text } from "~/components/ui/text";

/** Rows drawn as a plain list; a longer folder draws only the rows in view. */
const PLAIN_ROWS = 100;
const ROW_HEIGHT = 45;
/** The tallest a long folder's list stands before it scrolls inside itself. */
const LONG_LIST_HEIGHT = 640;

const ICONS = { file: FileIcon, folder: FolderIcon, symlink: LinkIcon, submodule: PackageIcon };

const plainClick = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

interface GitDirectoryListProps {
  readonly entries: ReadonlyArray<GitTreeEntry>;
  /** HQ stopped listing before the folder's end. */
  readonly truncated: boolean;
  readonly hrefOf: (entry: GitTreeEntry) => string;
  readonly onOpen: (entry: GitTreeEntry) => void;
}

function EntryRow({
  entry,
  hrefOf,
  onOpen,
}: { readonly entry: GitTreeEntry } & Pick<GitDirectoryListProps, "hrefOf" | "onOpen">) {
  const Icon = ICONS[entry.type];
  const parts = {
    lead: <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />,
    meta: (
      <span className="flex items-center gap-4">
        {entry.size === undefined ? null : <span>{fileSize(entry.size)}</span>}
        <span>{entryLabel(entry.type)}</span>
      </span>
    ),
    size: "sm",
  } as const;
  return (
    <div className="border-b border-border">
      {entry.type === "submodule" ? (
        <Row {...parts} title={`${entry.name} · submodule ${entry.sha.slice(0, 7)}`} />
      ) : (
        <Row
          {...parts}
          pressable
          render={
            <a
              href={hrefOf(entry)}
              onClick={(event) => {
                if (!plainClick(event)) return;
                event.preventDefault();
                onOpen(entry);
              }}
            />
          }
          title={entry.name}
        />
      )}
    </div>
  );
}

export function GitDirectoryList({ entries, truncated, hrefOf, onOpen }: GitDirectoryListProps) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {entries.length === 0 && !truncated ? (
        <EmptyState size="row">No files here.</EmptyState>
      ) : entries.length > PLAIN_ROWS ? (
        <LegendList<GitTreeEntry>
          data={entries as Array<GitTreeEntry>}
          keyExtractor={(entry) => entry.path}
          renderItem={({ item }) => <EntryRow entry={item} hrefOf={hrefOf} onOpen={onOpen} />}
          estimatedItemSize={ROW_HEIGHT}
          style={{ height: Math.min(entries.length * ROW_HEIGHT, LONG_LIST_HEIGHT) }}
        />
      ) : (
        <div>
          {entries.map((entry) => (
            <EntryRow key={entry.path} entry={entry} hrefOf={hrefOf} onOpen={onOpen} />
          ))}
        </div>
      )}
      {truncated ? (
        <Text render={<p />} variant="description">
          Only the first entries are shown. Clone the repository to read the whole folder.
        </Text>
      ) : null}
    </div>
  );
}
