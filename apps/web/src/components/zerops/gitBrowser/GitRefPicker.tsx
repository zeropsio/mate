/**
 * Which branch, tag or commit the repository's pages read: Mate's branches, its changes' branches
 * by their titles, what HQ follows from GitHub, and tags, a page at a time from HQ, filtered on HQ
 * as the person types. A typed commit id is offered as a commit. `w` opens it.
 */
import type { GitRefKind } from "@t3tools/shared/hqGitBrowse/common";
import type { GitRefItem } from "@t3tools/shared/hqGitBrowse/refs";
import { ChevronDownIcon, GitBranchIcon } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxStatus,
  ComboboxTrigger,
} from "~/components/ui/combobox";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { isEditableFocused } from "~/lib/editableFocus";
import { useDebouncedValue } from "~/state/queries";
import { useGitBrowseReads } from "~/zerops/useGitBrowse";
import { pickerSections, type PickerChange, type PickerRow } from "./GitRefPicker.logic";

const FILTER_DEBOUNCE_MS = 200;
type ListKind = "branch" | "tag";

export function GitRefPicker({
  appId,
  repo,
  label,
  kind,
  changes,
  mounted,
  onPick,
  title = "Branch or tag",
  shortcut = true,
}: {
  readonly appId: string;
  readonly repo: string;
  /** What the page reads now: a branch's or tag's name, or `Commit abc1234`. */
  readonly label: string;
  readonly kind: GitRefKind | null;
  readonly changes: ReadonlyArray<PickerChange>;
  /** Mounted from GitHub: what HQ does not follow yet is on GitHub. */
  readonly mounted: boolean;
  readonly onPick: (rev: string) => void;
  /** What the button is called, where a page has more than one. */
  readonly title?: string;
  /** `w` opens it: only the frame's picker answers it. */
  readonly shortcut?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ListKind>(
    kind === "tag" || kind === "github-tag" ? "tag" : "branch",
  );
  const [typed, setTyped] = useState("");
  const q = useDebouncedValue(typed.trim(), FILTER_DEBOUNCE_MS);
  // "Show more" pages of this list and filter; another list or filter starts from its first page.
  const [more, setMore] = useState<{
    readonly of: string;
    readonly cursors: ReadonlyArray<string>;
  }>({ of: "", cursors: [] });
  const of = `${list}\n${q}`;
  const cursors = more.of === of ? more.cursors : [];
  const params = { kind: list, ...(q === "" ? {} : { q }) };
  const { views, again } = useGitBrowseReads(
    [undefined, ...cursors].map((cursor) => ({
      appId,
      repo,
      read: "refs" as const,
      params: cursor === undefined ? params : { ...params, cursor },
    })),
    // Refs are read while the picker is open, never for a page that only shows which one it reads.
    open ? true : undefined,
  );

  useEffect(() => {
    if (!shortcut) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "w" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.defaultPrevented || isEditableFocused(event.target)) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut]);

  const items = useMemo(
    () =>
      views.flatMap((view): ReadonlyArray<GitRefItem> =>
        view.state === "known" ? view.answer.items : [],
      ),
    [views],
  );
  const sections = useMemo(
    () => pickerSections({ items, query: typed, changes }),
    [items, typed, changes],
  );
  const rows = useMemo(() => sections.flatMap((section) => section.rows), [sections]);
  const byValue = useMemo(() => new Map(rows.map((row) => [row.value, row])), [rows]);
  const indexOf = useMemo(() => new Map(rows.map((row, at) => [row.value, at])), [rows]);
  const last = views.at(-1);
  const next = last?.state === "known" ? last.answer.next : null;
  const trouble = views.find((view) => view.state === "failed" || view.state === "refused");
  const reading = views.some(
    (view) => view.state === "unread" || (view.state === "known" && view.busy),
  );
  const noun = list === "branch" ? "branches" : "tags";
  const pick = (row: PickerRow) => {
    setOpen(false);
    setTyped("");
    onPick(row.rev);
  };

  return (
    <Combobox<string>
      items={rows.map((row) => row.value)}
      filteredItems={rows.map((row) => row.value)}
      autoHighlight
      open={open}
      onOpenChange={setOpen}
      value={null}
      onValueChange={(value) => {
        const row = value === null ? undefined : byValue.get(value);
        if (row !== undefined) pick(row);
      }}
    >
      <ComboboxTrigger render={<Button variant="secondary" size="sm" />} aria-label={title}>
        <GitBranchIcon aria-hidden="true" />
        <span className="max-w-64 truncate">{label}</span>
        <ChevronDownIcon aria-hidden="true" />
      </ComboboxTrigger>
      <ComboboxPopup align="start" className="flex w-96 flex-col">
        <div className="px-3 pt-2.5">
          <ToggleGroup
            aria-label="List"
            variant="segmented"
            value={[list]}
            onValueChange={(value) => {
              if (value[0] === "branch" || value[0] === "tag") setList(value[0]);
            }}
          >
            <Toggle value="branch">Branches</Toggle>
            <Toggle value="tag">Tags</Toggle>
          </ToggleGroup>
        </div>
        <ComboboxSearchInput
          aria-label={`Find a ${list === "branch" ? "branch" : "tag"} or commit`}
          placeholder={list === "branch" ? "Find a branch" : "Find a tag"}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
        <ComboboxEmpty>
          {reading ? "" : q === "" ? `No ${noun} yet.` : `No ${noun} match.`}
        </ComboboxEmpty>
        <ComboboxList>
          {sections.map((section) => (
            <Fragment key={section.name}>
              <div className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                {section.name}
              </div>
              {section.rows.map((row) => (
                <ComboboxItem
                  hideIndicator
                  key={row.value}
                  index={indexOf.get(row.value)}
                  value={row.value}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{row.label}</span>
                    {row.detail === null ? null : (
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {row.detail}
                      </span>
                    )}
                  </span>
                  {row.outsideMate ? <Badge>outside Mate</Badge> : null}
                </ComboboxItem>
              ))}
            </Fragment>
          ))}
        </ComboboxList>
        {next === null ? null : (
          <div className="px-2 pb-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={reading}
              onClick={() => setMore({ of, cursors: [...cursors, next] })}
            >
              Show more
            </Button>
          </div>
        )}
        {trouble !== undefined ? (
          <div className="flex items-center gap-2 px-3 pb-2">
            <p className="text-xs text-status-failed" role="alert">
              {trouble.state === "failed" || trouble.state === "refused" ? trouble.words : null}
            </p>
            <Button variant="ghost" size="sm" onClick={again}>
              Read again
            </Button>
          </div>
        ) : null}
        <ComboboxStatus>
          {reading
            ? `Reading ${noun}…`
            : mounted && !items.some((item) => item.outsideMate)
              ? "Other branches and tags are on GitHub."
              : ""}
        </ComboboxStatus>
      </ComboboxPopup>
    </Combobox>
  );
}
