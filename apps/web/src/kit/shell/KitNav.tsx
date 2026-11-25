import { ChevronRightIcon, SearchIcon } from "lucide-react";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { Kbd } from "~/components/ui/kbd";
import { prefersReducedMotion } from "~/lib/reducedMotion";
import {
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";

import {
  isNavEntryActive,
  matchRange,
  NAV_GROUPS,
  searchNavEntries,
  type NavEntry,
  type NavGroupName,
} from "./kitPages";

const entryDomId = (entry: NavEntry) => `kit-nav-${entry.key.replaceAll(":", "-")}`;

/** Whether the entry shows whole inside the list's scrolling box. */
function wholeInView(element: HTMLElement): boolean {
  const box = element.closest<HTMLElement>("[data-slot='scroll-area-viewport']");
  if (box === null) return true;
  const outer = box.getBoundingClientRect();
  const inner = element.getBoundingClientRect();
  return inner.top >= outer.top && inner.bottom <= outer.bottom;
}

/** Whether a key press lands in a field the person is typing into. */
const typingIn = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** The label with the query's match drawn in the full ink and weight. */
function Highlighted({ label, query }: { readonly label: string; readonly query: string }) {
  const range = matchRange(label, query);
  if (range === null) return label;
  return (
    <>
      {label.slice(0, range[0])}
      <mark className="bg-transparent font-semibold text-sidebar-foreground">
        {label.slice(range[0], range[1])}
      </mark>
      {label.slice(range[1])}
    </>
  );
}

/**
 * The kit's navigation: a search over every page, flow and flow state (`/` or ⌘K to reach it,
 * ↑/↓ and Enter to open, Esc to clear), then its groups, each folding, with its count.
 */
export function KitNav({
  entries,
  page,
  state,
  hrefFor,
  onOpen,
}: {
  readonly entries: readonly NavEntry[];
  readonly page: string | undefined;
  readonly state: string | undefined;
  readonly hrefFor: (entry: NavEntry) => string;
  readonly onOpen: (entry: NavEntry) => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [folded, setFolded] = useState<ReadonlySet<NavGroupName>>(() => new Set());
  const field = useRef<HTMLInputElement | null>(null);
  const searching = query.trim() !== "";
  const results = useMemo(() => searchNavEntries(entries, query), [entries, query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const command = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (!command && (event.key !== "/" || typingIn(event.target))) return;
      event.preventDefault();
      field.current?.focus();
      field.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The open page's entry stands in the middle of the list: at once as the kit opens, gliding
  // there when another page opens and its entry is out of view, left alone when it shows whole.
  const placed = useRef(false);
  useLayoutEffect(() => {
    const active = entries.find((entry) => isNavEntryActive(entry, page, state));
    const element = active === undefined ? null : document.getElementById(entryDomId(active));
    if (element === null) return;
    const first = !placed.current;
    placed.current = true;
    if (!first && wholeInView(element)) return;
    const still = first || prefersReducedMotion();
    element.scrollIntoView({ block: "center", behavior: still ? "instant" : "smooth" });
  }, [entries, page, state]);

  const cursorEntry = searching ? results[Math.min(cursor, results.length - 1)] : undefined;
  useEffect(() => {
    if (cursorEntry === undefined) return;
    document.getElementById(entryDomId(cursorEntry))?.scrollIntoView({ block: "nearest" });
  }, [cursorEntry]);

  const open = (entry: NavEntry) => {
    onOpen(entry);
  };

  const renderEntry = (entry: NavEntry) => {
    const active = searching ? entry === cursorEntry : isNavEntryActive(entry, page, state);
    const current = isNavEntryActive(entry, page, state);
    return (
      <SidebarMenuItem id={entryDomId(entry)} key={entry.key}>
        <SidebarMenuButton
          isActive={active}
          render={
            <a
              aria-current={current ? "page" : undefined}
              href={hrefFor(entry)}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                open(entry);
              }}
            />
          }
          size="sm"
        >
          <span>
            <Highlighted label={entry.label} query={query} />
            {searching && entry.context !== undefined ? (
              <span className="text-sidebar-muted-foreground">
                {" · "}
                <Highlighted label={entry.context} query={query} />
              </span>
            ) : null}
          </span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  /** A group's entries in runs under their kind or area; a flow's states indented under it. */
  const renderRuns = (shown: readonly NavEntry[]) => {
    const runs: Array<{ sub: string | undefined; entries: NavEntry[] }> = [];
    for (const entry of shown) {
      const last = runs.at(-1);
      if (last !== undefined && last.sub === entry.sub) last.entries.push(entry);
      else runs.push({ sub: entry.sub, entries: [entry] });
    }
    return runs.map((run, index) => (
      <div className="flex flex-col gap-0.5 pb-2" key={run.sub ?? `run-${index}`}>
        {run.sub === undefined ? null : (
          <h3 className="m-0 px-2 pt-1 pb-0.5 font-medium text-caption text-sidebar-muted-foreground">
            {run.sub}
          </h3>
        )}
        <SidebarMenu>
          {searching
            ? run.entries.map(renderEntry)
            : nestStates(run.entries, renderEntry, page ?? "overview")}
        </SidebarMenu>
      </div>
    ));
  };

  const groups = NAV_GROUPS.map((group) => ({
    group,
    shown: (searching ? results : entries).filter((entry) => entry.group === group),
    total: entries.filter((entry) => entry.group === group && entry.depth === 0).length,
  })).filter(({ shown }) => shown.length > 0);

  return (
    <>
      <SidebarHeader>
        <div className="px-2 pt-2 pb-1">
          <span className="font-semibold text-emphasis text-sidebar-foreground">Mate kit</span>
        </div>
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search the kit"
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setCursor(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                if (query === "") event.currentTarget.blur();
                setQuery("");
                setCursor(0);
                return;
              }
              if (!searching) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const step = event.key === "ArrowDown" ? 1 : -1;
                setCursor((current) => (current + step + results.length) % results.length);
                return;
              }
              if (event.key === "Enter" && cursorEntry !== undefined) {
                event.preventDefault();
                open(cursorEntry);
              }
            }}
            placeholder="Search the kit"
            ref={field}
            size="sm"
            type="search"
            value={query}
          />
          <InputGroupAddon align="inline-end">
            <Kbd>/</Kbd>
          </InputGroupAddon>
        </InputGroup>
        <span aria-live="polite" className="sr-only">
          {searching ? `${results.length} ${results.length === 1 ? "match" : "matches"}` : ""}
        </span>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Kit">
          {groups.length === 0 ? (
            <p className="m-0 px-4 py-3 text-body text-sidebar-muted-foreground">
              Nothing matches “{query.trim()}”.
            </p>
          ) : null}
          {groups.map(({ group, shown, total }) =>
            group === "Overview" ? (
              <SidebarGroup key={group}>
                <SidebarMenu>{shown.map(renderEntry)}</SidebarMenu>
              </SidebarGroup>
            ) : (
              <SidebarGroup key={group}>
                <NavGroup
                  count={searching ? shown.length : total}
                  name={group}
                  open={searching || !folded.has(group)}
                  onOpenChange={(next) => {
                    setFolded((current) => {
                      const updated = new Set(current);
                      if (next) updated.delete(group);
                      else updated.add(group);
                      return updated;
                    });
                  }}
                >
                  {renderRuns(shown)}
                </NavGroup>
              </SidebarGroup>
            ),
          )}
        </nav>
      </SidebarContent>
    </>
  );
}

/**
 * A flow followed by its states, indented under it as their own list while it is the open page;
 * the other flows fold theirs away, and the search still finds every state.
 */
function nestStates(
  entries: readonly NavEntry[],
  render: (entry: NavEntry) => ReactNode,
  open: string,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined) continue;
    const children: NavEntry[] = [];
    while (entries[index + 1]?.depth === 1) {
      const child = entries[index + 1];
      if (child !== undefined) children.push(child);
      index += 1;
    }
    nodes.push(
      <Fragment key={entry.key}>
        {render(entry)}
        {children.length === 0 || entry.page !== open ? null : (
          <li className="ms-3 border-sidebar-border border-s ps-1">
            <SidebarMenu>{children.map(render)}</SidebarMenu>
          </li>
        )}
      </Fragment>,
    );
  }
  return nodes;
}

function NavGroup({
  name,
  count,
  open,
  onOpenChange,
  children,
}: {
  readonly name: string;
  readonly count: number;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly children: ReactNode;
}) {
  return (
    <Collapsible onOpenChange={onOpenChange} open={open}>
      <CollapsibleTrigger render={<SidebarMenuButton size="sm" />}>
        <ChevronRightIcon
          aria-hidden="true"
          className={`transition-transform duration-150 ease-out-strong motion-reduce:transition-none ${open ? "rotate-90" : "rotate-0"}`}
        />
        <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
          <span className="truncate font-semibold text-sidebar-foreground">{name}</span>
          <span className="text-sidebar-muted-foreground tabular-nums">{count}</span>
        </span>
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="pt-1">{children}</div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
