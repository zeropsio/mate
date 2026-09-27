import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { deriveCrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import { ThreadId, type CrewAttention, type CrewLaneSummary } from "@t3tools/contracts";
import type { ThreadStatusInput } from "@t3tools/shared/threadStatus";
import { describe, expect, it } from "vite-plus/test";

import { readCrewThread } from "../../../zerops/crew/useCrew";
import {
  crewAttentionActions,
  crewDeliverAsk,
  crewLaneSummary,
  crewLoginMark,
  crewPendingChip,
  crewPortsAsk,
  crewRowLead,
  crewRowState,
  crewServedLine,
  crewStateTone,
} from "./CrewSection.logic";

type Shell = ThreadStatusInput & { id: ThreadId; archivedAt: string | null };

const shell = (id: string, running: boolean): Shell => ({
  id: ThreadId.make(id),
  archivedAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  interactionMode: "default",
  latestTurn: null,
  session: running
    ? {
        threadId: ThreadId.make(id),
        status: "running",
        providerName: "Claude",
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError: null,
        updatedAt: "2026-09-27T09:00:00.000Z",
      }
    : null,
});

const snapshot = crewSnapshotFixture();
const view = deriveCrewView(
  snapshot,
  [
    shell("thread-crew-lead-1", false),
    shell("thread-crew-backend-2", true),
    shell("thread-crew-frontend-1", false),
    shell("thread-crew-erik-1", false),
  ],
  readCrewThread,
);
const row = (handle: string) => view.crewmates.find((mate) => mate.crewmate.handle === handle)!;

describe("crewRowState", () => {
  it.each([
    { handle: "backend", word: "Working", tone: "busy", pulse: true },
    {
      handle: "frontend",
      word: "Waits on your tree: src/ui/hud.ts",
      tone: "attention",
      pulse: false,
    },
    { handle: "erik", word: "Asks a question", tone: "attention", pulse: false },
    { handle: "lead", word: "Idle", tone: "off", pulse: false },
  ])("$handle reads $word", ({ handle, word, tone, pulse }) => {
    expect(crewRowState(row(handle), view.tasks)).toEqual({ word, tone, pulse });
  });
});

describe("crewRowLead", () => {
  it("is the open task while one is open, else the job line", () => {
    expect(crewRowLead(row("backend"))).toEqual({
      kind: "task",
      text: "#12 Add pagination to /api/items",
    });
    expect(crewRowLead(row("lead"))).toEqual({
      kind: "job",
      text: "Plans the work, splits it into tasks and reviews each landing.",
    });
  });
});

describe("crewLaneSummary", () => {
  const lane = (fields: Partial<CrewLaneSummary>): CrewLaneSummary => ({
    branch: "crew/backend",
    ahead: 0,
    insertions: 0,
    deletions: 0,
    check: null,
    state: "ready",
    detail: null,
    ...fields,
  });

  it.each<{
    readonly name: string;
    readonly lane: CrewLaneSummary | null;
    readonly text: string | null;
  }>([
    { name: "no copy", lane: null, text: null },
    { name: "nothing ahead", lane: lane({}), text: null },
    { name: "commits ahead", lane: lane({ ahead: 3 }), text: "3 ahead" },
    { name: "conflicts", lane: lane({ ahead: 3, state: "conflicts" }), text: "Conflicts" },
    {
      name: "being created",
      lane: lane({ state: "creating" }),
      text: "Creating its copy of the code",
    },
    {
      name: "setting up",
      lane: lane({ state: "setting-up", detail: "npm ci" }),
      text: "Running npm ci",
    },
    {
      name: "service redeploying",
      lane: lane({ state: "frozen" }),
      text: "Its service is redeploying",
    },
    { name: "gone", lane: lane({ state: "missing" }), text: "Its copy is missing" },
    {
      name: "failed with a reason",
      lane: lane({ state: "failed", detail: "No free disk" }),
      text: "Its copy failed: No free disk",
    },
  ])("$name", ({ lane: input, text }) => {
    expect(crewLaneSummary(input)).toBe(text);
  });
});

describe("crewPendingChip", () => {
  it.each([
    { name: "current", pending: null, text: null },
    { name: "a job ahead", pending: { job: 5, brief: null }, text: "v5 at next turn" },
    { name: "the brief ahead", pending: { job: null, brief: 5 }, text: "Brief v5 at next turn" },
    { name: "both ahead", pending: { job: 3, brief: 5 }, text: "v3 at next turn" },
  ])("$name", ({ pending, text }) => {
    expect(crewPendingChip(pending)).toBe(text);
  });
});

describe("crewLoginMark", () => {
  it("names a login other than the default Claude Code one", () => {
    expect(crewLoginMark(row("backend").crewmate.login)).toBeNull();
    expect(crewLoginMark(row("erik").crewmate.login)).toBe("Codex");
  });
});

describe("crewStateTone", () => {
  it.each([
    { name: "a run running", run: snapshot.run, working: 0, tone: "busy" },
    {
      name: "a run paused",
      run: { ...snapshot.run!, state: "paused" as const },
      working: 0,
      tone: "attention",
    },
    { name: "no run, someone working", run: null, working: 2, tone: "busy" },
    { name: "no run, idle", run: null, working: 0, tone: "off" },
  ])("$name", ({ run, working, tone }) => {
    expect(crewStateTone({ run, workingCount: working })).toBe(tone);
  });
});

describe("crewAttentionActions", () => {
  const attention = (
    fields: Partial<CrewAttention> & Pick<CrewAttention, "kind">,
  ): CrewAttention => ({
    id: `${fields.kind}:x`,
    handle: "backend",
    taskId: "task-12",
    text: null,
    paths: [],
    host: null,
    at: "2026-09-27T09:00:00.000Z",
    ...fields,
  });

  it.each([
    { kind: "question" as const, actions: [{ kind: "answer", label: "Answer" }] },
    {
      kind: "landing-wait" as const,
      actions: [
        {
          kind: "ask",
          label: "Commit my edit",
          ask: "Commit my edit to src/ui/hud.ts locally, without pushing: a crew landing waits on it.",
        },
      ],
    },
    {
      kind: "ready-to-land" as const,
      actions: [{ kind: "command", label: "Land", command: { _tag: "land", taskId: "task-12" } }],
    },
    { kind: "plan" as const, actions: [{ kind: "board", label: "Review plan" }] },
    {
      kind: "show-on-dev" as const,
      actions: [
        { kind: "command", label: "Allow", command: { _tag: "claimGrant", host: "appdev" } },
        { kind: "command", label: "Not now", command: { _tag: "claimDeny", host: "appdev" } },
      ],
    },
    {
      kind: "conflict" as const,
      actions: [
        {
          kind: "command",
          label: "Ask Backend to resolve",
          command: { _tag: "askResolve", taskId: "task-12" },
        },
      ],
    },
    {
      kind: "check-failed" as const,
      actions: [
        {
          kind: "command",
          label: "Ask Backend to fix",
          command: { _tag: "askFix", taskId: "task-12" },
        },
      ],
    },
    { kind: "parked" as const, actions: [] },
    { kind: "cant-start" as const, actions: [] },
  ])("$kind", ({ kind, actions }) => {
    const input = attention({ kind, paths: ["src/ui/hud.ts"], host: "appdev" });
    expect(crewAttentionActions(input, snapshot)).toEqual(actions);
  });

  it("names every path a landing waits on in the commit ask", () => {
    const input = attention({ kind: "landing-wait", paths: ["a.ts", "b.ts"] });
    expect(crewAttentionActions(input, snapshot)).toEqual([
      {
        kind: "ask",
        label: "Commit my edit",
        ask: "Commit my edits to a.ts and b.ts locally, without pushing: a crew landing waits on them.",
      },
    ]);
  });
});

describe("crewServedLine", () => {
  const host = snapshot.hosts[0]!;

  it.each([
    {
      name: "your tree",
      served: { by: "tree" as const },
      line: { text: "appdev serves: your tree", release: false },
    },
    {
      name: "a crewmate's copy",
      served: { by: "crewmate" as const, handle: "frontend" },
      line: { text: "appdev serves: Frontend's copy", release: true },
    },
    { name: "unknown", served: { by: "unknown" as const }, line: null },
  ])("$name", ({ served, line }) => {
    expect(crewServedLine({ ...host, served }, snapshot.crewmates)).toEqual(line);
  });
});

describe("the drafts for Fen", () => {
  it("delivers the landed, undelivered tasks and names the tree's own dirty paths", () => {
    expect(crewDeliverAsk(snapshot, [])).toBe(
      "Ship the crew's landed work on appdev: #11 Health endpoint for the load balancer.",
    );
    expect(crewDeliverAsk(snapshot, ["src/ui/hud.ts", "README.md"])).toBe(
      "Ship the crew's landed work on appdev: #11 Health endpoint for the load balancer. My own edits in src/ui/hud.ts and README.md ship too.",
    );
  });

  it("asks for crew ports as one range", () => {
    expect(crewPortsAsk("appdev", [3001, 3002, 3003, 3004])).toBe(
      "Add crew ports 3001–3004 (httpSupport) to appdev's dev setup in zerops.yaml, self-deploy appdev, then make sure each new port is routed on the subdomain.",
    );
    expect(crewPortsAsk("appdev", [3001])).toBe(
      "Add crew port 3001 (httpSupport) to appdev's dev setup in zerops.yaml, self-deploy appdev, then make sure the new port is routed on the subdomain.",
    );
  });
});
