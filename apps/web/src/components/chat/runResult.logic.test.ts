import { EnvironmentId, TurnId } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { describe, expect, it } from "vite-plus/test";

import type {
  OutcomeLater,
  OutcomeModel,
  OutcomePicture,
  OutcomeService,
} from "./conversation.logic";
import {
  resultPictures,
  resultRows,
  runEffortWords,
  tileRatio,
  type ResultChange,
  type ResultFacts,
  type ResultRow,
  type ResultServiceNow,
} from "./runResult.logic";

const at = (minute: number, second = 0) =>
  new Date(Date.UTC(2026, 8, 29, 20, minute, second)).toISOString();

const PICTURE = { src: "data:image/png;base64,iVBORw0KGgo=", width: 1440, height: 900 };
const TURN = TurnId.make("t1");
const CREW_HOME = EnvironmentId.make("env-nova");

/** A browser check of `url` that passed and took a picture, unless told otherwise. */
function take(key: string, url: string, overrides: Partial<ZeropsOperation> = {}): ZeropsOperation {
  return {
    key,
    kind: "browser",
    phase: "done",
    anchorAt: at(1),
    anchorActivityId: key,
    settledAt: at(1, 5),
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

/** A take that read the page and took no picture. */
function withoutPicture(check: ZeropsOperation): ZeropsOperation {
  const { screenshot: _screenshot, ...rest } = check;
  return rest;
}

function service(hostname: string, overrides: Partial<OutcomeService> = {}): OutcomeService {
  return {
    hostname,
    tone: "ok",
    word: "Deployed",
    version: null,
    url: null,
    at: at(1, 30),
    failure: null,
    ...overrides,
  };
}

const NOTHING_LATER: OutcomeLater = {
  services: [],
  changes: [],
  tasks: [],
  pages: [],
  files: [],
  answered: false,
};

function outcome(overrides: Partial<OutcomeModel> = {}): OutcomeModel {
  return {
    key: "outcome:t1",
    turnKey: "t1",
    live: [],
    landed: [],
    files: null,
    checks: null,
    pictures: [],
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

function later(overrides: Partial<OutcomeLater>): OutcomeLater {
  return { ...NOTHING_LATER, ...overrides };
}

function checks(takes: ReadonlyArray<ZeropsOperation>): OutcomeModel["checks"] {
  return { count: takes.length, views: 0, failures: 0, takes };
}

const APPDEV = "https://appdev-1f3c-3000.prg1.example.app";
const STAGE = "https://worldstage-2b7d.prg1.example.app";

const running = (versionAt = at(0)): ResultServiceNow => ({
  status: "ACTIVE",
  since: at(0),
  versionAt,
});

/** The facts from outside the run: the forge's changes, the platform's services, the crew. */
function facts(input: {
  readonly open?: ReadonlyArray<ResultChange>;
  readonly merged?: ReadonlyArray<ResultChange>;
  readonly known?: boolean;
  readonly services?: Readonly<Record<string, ResultServiceNow>>;
  readonly tasks?: Readonly<Record<number, string>>;
}): ResultFacts {
  return {
    changes: {
      groupId: "group-snap",
      open: input.open ?? [],
      merged: input.merged ?? [],
      known: input.known ?? true,
    },
    ...(input.services === undefined ? {} : { services: new Map(Object.entries(input.services)) }),
    ...(input.tasks === undefined
      ? {}
      : {
          crew: {
            environmentId: CREW_HOME,
            tasks: new Map(
              Object.entries(input.tasks).map(([number, state]) => [
                Number(number),
                { id: `task-${number}`, state },
              ]),
            ),
          },
        }),
  };
}

/** A row as the person reads it: where it stands, its words, what is under it. */
function read(row: ResultRow) {
  const { sub } = row;
  const line =
    sub === null
      ? null
      : sub.kind === "text"
        ? sub.text
        : sub.kind === "since"
          ? `since ${sub.at}`
          : `${sub.files === null ? "" : `${sub.files} files · `}+${sub.additions} −${sub.deletions}`;
  return [row.group, row.tone, row.title, row.words, row.version, line].filter(
    (part) => part !== null,
  );
}

// Nova's /status run from the plan: it added the page, pushed it as #2,
// left the dev server running and checked /status in the browser.
const STATUS_PAGE: ResultChange = { repository: "app", number: 2, title: "Add a /status page" };
const NOVA = outcome({
  live: [service("appdev", { word: "Dev server running" })],
  checks: checks([take("op:b1", `${APPDEV}/status`)]),
  files: { count: 3, additions: 45, deletions: 3, turnId: TURN },
  change: { repository: "app", number: 2 },
  activity: [
    { kind: "edit", count: 3 },
    { kind: "command", count: 2 },
    { kind: "read", count: 1 },
  ],
});

// Fen's 1 h 31 m run: nine pills in the owner's screenshot.
const FEN = outcome({
  live: [
    service("worlddev", { word: "Dev server running" }),
    service("worldstage", { version: "9e2c4b1", url: STAGE }),
  ],
  checks: checks([
    take("op:b1", `${STAGE}/`),
    take("op:b2", `${STAGE}/`, { deviceName: "iPhone 16" }),
    take("op:b3", `${STAGE}/world`),
    take("op:b4", `${STAGE}/world`, { deviceName: "iPhone 16" }),
    take("op:b5", `${STAGE}/world`, { deviceName: "iPad Pro" }),
  ]),
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
const WORLD_CORE: ResultChange = {
  repository: "world",
  number: 4,
  title: "Move the world state into its own service",
};

// Juno's 2 h 8 m run: its first deploy failed and it came back; the
// change it made landed while it worked.
const JUNO = outcome({
  live: [
    service("storedev", { word: "Dev server running" }),
    service("storestage", { word: "Healthy", version: "5a8d3f0" }),
  ],
  landed: [
    {
      key: "landed:54",
      repository: "storedev",
      number: 54,
      line: "storedev #54",
      title: "Speed up the product pages",
    },
  ],
  activity: [
    { kind: "edit", count: 2 },
    { kind: "command", count: 66 },
    { kind: "read", count: 5 },
  ],
});

const BROKEN_BUILD = service("appstage", {
  tone: "failed",
  word: "Build failing",
  at: at(3),
  failure: {
    reason: "3 type errors in session.ts",
    at: at(3),
    logLines: ["src/session.ts(4,7): error TS2322", "Found 3 errors."],
  },
});

describe("resultRows — one result over time (the plan's four moments)", () => {
  it.each([
    {
      moment: "just finished: the change waits for review, the app runs",
      outcome: NOVA,
      facts: facts({ open: [STATUS_PAGE], services: { appdev: running() } }),
      rows: [
        ["waiting", "muted", "#2 Add a /status page", "3 files · +45 −3"],
        ["running", "ok", "appdev", "Dev server running", "/status checked ✓"],
      ],
      effort: "2 commands · 1 file read",
    },
    {
      moment: "after you merge #2: the change leaves, the line keeps the fact",
      outcome: NOVA,
      facts: facts({ merged: [STATUS_PAGE], services: { appdev: running() } }),
      rows: [["running", "ok", "appdev", "Dev server running", "/status checked ✓"]],
      effort: "merged as #2 · 2 commands · 1 file read",
    },
    {
      moment: "after a later run redeploys appdev: the row is that run's now",
      outcome: { ...NOVA, later: later({ services: ["appdev"], answered: true }) },
      facts: facts({ merged: [STATUS_PAGE], services: { appdev: running() } }),
      rows: [],
      effort: "merged as #2 · 2 commands · 1 file read",
    },
    {
      moment: "if appdev stops tonight: it comes back in red, with its fix",
      outcome: NOVA,
      facts: facts({
        merged: [STATUS_PAGE],
        services: { appdev: { status: "STOPPED", since: at(50), versionAt: at(0) } },
      }),
      rows: [["broken", "failed", "appdev", "Stopped", `since ${at(50)}`]],
      effort: "merged as #2 · 2 commands · 1 file read",
    },
  ])("$moment", ({ outcome: model, facts: now, rows, effort }) => {
    expect(resultRows(model, now).map(read)).toEqual(rows);
    expect(runEffortWords(model, now)).toBe(effort);
  });
});

describe("resultRows", () => {
  // What the run left that is still open or running, most important first:
  // anything still broken, then what waits for the person, then what runs —
  // and nothing it came back from on the way (the owner, 2026-09-29).
  it.each([
    {
      name: "Fen's run: nine pills become the change and the two services it runs",
      outcome: FEN,
      facts: facts({ open: [WORLD_CORE] }),
      rows: [
        [
          "waiting",
          "muted",
          "#4 Move the world state into its own service",
          "59 files · +2400 −529",
        ],
        ["running", "ok", "worlddev", "Dev server running"],
        [
          "running",
          "ok",
          "worldstage",
          "Deployed",
          "9e2c4b1",
          "2 pages checked, all 5 checks passed",
        ],
      ],
    },
    {
      name: "Juno's run: the failure it recovered from was never a row, the change landed",
      outcome: JUNO,
      facts: facts({ services: { storedev: running(), storestage: running() } }),
      rows: [
        ["running", "ok", "storedev", "Dev server running"],
        ["running", "ok", "storestage", "Healthy", "5a8d3f0"],
      ],
    },
    {
      name: "a build still failing comes first",
      outcome: outcome({
        live: [service("appdev", { word: "Dev server running" }), BROKEN_BUILD],
        change: { repository: "app", number: 2 },
      }),
      facts: facts({ open: [STATUS_PAGE] }),
      rows: [
        ["broken", "failed", "appstage", "Build failing", "3 type errors in session.ts"],
        ["waiting", "muted", "#2 Add a /status page"],
        ["running", "ok", "appdev", "Dev server running"],
      ],
    },
    {
      name: "a build someone deployed past since is fixed: no row",
      outcome: outcome({ live: [BROKEN_BUILD] }),
      facts: facts({ services: { appstage: running(at(20)) } }),
      rows: [],
    },
    {
      name: "a service someone else redeployed since runs because of them",
      outcome: outcome({ live: [service("appdev")] }),
      facts: facts({ services: { appdev: running(at(20)) } }),
      rows: [],
    },
    {
      name: "a service removed since leaves, with the pages checked on it",
      outcome: outcome({
        live: [service("appdev", { word: "Dev server running" })],
        checks: checks([take("op:b1", `${APPDEV}/status`)]),
      }),
      facts: facts({ services: { zcp: running() } }),
      rows: [],
    },
    {
      name: "a service the platform says failed is broken",
      outcome: outcome({ live: [service("appdev")] }),
      facts: facts({
        services: { appdev: { status: "ACTION_FAILED", since: at(40), versionAt: at(0) } },
      }),
      rows: [["broken", "failed", "appdev", "Action failed", `since ${at(40)}`]],
    },
    // The platform's word follows only what the run left running: the first
    // deploy of a new service failed, and Zerops leaves it ready to deploy —
    // that is the same failure, and the run's own words say why.
    {
      name: "a first deploy that failed stays the run's failure, whatever the platform says since",
      outcome: outcome({ live: [BROKEN_BUILD] }),
      facts: facts({
        services: { appstage: { status: "READY_TO_DEPLOY", since: at(5), versionAt: null } },
      }),
      rows: [["broken", "failed", "appstage", "Build failing", "3 type errors in session.ts"]],
    },
    {
      name: "a dev server the run left not running keeps its words whatever the platform says",
      outcome: outcome({
        live: [service("appdev", { tone: "attention", word: "Dev server not running" })],
      }),
      facts: facts({
        services: { appdev: { status: "STOPPED", since: at(40), versionAt: at(0) } },
      }),
      rows: [["waiting", "attention", "appdev", "Dev server not running"]],
    },
    {
      name: "a page whose check stayed failed is broken; one retried until it passed is not",
      outcome: outcome({
        live: [service("appdev", { word: "Dev server running" })],
        checks: checks([
          take("op:b1", `${APPDEV}/`, { phase: "failed", deviceName: "iPhone 13" }),
          take("op:b2", `${APPDEV}/`, { deviceName: "iPhone 16" }),
          take("op:b3", `${APPDEV}/admin`, {
            browserSummary: {
              stepCount: 2,
              errorCount: 0,
              failedRequestCount: 0,
              line: "",
              failedStep: { id: "s2", label: "click Login", state: "failed", stateLabel: "Failed" },
            },
          }),
        ]),
      }),
      facts: {},
      rows: [
        ["broken", "failed", "appdev", "Check of /admin failed", "couldn't click Login"],
        ["running", "ok", "appdev", "Dev server running", "/ checked ✓"],
      ],
    },
    {
      name: "a failed page a later run checked again is that run's",
      outcome: outcome({
        checks: checks([take("op:b1", `${APPDEV}/admin`, { phase: "failed" })]),
        later: later({ pages: ["appdev-1f3c-3000.prg1.example.app/admin"] }),
      }),
      facts: {},
      rows: [],
    },
    {
      name: "a change a later run pushed to again is that run's",
      outcome: { ...NOVA, later: later({ changes: ["app#2"] }) },
      facts: facts({ open: [STATUS_PAGE] }),
      rows: [["running", "ok", "appdev", "Dev server running", "/status checked ✓"]],
    },
    {
      name: "a change closed without merging leaves no row",
      outcome: NOVA,
      facts: facts({}),
      rows: [["running", "ok", "appdev", "Dev server running", "/status checked ✓"]],
    },
    {
      name: "a change the forge has not answered for: as the menu remembers it",
      outcome: NOVA,
      facts: facts({ open: [STATUS_PAGE], known: false }),
      rows: [
        ["waiting", "muted", "#2 Add a /status page", "3 files · +45 −3"],
        ["running", "ok", "appdev", "Dev server running", "/status checked ✓"],
      ],
    },
    {
      name: "a change nothing knows yet: no row, rather than a guess",
      outcome: NOVA,
      facts: {},
      rows: [["running", "ok", "appdev", "Dev server running", "/status checked ✓"]],
    },
    {
      name: "a crew task ready to land waits for the person",
      outcome: outcome({ crewTask: { number: 12, title: "Camera rig" } }),
      facts: facts({ tasks: { 12: "ready" } }),
      rows: [["waiting", "muted", "#12 Camera rig", "Ready to land"]],
    },
    {
      name: "a crew task that landed, or is still at work, leaves no row",
      outcome: outcome({ crewTask: { number: 12, title: "Camera rig" } }),
      facts: facts({ tasks: { 12: "landed" } }),
      rows: [],
    },
    {
      name: "what did not go through, and the steps of its plan it left, wait for the person",
      outcome: outcome({
        notDone: [
          {
            key: "op:i1",
            subject: "gitea",
            word: "Import failed",
            reason: "Gitea isn't connected yet",
            at: at(2),
          },
        ],
        planLeft: ["Write the tests"],
      }),
      facts: {},
      rows: [
        ["waiting", "attention", "gitea", "Import failed", "Gitea isn't connected yet"],
        ["waiting", "attention", "Write the tests", "Not done"],
      ],
    },
    {
      name: "once the person writes again, what waited on them is answered",
      outcome: outcome({
        notDone: [
          { key: "op:i1", subject: "gitea", word: "Import failed", reason: null, at: at(2) },
        ],
        planLeft: ["Write the tests"],
        later: later({ answered: true }),
      }),
      facts: {},
      rows: [],
    },
    {
      name: "a service it created runs because of it, once",
      outcome: outcome({ live: [service("appdev")], created: ["db, appdev"] }),
      facts: {},
      rows: [
        ["running", "ok", "appdev", "Deployed"],
        ["running", "ok", "db", "Created"],
      ],
    },
    {
      name: "a service it created that a later run removed is that run's",
      outcome: outcome({ created: ["db"], later: later({ services: ["db"] }) }),
      facts: {},
      rows: [],
    },
    {
      name: "pages no service of the run serves stand by their host",
      outcome: outcome({
        checks: checks([
          take("op:b1", "https://docs.example.org/guide"),
          take("op:b2", "https://docs.example.org/api"),
        ]),
      }),
      facts: {},
      rows: [["running", "ok", "docs.example.org", "2 pages checked, both checks passed"]],
    },
    // A check the Mate made on the page already open names no address: its
    // row said "the page", and under it "the page checked ✓" (the owner,
    // 2026-09-29). Passed, it says nothing a row can hold — its picture, if
    // it took one, is the strip's; failed, it stays broken, by what it can
    // name.
    {
      name: "a passed check with no address is no row",
      outcome: outcome({ checks: checks([take("op:b1", "the page")]) }),
      facts: {},
      rows: [],
    },
    {
      name: "a passed check with no address says nothing under a service",
      outcome: outcome({
        live: [service("appdev", { word: "Dev server running" })],
        checks: checks([take("op:b1", "the page")]),
      }),
      facts: {},
      rows: [["running", "ok", "appdev", "Dev server running"]],
    },
    {
      name: "a failed check with no address stays broken, by what it can name",
      outcome: outcome({
        checks: checks([
          take("op:b1", "the page", {
            deviceName: "iPhone 16",
            browserSummary: {
              stepCount: 2,
              errorCount: 0,
              failedRequestCount: 0,
              line: "",
              failedStep: { id: "s2", label: "click Save", state: "failed", stateLabel: "Failed" },
            },
          }),
        ]),
      }),
      facts: {},
      rows: [["broken", "failed", "Browser check", "Failed on iPhone 16", "couldn't click Save"]],
    },
    {
      name: "a check that failed with no word of why says it once",
      outcome: outcome({
        live: [service("appdev", { word: "Dev server running" })],
        checks: checks([withoutPicture(take("op:b1", `${APPDEV}/admin`, { phase: "failed" }))]),
      }),
      facts: {},
      rows: [
        ["broken", "failed", "appdev", "Check of /admin failed"],
        ["running", "ok", "appdev", "Dev server running"],
      ],
    },
    {
      name: "a dev server that is not running waits for the person",
      outcome: outcome({
        live: [service("appdev", { tone: "attention", word: "Dev server not running" })],
      }),
      facts: {},
      rows: [["waiting", "attention", "appdev", "Dev server not running"]],
    },
    {
      name: "a run that only ran commands leaves no rows",
      outcome: outcome({ activity: [{ kind: "command", count: 2 }] }),
      facts: {},
      rows: [],
    },
  ])("$name", ({ outcome: model, facts: now, rows }) => {
    expect(resultRows(model, now).map(read)).toEqual(rows);
  });

  // A page's link is where the row opens when its service's own address is
  // unknown.
  it("opens the app where it was checked", () => {
    const [row] = resultRows(
      outcome({
        live: [service("appdev", { word: "Dev server running" })],
        checks: checks([take("op:b1", `${APPDEV}/status`), take("op:b2", `${APPDEV}/health`)]),
      }),
    );
    expect(row?.url).toBe(`${APPDEV}/status`);
  });

  it("opens a service at its own address when the run knew it", () => {
    const [row] = resultRows(
      outcome({
        live: [service("worldstage", { url: STAGE })],
        checks: checks([take("op:b1", `${STAGE}/world`)]),
      }),
    );
    expect(row?.url).toBe(STAGE);
  });

  // A broken row leads with its fix: what it would open is down or stale.
  it.each([
    { name: "a build still failing", outcome: outcome({ live: [BROKEN_BUILD] }), facts: {} },
    {
      name: "a service stopped since",
      outcome: outcome({ live: [service("appdev", { url: APPDEV })] }),
      facts: facts({
        services: { appdev: { status: "STOPPED", since: at(50), versionAt: at(0) } },
      }),
    },
  ])("opens nothing from $name", ({ outcome: model, facts: now }) => {
    const [row] = resultRows(model, now);
    expect(row?.group).toBe("broken");
    expect(row?.url).toBeNull();
  });

  // One door (R1): the change and the crew task open the review; the files
  // the run changed open its own diff.
  it("reviews the change, and opens the run's diff from its files", () => {
    const [change] = resultRows(NOVA, facts({ open: [STATUS_PAGE] }));
    expect(change?.action).toEqual({
      kind: "review",
      target: { kind: "change", groupId: "group-snap", repository: "app", number: 2 },
    });
    expect(change?.sub).toEqual({
      kind: "diff",
      files: 3,
      additions: 45,
      deletions: 3,
      turnId: TURN,
    });
  });

  it("reviews a crew task ready to land where its crew lands it", () => {
    const [task] = resultRows(
      outcome({ crewTask: { number: 12, title: "Camera rig" } }),
      facts({ tasks: { 12: "ready" } }),
    );
    expect(task?.action).toEqual({
      kind: "review",
      target: { kind: "crew-task", environmentId: CREW_HOME, taskId: "task-12" },
    });
  });

  // S6: every problem offers its fix, written for the Mate — what failed,
  // when, the error, the log's last lines, and what to do about it.
  it.each([
    {
      name: "a build still failing",
      outcome: outcome({ live: [BROKEN_BUILD] }),
      facts: {},
      problem: {
        what: "The build of appstage is failing",
        at: at(3),
        error: "3 type errors in session.ts",
        logLines: ["src/session.ts(4,7): error TS2322", "Found 3 errors."],
        logName: "Build log · appstage",
        ask: "Find out why, fix it, and deploy it again.",
      },
    },
    {
      name: "a service that stopped since",
      outcome: outcome({ live: [service("appdev", { word: "Dev server running" })] }),
      facts: facts({
        services: { appdev: { status: "STOPPED", since: at(50), versionAt: at(0) } },
      }),
      problem: {
        what: "appdev stopped",
        at: at(50),
        ask: "Find out why it stopped, fix it, and start it again.",
      },
    },
    {
      name: "a first deploy that failed, the service left ready to deploy",
      outcome: outcome({ live: [BROKEN_BUILD] }),
      facts: facts({
        services: { appstage: { status: "READY_TO_DEPLOY", since: at(5), versionAt: null } },
      }),
      problem: {
        what: "The build of appstage is failing",
        at: at(3),
        error: "3 type errors in session.ts",
        logLines: ["src/session.ts(4,7): error TS2322", "Found 3 errors."],
        logName: "Build log · appstage",
        ask: "Find out why, fix it, and deploy it again.",
      },
    },
    {
      name: "a service the run left running that has nothing deployed on it since",
      outcome: outcome({ live: [service("appdev")] }),
      facts: facts({
        services: { appdev: { status: "READY_TO_DEPLOY", since: at(40), versionAt: null } },
      }),
      problem: {
        what: "appdev has nothing deployed",
        at: at(40),
        ask: "Find out why, fix it, and deploy it again.",
      },
    },
    {
      name: "a service the run left running that the platform says failed since",
      outcome: outcome({ live: [service("appdev")] }),
      facts: facts({
        services: { appdev: { status: "ACTION_FAILED", since: at(40), versionAt: at(0) } },
      }),
      problem: {
        what: "appdev: action failed",
        at: at(40),
        ask: "Find out why it failed, fix it, and get it running again.",
      },
    },
    {
      name: "a page whose check stayed failed",
      outcome: outcome({
        checks: checks([
          take("op:b1", `${APPDEV}/admin`, {
            phase: "failed",
            closing: "The page never loaded.",
            settledAt: at(4),
          }),
        ]),
      }),
      facts: {},
      problem: {
        what: "The check of /admin on appdev-1f3c-3000.prg1.example.app failed",
        at: at(4),
        error: "The page never loaded",
        ask: "Find out why, fix it, and check the page again.",
      },
    },
    {
      name: "a check with no address that stayed failed",
      outcome: outcome({
        checks: checks([
          take("op:b1", "the page", {
            phase: "failed",
            closing: "The page never loaded.",
            settledAt: at(4),
          }),
        ]),
      }),
      facts: {},
      problem: {
        what: "A check in the browser failed",
        at: at(4),
        error: "The page never loaded",
        ask: "Find out why, fix it, and check the page again.",
      },
    },
    {
      name: "something that did not go through",
      outcome: outcome({
        notDone: [
          {
            key: "op:i1",
            subject: "gitea",
            word: "Import failed",
            reason: "Gitea isn't connected yet",
            at: at(2),
          },
        ],
      }),
      facts: {},
      problem: {
        what: "Import failed: gitea",
        at: at(2),
        error: "Gitea isn't connected yet",
        ask: "Find out why it didn't go through, fix it, and try again.",
      },
    },
  ])("offers the fix for $name", ({ outcome: model, facts: now, problem }) => {
    const [row] = resultRows(model, now);
    expect(row?.action).toEqual({ kind: "fix", problem });
  });
});

describe("resultPictures", () => {
  const checkPicture = (
    key: string,
    caption: string,
    overrides: Partial<Extract<OutcomePicture, { kind: "check" }>> = {},
  ): OutcomePicture => ({
    kind: "check",
    key,
    src: `data:image/png;base64,${key}`,
    caption,
    page: `appdev-1f3c-3000.prg1.example.app${caption}`,
    device: null,
    failed: false,
    ratio: 1.6,
    ...overrides,
  });
  const filePicture = (path: string): OutcomePicture => ({
    kind: "file",
    key: `file:${path}`,
    path,
    name: path.split("/").at(-1)!,
  });

  // Every picture the run took or looked at, in the order it was taken, each
  // named by what it is — the words its tooltip and the viewer say.
  it.each([
    {
      name: "the run's pictures, in the order taken, each named by what it is",
      outcome: outcome({
        pictures: [
          checkPicture("op:b1", "/status"),
          filePicture("/var/www/shots/home-mobile.png"),
          checkPicture("op:b2", "/", { device: "iPhone 16" }),
        ],
      }),
      labels: ["/status in the browser", "home-mobile.png", "/ on iPhone 16"],
    },
    {
      name: "a check that stayed failed says so",
      outcome: outcome({ pictures: [checkPicture("op:b1", "/admin", { failed: true })] }),
      labels: ["/admin in the browser, failed"],
    },
    {
      name: "a check with no address names the page as its check did",
      outcome: outcome({
        pictures: [checkPicture("op:b1", "the page", { page: "the page" })],
      }),
      labels: ["the page in the browser"],
    },
    {
      name: "a page a later run checked again is that run's picture now",
      outcome: outcome({
        pictures: [checkPicture("op:b1", "/status"), filePicture("/var/www/shots/home.png")],
        later: later({ pages: ["appdev-1f3c-3000.prg1.example.app/status"] }),
      }),
      labels: ["home.png"],
    },
    {
      name: "a file a later run looked at again is that run's picture now",
      outcome: outcome({
        pictures: [checkPicture("op:b1", "/status"), filePicture("/var/www/shots/home.png")],
        later: later({ files: ["/var/www/shots/home.png"] }),
      }),
      labels: ["/status in the browser"],
    },
    { name: "a run that took no picture has none", outcome: NOVA, labels: [] },
  ])("$name", ({ outcome: model, labels }) => {
    expect(resultPictures(model).map((picture) => picture.label)).toEqual(labels);
  });
});

describe("tileRatio", () => {
  // Each tile takes its picture's own shape at the strip's one height (the
  // owner, 2026-09-29: "why these has different ration than the result?"):
  // a phone's screenshot stands whole and narrow, a desktop's whole and
  // wide. Past what a tile can hold, a full-page capture or a panorama shows
  // its top; a file not read yet takes a desktop's room.
  it.each([
    { name: "a desktop's picture: its own shape", ratio: 1440 / 900, tile: 1.6 },
    { name: "a phone's screenshot: its own shape", ratio: 1179 / 2556, tile: 1179 / 2556 },
    { name: "a phone on its side: its own shape", ratio: 844 / 390, tile: 844 / 390 },
    { name: "a full-page capture: clamped, its top shown", ratio: 1440 / 5200, tile: 0.45 },
    { name: "a panorama: clamped", ratio: 3600 / 900, tile: 2.4 },
    { name: "a shape not known yet: a desktop's room", ratio: null, tile: 1.6 },
    { name: "no shape at all: a desktop's room", ratio: 0, tile: 1.6 },
    { name: "a shape that is no number: a desktop's room", ratio: Number.NaN, tile: 1.6 },
  ])("$name", ({ ratio, tile }) => {
    expect(tileRatio(ratio)).toBeCloseTo(tile, 6);
  });
});

describe("runEffortWords", () => {
  const landed = (number: number) => ({
    key: `landed:${number}`,
    repository: "appdev",
    number,
    line: `appdev #${number}`,
    title: "Add a /status page",
  });

  // One quiet line after the run's time, counting only what the result
  // doesn't show as rows (K6): edits are the change's, checks and deploys
  // are rows, a change merged since is said once, first.
  it.each([
    {
      name: "Nova's run: its edits are its change's",
      outcome: NOVA,
      words: "2 commands · 1 file read",
    },
    {
      name: "Fen's 1 h 31 m run",
      outcome: FEN,
      words: "102 commands · 5 files read · 5 web searches · the workflow checked",
    },
    {
      name: "Juno's 2 h 8 m run: its change landed while it worked",
      outcome: JUNO,
      words: "merged as #54 · 66 commands · 5 files read",
    },
    {
      name: "edits no change holds are counted",
      outcome: outcome({
        files: { count: 2, additions: 3, deletions: 1, turnId: TURN },
        activity: [
          { kind: "edit", count: 2 },
          { kind: "command", count: 1 },
        ],
      }),
      words: "2 files edited · 1 command",
    },
    {
      name: "a change another run landed while this one worked is not this run's",
      outcome: outcome({
        change: { repository: "app", number: 3 },
        landed: [landed(2)],
        activity: [{ kind: "command", count: 1 }],
      }),
      words: "1 command",
    },
    {
      name: "one of each",
      outcome: outcome({
        activity: [
          { kind: "edit", count: 1 },
          { kind: "command", count: 1 },
          { kind: "read", count: 1 },
          { kind: "code-search", count: 1 },
          { kind: "search", count: 1 },
          { kind: "guides", count: 1 },
          { kind: "tool", count: 1 },
          { kind: "helpers", count: 1 },
        ],
      }),
      words:
        "1 file edited · 1 command · 1 file read · 1 code search · 1 web search · the Zerops guides read · 1 tool used · 1 helper",
    },
    {
      name: "several of each",
      outcome: outcome({
        activity: [
          { kind: "code-search", count: 4 },
          { kind: "tool", count: 2 },
          { kind: "helpers", count: 11 },
        ],
      }),
      words: "4 code searches · 2 tools used · 11 helpers",
    },
    {
      name: "two changes landed",
      outcome: outcome({ landed: [landed(2), landed(3)] }),
      words: "merged as #2 and #3",
    },
    {
      name: "three changes landed",
      outcome: outcome({ landed: [landed(2), landed(3), landed(5)] }),
      words: "merged as #2, #3 and #5",
    },
    {
      name: "nothing left to count",
      outcome: outcome({ change: { repository: "app", number: 2 } }),
      words: null,
    },
  ])("$name", ({ outcome: model, words }) => {
    expect(runEffortWords(model)).toBe(words);
  });

  // A merge the forge reports after the run is said as the line's first
  // fact, unless a later run pushed to that change again: it is that run's.
  it.each([
    {
      name: "merged since",
      later: NOTHING_LATER,
      words: "merged as #2 · 2 commands · 1 file read",
    },
    {
      name: "pushed to again by a later run, then merged",
      later: later({ changes: ["app#2"] }),
      words: "2 commands · 1 file read",
    },
  ])("follows the forge: $name", ({ later: after, words }) => {
    expect(runEffortWords({ ...NOVA, later: after }, facts({ merged: [STATUS_PAGE] }))).toBe(words);
  });

  it("says nothing for a run with no outcome", () => {
    expect(runEffortWords(null)).toBeNull();
    expect(runEffortWords(undefined)).toBeNull();
  });
});
