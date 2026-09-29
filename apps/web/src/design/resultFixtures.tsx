/**
 * The run's result in the states pass 16's plan draws it: one result over
 * time — just finished, after the person merges its change, after a later
 * run redeploys its service, if that service stops tonight — then a long
 * run's result (nine pills once) and a run that came back from a failure
 * and whose change landed. Each stands in a stand-in of the card's tray,
 * under its worked line, with the facts from outside the run given.
 *
 * Fixtures only: names, hosts and changes are invented.
 */
import { EnvironmentId, TurnId } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import type { ReactNode } from "react";

import type {
  OutcomeLater,
  OutcomeModel,
  OutcomeService,
} from "~/components/chat/conversation.logic";
import {
  runEffortWords,
  type ResultChange,
  type ResultFacts,
  type ResultServiceNow,
} from "~/components/chat/runResult.logic";
import { TurnReport } from "~/components/chat/TurnReport";

const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

/** A page the run checked, with a picture of it: a flat page drawn on the fly. */
const PICTURE = (() => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280" viewBox="0 0 440 280"><rect width="440" height="280" fill="#f6f7f9"/><rect width="440" height="44" fill="#e8ebf0"/><rect x="28" y="84" width="220" height="18" rx="4" fill="#cfd5de"/><rect x="28" y="120" width="360" height="10" rx="3" fill="#dde2e9"/><rect x="28" y="142" width="300" height="10" rx="3" fill="#dde2e9"/><rect x="28" y="164" width="330" height="10" rx="3" fill="#dde2e9"/></svg>`;
  return { src: `data:image/svg+xml;base64,${btoa(svg)}`, width: 1440, height: 900 };
})();

function take(key: string, url: string, overrides: Partial<ZeropsOperation> = {}): ZeropsOperation {
  return {
    key,
    kind: "browser",
    phase: "done",
    anchorAt: ago(3),
    anchorActivityId: key,
    settledAt: ago(3),
    turnId: "t1",
    subject: url,
    kicker: `Browser · ${url}`,
    voice: `Checking ${url}`,
    voiceSource: "mate",
    statusWord: "Checked",
    steps: [],
    links: [],
    callIds: [key],
    hasResult: true,
    screenshot: PICTURE,
    ...overrides,
  };
}

function service(hostname: string, overrides: Partial<OutcomeService> = {}): OutcomeService {
  return {
    hostname,
    tone: "ok",
    word: "Deployed",
    version: null,
    url: null,
    at: ago(2),
    failure: null,
    ...overrides,
  };
}

const NOTHING_LATER: OutcomeLater = {
  services: [],
  changes: [],
  tasks: [],
  pages: [],
  answered: false,
};

function outcome(overrides: Partial<OutcomeModel>): OutcomeModel {
  return {
    key: "outcome:t1",
    turnKey: "t1",
    live: [],
    landed: [],
    files: null,
    checks: null,
    created: [],
    notDone: [],
    planLeft: [],
    change: null,
    crewTask: null,
    activity: [],
    later: NOTHING_LATER,
    ...overrides,
  };
}

const running: ResultServiceNow = { status: "ACTIVE", since: ago(60), versionAt: ago(60) };

function forge(
  open: ReadonlyArray<ResultChange>,
  merged: ReadonlyArray<ResultChange> = [],
): ResultFacts["changes"] {
  return { groupId: "group-snap", open, merged, known: true };
}

const APPDEV = "https://appdev-1f3c-3000.prg1.example.app";
const WORLDSTAGE = "https://worldstage-2b7d.prg1.example.app";
const TURN = TurnId.make("t1");

const STATUS_PAGE: ResultChange = { repository: "app", number: 2, title: "Add a /status page" };
const NOVA = outcome({
  live: [service("appdev", { word: "Dev server running" })],
  checks: { count: 1, views: 1, failures: 0, takes: [take("op:b1", `${APPDEV}/status`)] },
  files: { count: 3, additions: 45, deletions: 3, turnId: TURN },
  change: { repository: "app", number: 2 },
  activity: [
    { kind: "edit", count: 3 },
    { kind: "command", count: 2 },
    { kind: "read", count: 1 },
  ],
});

const WORLD_STATE: ResultChange = {
  repository: "world",
  number: 4,
  title: "Move the world state into its own service",
};
const FEN = outcome({
  live: [
    service("worlddev", { word: "Dev server running" }),
    service("worldstage", { version: "9e2c4b1", url: WORLDSTAGE }),
  ],
  checks: {
    count: 5,
    views: 2,
    failures: 0,
    takes: [
      take("op:b1", `${WORLDSTAGE}/`),
      take("op:b2", `${WORLDSTAGE}/`, { deviceName: "iPhone 16" }),
      take("op:b3", `${WORLDSTAGE}/map`),
      take("op:b4", `${WORLDSTAGE}/map`, { deviceName: "iPhone 16" }),
      take("op:b5", `${WORLDSTAGE}/map`, { deviceName: "iPad Pro" }),
    ],
  },
  files: { count: 59, additions: 2400, deletions: 529, turnId: TURN },
  change: { repository: "world", number: 4 },
  activity: [
    { kind: "edit", count: 59 },
    { kind: "command", count: 102 },
    { kind: "read", count: 5 },
    { kind: "search", count: 5 },
    { kind: "workflow", count: 3 },
  ],
});

const JUNO = outcome({
  live: [
    service("storedev", { word: "Dev server running" }),
    service("storestage", {
      word: "Healthy",
      version: "5a8d3f0",
      url: "https://storestage-7c1e.prg1.example.app",
    }),
  ],
  landed: [
    {
      key: "landed:54",
      repository: "store",
      number: 54,
      line: "store #54",
      title: "Speed up the product pages",
    },
  ],
  activity: [
    { kind: "edit", count: 2 },
    { kind: "command", count: 66 },
    { kind: "read", count: 5 },
  ],
});

const BROKEN = outcome({
  live: [
    service("appdev", { word: "Dev server running" }),
    service("appstage", {
      tone: "failed",
      word: "Build failing",
      failure: {
        reason: "3 type errors in session.ts",
        at: ago(4),
        logLines: ["src/session.ts(4,7): error TS2322", "Found 3 errors."],
      },
    }),
  ],
  crewTask: { number: 12, title: "Camera rig" },
  planLeft: ["Write the tests for the status route"],
  activity: [{ kind: "command", count: 7 }],
});

interface ResultState {
  readonly label: string;
  readonly note: string;
  readonly outcome: OutcomeModel;
  readonly facts: ResultFacts;
  readonly worked: string;
}

const STATES: ReadonlyArray<ResultState> = [
  {
    label: "Just finished",
    note: "The change waits for review; the app runs, its page checked.",
    outcome: NOVA,
    facts: { changes: forge([STATUS_PAGE]), services: new Map([["appdev", running]]) },
    worked: "Nova worked 1m 20s",
  },
  {
    label: "After you merge #2",
    note: "The change left the result once it was merged. The line keeps the fact.",
    outcome: NOVA,
    facts: { changes: forge([], [STATUS_PAGE]), services: new Map([["appdev", running]]) },
    worked: "Nova worked 1m 20s",
  },
  {
    label: "After a later run redeploys appdev",
    note: "appdev shows under that run now; this run's line is all that's left.",
    outcome: { ...NOVA, later: { ...NOTHING_LATER, services: ["appdev"], answered: true } },
    facts: { changes: forge([], [STATUS_PAGE]), services: new Map([["appdev", running]]) },
    worked: "Nova worked 1m 20s",
  },
  {
    label: "If appdev stops tonight",
    note: "Still this run's service, and broken now: back in red, with its fix.",
    outcome: NOVA,
    facts: {
      changes: forge([], [STATUS_PAGE]),
      services: new Map([["appdev", { status: "STOPPED", since: ago(95), versionAt: ago(60) }]]),
    },
    worked: "Nova worked 1m 20s",
  },
  {
    label: "Fen's 1 h 31 m run",
    note: "Nine identical pills once, the change fourth: the change first now.",
    outcome: FEN,
    facts: { changes: forge([WORLD_STATE]) },
    worked: "Fen worked 1h 31m",
  },
  {
    label: "Juno's 2 h 8 m run",
    note: "A failure it recovered from is the work's; the change that landed is the line's.",
    outcome: JUNO,
    facts: {},
    worked: "Juno worked 2h 8m",
  },
  {
    label: "Broken, a task to land, a step left",
    note: "Still broken first, then what waits for you, then what runs.",
    outcome: BROKEN,
    facts: {
      crew: {
        environmentId: EnvironmentId.make("environment-local"),
        tasks: new Map([[12, { id: "task-12", state: "ready" }]]),
      },
    },
    worked: "Nova worked 6m",
  },
];

/** A stand-in of the card's tray, the plan's numbers: its worked line and the result under it. */
function Tray({
  worked,
  effort,
  children,
}: {
  worked: string;
  effort: string | null;
  children: ReactNode;
}) {
  return (
    <div className="bg-card p-3 ring-1 ring-foreground/7" style={{ borderRadius: 30 }}>
      <div className="grid min-h-11 grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-2 pe-3.5 text-sm">
        <span />
        <span className="min-w-0 text-foreground/80">
          {worked}
          {effort === null ? null : <span className="text-muted-foreground"> · {effort}</span>}
        </span>
        <span className="text-line text-muted-foreground">Show work</span>
      </div>
      <div className="mt-2 border-foreground/8 border-t pt-1.5 empty:hidden">{children}</div>
    </div>
  );
}

export function ResultStates() {
  return (
    <>
      {STATES.map((state) => (
        <section key={state.label} className="grid gap-2" data-harness-state={state.label}>
          <div>
            <h2 className="font-medium text-foreground text-sm">{state.label}</h2>
            <p className="text-muted-foreground text-xs">{state.note}</p>
          </div>
          <Tray effort={runEffortWords(state.outcome, state.facts)} worked={state.worked}>
            <TurnReport
              facts={state.facts}
              onOpenImage={() => undefined}
              onOpenTurnDiff={() => undefined}
              outcome={state.outcome}
            />
          </Tray>
        </section>
      ))}
    </>
  );
}
