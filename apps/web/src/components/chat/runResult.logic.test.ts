import { TurnId } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { describe, expect, it } from "vite-plus/test";

import type { OutcomeModel, OutcomeService } from "./conversation.logic";
import { resultRows, type ResultRow } from "./runResult.logic";

const at = (minute: number, second = 0) =>
  new Date(Date.UTC(2026, 8, 29, 20, minute, second)).toISOString();

const PICTURE = { src: "data:image/png;base64,iVBORw0KGgo=", width: 1440, height: 900 };

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
    failure: null,
    ...overrides,
  };
}

function outcome(overrides: Partial<OutcomeModel> = {}): OutcomeModel {
  return {
    key: "outcome:t1",
    turnKey: "t1",
    live: [],
    landed: [],
    files: null,
    checks: null,
    created: [],
    notDone: [],
    activity: [],
    ...overrides,
  };
}

function checks(takes: ReadonlyArray<ZeropsOperation>): OutcomeModel["checks"] {
  return { count: takes.length, views: 0, failures: 0, takes };
}

const APPDEV = "https://appdev-1f3c-3000.prg1.example.app";
const STAGE = "https://letopisstage-2b7d.prg1.example.app";

/** A row as the person reads it: where it stands, its words, what is under it. */
function read(row: ResultRow) {
  const sub =
    row.sub === null
      ? null
      : row.sub.kind === "text"
        ? row.sub.text
        : `${row.sub.files === null ? "" : `${row.sub.files} files · `}+${row.sub.additions} −${row.sub.deletions}`;
  return [row.group, row.tone, row.title, row.words, row.version, sub].filter(
    (part) => part !== null,
  );
}

describe("resultRows", () => {
  // What the run left that is still open or running, most important first:
  // anything still broken, then what waits for the person, then what runs —
  // and nothing it came back from on the way (the owner, 2026-09-29).
  it.each([
    {
      name: "Nova's /status run, just finished: the change, then the app it runs",
      outcome: outcome({
        live: [service("appdev", { word: "Dev server running" })],
        checks: checks([take("op:b1", `${APPDEV}/status`)]),
        files: { count: 3, additions: 45, deletions: 3, turnId: TurnId.make("t1") },
      }),
      rows: [
        ["waiting", "muted", "3 files changed", "+45 −3"],
        ["running", "ok", "appdev", "Dev server running", "/status checked ✓"],
      ],
    },
    {
      name: "Fen's 1 h 31 m run: nine pills become the change and two services",
      outcome: outcome({
        live: [
          service("letopisdev", { word: "Dev server running" }),
          service("letopisstage", { version: "f578ec0", url: STAGE }),
        ],
        checks: checks([
          take("op:b1", `${STAGE}/`),
          take("op:b2", `${STAGE}/`, { deviceName: "iPhone 16" }),
          take("op:b3", `${STAGE}/world`),
          take("op:b4", `${STAGE}/world`, { deviceName: "iPhone 16" }),
          take("op:b5", `${STAGE}/world`, { deviceName: "iPad Pro" }),
        ]),
        files: { count: 59, additions: 2400, deletions: 529, turnId: TurnId.make("t1") },
        activity: [
          { kind: "command", count: 102, words: "Ran 102 commands", entries: [] },
          { kind: "read", count: 5, words: "Read 5 files", entries: [] },
        ],
      }),
      rows: [
        ["waiting", "muted", "59 files changed", "+2400 −529"],
        ["running", "ok", "letopisdev", "Dev server running"],
        [
          "running",
          "ok",
          "letopisstage",
          "Deployed",
          "f578ec0",
          "2 pages checked, all 5 checks passed",
        ],
      ],
    },
    {
      name: "Juno's 2 h 8 m run: the failure it recovered from was never a row",
      outcome: outcome({
        live: [
          service("storedev", { word: "Dev server running" }),
          service("storestage", { word: "Healthy", version: "d47f96a" }),
        ],
        landed: [{ key: "landed:54", line: "storedev #54", title: "Performance tuning" }],
      }),
      rows: [
        ["running", "ok", "storedev", "Dev server running"],
        ["running", "ok", "storestage", "Healthy", "d47f96a"],
      ],
    },
    {
      name: "a build still failing comes first, whatever the run did before it",
      outcome: outcome({
        live: [
          service("appdev", { word: "Dev server running" }),
          service("appstage", {
            tone: "failed",
            word: "Build failing",
            failure: { reason: "3 type errors in session.ts", at: at(3), logLines: [] },
          }),
        ],
        files: { count: 1, additions: 2, deletions: 0, turnId: TurnId.make("t1") },
      }),
      rows: [
        ["broken", "failed", "appstage", "Build failing", "3 type errors in session.ts"],
        ["waiting", "muted", "1 file changed", "+2 −0"],
        ["running", "ok", "appdev", "Dev server running"],
      ],
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
      rows: [
        ["broken", "failed", "appdev", "Check of /admin failed", "couldn't click Login"],
        ["running", "ok", "appdev", "Dev server running", "/ checked ✓"],
      ],
    },
    {
      name: "what did not go through waits for the person, after the change",
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
        files: { count: 2, additions: 10, deletions: 4, turnId: TurnId.make("t1") },
      }),
      rows: [
        ["waiting", "muted", "2 files changed", "+10 −4"],
        ["waiting", "attention", "gitea", "Import failed", "Gitea isn't connected yet"],
      ],
    },
    {
      name: "a service it created runs because of it, once",
      outcome: outcome({
        live: [service("appdev")],
        created: ["db, appdev"],
      }),
      rows: [
        ["running", "ok", "appdev", "Deployed"],
        ["running", "ok", "db", "Created"],
      ],
    },
    {
      name: "pages no service of the run serves stand by their host",
      outcome: outcome({
        checks: checks([
          take("op:b1", "https://docs.example.org/guide"),
          take("op:b2", "https://docs.example.org/api"),
        ]),
      }),
      rows: [["running", "ok", "docs.example.org", "2 pages checked, both checks passed"]],
    },
    {
      name: "a dev server that is not running waits for the person",
      outcome: outcome({
        live: [service("appdev", { tone: "attention", word: "Dev server not running" })],
      }),
      rows: [["waiting", "attention", "appdev", "Dev server not running"]],
    },
    {
      name: "a run that only ran commands leaves no rows",
      outcome: outcome({
        activity: [{ kind: "command", count: 2, words: "Ran 2 commands", entries: [] }],
      }),
      rows: [],
    },
  ])("$name", ({ outcome: model, rows }) => {
    expect(resultRows(model).map(read)).toEqual(rows);
  });

  // The pictures are the checks': each page's last one, and a page's link
  // is where the row opens when its service's own address is unknown.
  it("shows each passed page's last picture and opens the app where it was checked", () => {
    const [row] = resultRows(
      outcome({
        live: [service("appdev", { word: "Dev server running" })],
        checks: checks([
          take("op:b1", `${APPDEV}/status`),
          take("op:b2", `${APPDEV}/status`, { deviceName: "iPhone 16" }),
          withoutPicture(take("op:b3", `${APPDEV}/health`)),
        ]),
      }),
    );
    expect(row?.pictures.map((picture) => picture.key)).toEqual(["op:b2"]);
    expect(row?.url).toBe(`${APPDEV}/status`);
  });

  it("opens a service at its own address when the run knew it", () => {
    const [row] = resultRows(
      outcome({
        live: [service("letopisstage", { url: STAGE })],
        checks: checks([take("op:b1", `${STAGE}/world`)]),
      }),
    );
    expect(row?.url).toBe(STAGE);
  });

  it("offers this run's diff from the files it changed", () => {
    const [row] = resultRows(
      outcome({ files: { count: 3, additions: 45, deletions: 3, turnId: TurnId.make("t1") } }),
    );
    expect(row?.action).toEqual({ kind: "diff", turnId: TurnId.make("t1") });
  });
});
