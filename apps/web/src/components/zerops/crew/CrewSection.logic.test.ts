import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { deriveCrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import { ThreadId, type CrewAttention } from "@t3tools/contracts";
import type { ThreadStatusInput } from "@t3tools/shared/threadStatus";
import { describe, expect, it } from "vite-plus/test";

import { readCrewThread } from "../../../zerops/crew/useCrew";
import {
  crewAttentionActions,
  crewFaceStack,
  crewLoginMark,
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
    expect(crewAttentionActions(input, snapshot, { board: true })).toEqual(actions);
  });

  it("offers no press that could do nothing", () => {
    expect(crewAttentionActions(attention({ kind: "plan" }), snapshot, { board: false })).toEqual(
      [],
    );
    expect(
      crewAttentionActions(attention({ kind: "question", handle: null }), snapshot, {
        board: true,
      }),
    ).toEqual([]);
  });

  it("names every path a landing waits on in the commit ask", () => {
    const input = attention({ kind: "landing-wait", paths: ["a.ts", "b.ts"] });
    expect(crewAttentionActions(input, snapshot, { board: true })).toEqual([
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

describe("crewFaceStack", () => {
  it("shows at most three faces, the lead first, and counts the rest", () => {
    const stack = crewFaceStack(view.crewmates);
    expect(stack.faces.map((face) => [face.handle, face.state])).toEqual([
      ["lead", "idle"],
      ["backend", "working"],
      ["frontend", "idle"],
    ]);
    expect(stack.more).toBe(1);
    expect(crewFaceStack(view.crewmates.slice(0, 2)).more).toBe(0);
  });
});
