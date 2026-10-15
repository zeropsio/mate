/**
 * The crew as mini Mates after its Mate's name (`SidebarCrewMinis`), in the left menu at 435 px:
 * crews of one, three and seven at work, one finished, one asking, at rest — and one row that
 * plays a crew's life on a loop (two at work, one finishes and cheers, one comes to ask and
 * turns out), for the motion.
 *
 * Served by the dev server at `/design-minis.html` (`?theme=dark`). Open it at 1786 × 1000.
 *
 * Fixtures only, invented names. Nothing here ships — `design-minis.html` is not `index.html`,
 * and no route imports this module.
 */
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { MateTintId } from "@t3tools/shared/brand";
import type { CrewDigest, MateThreadKind } from "@t3tools/shared/mateLink";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { SidebarCrewMinis, useCrewRows } from "~/components/zerops/crew/SidebarCrewMinis";
import type { SidebarCrewRead } from "~/components/zerops/crew/SidebarCrewMinis.logic";
import { MateFace } from "~/components/zerops/primitives";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const MENU_WIDTH = 435;
const ENVIRONMENT = EnvironmentId.make("env-harness");

const CREW: ReadonlyArray<readonly [string, MateTintId]> = [
  ["Ada", "violet"],
  ["Bo", "sky"],
  ["Cy", "coral"],
  ["Dee", "rose"],
  ["Eve", "olive"],
  ["Fay", "amber"],
  ["Gus", "sand"],
];

/** A crew of `size`, Ada leading, each crewmate's chat in the kind `kinds` gives, idle else. */
function crew(size: number, kinds: Readonly<Record<string, MateThreadKind>> = {}): SidebarCrewRead {
  const digest: CrewDigest = {
    crewmates: CREW.slice(0, size).map(([name, tint], index) => ({
      handle: name.toLowerCase(),
      displayName: name,
      tint,
      lead: index === 0,
      threadId: ThreadId.make(`thread-${name.toLowerCase()}`),
      threadKind: kinds[name] ?? "idle",
      loginKey: null,
    })),
    attention: [],
    readyTasks: [],
    personLands: true,
  };
  return { status: "applied", crew: digest, logins: {}, environmentId: ENVIRONMENT };
}

interface Row {
  readonly id: string;
  readonly project: string;
  readonly mate: string;
  readonly tint: MateTintId;
  readonly line: string;
  readonly time: string;
  readonly read: SidebarCrewRead;
}

const ROWS: ReadonlyArray<Row> = [
  {
    id: "one-working",
    project: "Ledger",
    mate: "Vira",
    tint: "slate",
    line: "Moving the invoices to the new table",
    time: "2m",
    read: crew(1, { Ada: "working" }),
  },
  {
    id: "three-working",
    project: "Storefront",
    mate: "Noor",
    tint: "amber",
    line: "Splitting the checkout into steps",
    time: "4m",
    read: crew(3, { Ada: "working", Bo: "working", Cy: "working" }),
  },
  {
    id: "three-mixed",
    project: "Atlas",
    mate: "Pim",
    tint: "olive",
    line: "Bo needs you",
    time: "9m",
    read: crew(3, { Bo: "input", Cy: "working" }),
  },
  {
    id: "seven",
    project: "Harbour",
    mate: "Quill",
    tint: "rose",
    line: "Dee needs you",
    time: "1h",
    read: crew(7, { Dee: "approval", Bo: "working", Eve: "working", Fay: "working" }),
  },
  {
    id: "seven-rest",
    project: "Orchard",
    mate: "Rook",
    tint: "sky",
    line: "Shipped the search filters",
    time: "3h",
    read: crew(7),
  },
];

/** A crew's life on a loop: two at work, Cy finishes, Bo comes to ask, all at work again. */
const LIFE: ReadonlyArray<Readonly<Record<string, MateThreadKind>>> = [
  { Ada: "working", Bo: "working", Cy: "working" },
  { Ada: "working", Bo: "working" },
  { Ada: "working", Bo: "input" },
  { Ada: "working", Bo: "working", Cy: "working" },
];
const LIFE_READS = LIFE.map((kinds) => crew(3, kinds));

function MateRow({ row }: { readonly row: Row }) {
  const facts = useCrewRows([{ projectId: row.id, mine: true, read: row.read }]).get(row.id);
  return (
    <button
      className="menu-row w-full min-w-0 cursor-pointer text-left text-sidebar-foreground outline-none select-none hover:bg-sidebar-row-hover"
      data-harness-row={row.id}
      data-zerops-surface="sidebar-mate"
      type="button"
    >
      <span className="flex size-10 items-center justify-center">
        <MateFace greets size={32} state="working" tint={row.tint} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="flex h-5.5 min-w-0 items-center gap-2">
          <span className="flex min-w-0 flex-1 items-center">
            <span className="menu-name min-w-0 truncate font-medium">
              {row.project} <span className="font-normal text-muted-foreground">· {row.mate}</span>
            </span>
            {facts === undefined ? null : <SidebarCrewMinis facts={facts} />}
          </span>
          <span className="menu-time shrink-0 text-muted-foreground tabular-nums">{row.time}</span>
        </span>
        <span className="menu-line2 truncate text-muted-foreground">{row.line}</span>
      </span>
    </button>
  );
}

function LiveRow() {
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setBeat((current) => (current + 1) % LIFE.length), 3000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <MateRow
      row={{
        id: "live",
        project: "Workshop",
        mate: "Tova",
        tint: "violet",
        line: ["All three at work", "Cy finished", "Bo asks you", "Back at work"][beat] ?? "",
        time: "now",
        read: LIFE_READS[beat]!,
      }}
    />
  );
}

function Harness() {
  return (
    <div className="flex h-screen bg-background">
      <aside
        className="flex h-screen shrink-0 flex-col gap-1 border-e border-border bg-sidebar p-2 text-sidebar-foreground"
        data-sidebar="sidebar"
        style={{ width: MENU_WIDTH }}
      >
        {ROWS.map((row) => (
          <MateRow key={row.id} row={row} />
        ))}
        <LiveRow />
      </aside>
    </div>
  );
}

document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}
