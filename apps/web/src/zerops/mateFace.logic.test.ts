import { overlayEngineRow } from "@t3tools/client-runtime/data";
import { engineRow } from "@t3tools/client-runtime/data/fixtures";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type ConversationRow,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { lineMate } from "~/components/chat/ConversationStrip.logic";
import { mateRowReading } from "~/components/zerops/SidebarMateRow.logic";

import { restingActivity, threadAgentActivity, type ZeropsAgentActivity } from "./agentActivity";
import { runClockSince } from "./mateActivity";
import { mateFace, type MateFaceFacts } from "./mateFace.logic";

const FEN = EnvironmentId.make("env-fen");
const MAIN = ThreadId.make("main");

const main: EnvironmentThreadShell = {
  id: MAIN,
  environmentId: FEN,
  projectId: ProjectId.make("project-fen"),
  title: "Build the game server",
  modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "opus" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-10-10T08:00:00.000Z",
  updatedAt: "2026-10-10T08:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  session: null,
  latestUserMessageAt: "2026-10-10T08:00:00.000Z",
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
};

/** What the data layer reads of the Mate (`mateActivityAtom`): one record, both places. */
const reading = (overrides: Partial<ZeropsAgentActivity> = {}): ZeropsAgentActivity => ({
  threadId: MAIN,
  kind: "idle",
  status: null,
  face: "idle",
  subject: "Build the game server",
  at: "2026-10-10T08:00:00.000Z",
  snippet: "The rules engine passes its tests.",
  unread: false,
  pausedUntil: undefined,
  threadKey: `${FEN}:${MAIN}`,
  task: "Build the game server",
  ...overrides,
});

const facts = (overrides: Partial<MateFaceFacts> = {}): MateFaceFacts => ({
  connected: true,
  activity: reading(),
  reviewWaits: false,
  mine: true,
  restarting: false,
  ...overrides,
});

/** The chat's top bar: the Mate leading its line (`lineMate`). */
function topBar(face: MateFaceFacts) {
  const mate = lineMate({
    mate: { name: "Fen", tint: "amber" },
    face,
    chats: [main],
    crewChatOpen: false,
    subject: null,
  });
  return {
    state: mate.face,
    cues: mate.cues?.map((cue) => cue.key),
    restarting: mate.restarting,
    known: mate.known,
  };
}

/** The menu: the row's one reading of its Mate (`mateRowReading`), its face's events beside it. */
function menuRow(face: MateFaceFacts) {
  const read = mateFace(face);
  return {
    state: mateRowReading({ ...face, name: "Fen" }).face,
    cues: read.cues.map((cue) => cue.key),
    restarting: read.restarting,
    known: read.known,
  };
}

describe("one Mate, one face", () => {
  it.each<{
    readonly case: string;
    readonly facts: MateFaceFacts;
    readonly state: string;
    readonly cues: ReadonlyArray<string>;
    readonly restarting?: boolean;
  }>([
    {
      case: "working",
      facts: facts({ activity: reading({ kind: "working", face: "working" }) }),
      state: "working",
      cues: [],
    },
    {
      case: "its turn over, waiting on its helpers",
      facts: facts({
        activity: reading({ kind: "working", face: "working", waitsOnHelpers: true }),
      }),
      state: "working",
      cues: [],
    },
    {
      case: "a question waiting for the person",
      facts: facts({
        activity: reading({ kind: "input", face: "needs", question: "Which port?" }),
      }),
      state: "needs",
      cues: [],
    },
    {
      // Another's Mate waits on its owner, not on the viewer.
      case: "a question waiting for its owner, on another's Mate",
      facts: facts({
        mine: false,
        activity: reading({ kind: "input", face: "needs", question: "Which port?" }),
      }),
      state: "idle",
      cues: [],
    },
    {
      case: "its change waiting for the person's review",
      facts: facts({ reviewWaits: true }),
      state: "needs",
      cues: [],
    },
    {
      case: "paused at the usage limit",
      facts: facts({
        activity: reading({
          kind: "failed",
          face: "sleep",
          usageLimited: true,
          pausedUntil: "2026-10-10T09:00:00.000Z",
        }),
      }),
      // The turn the limit stopped ended failed, and the limit is said with it.
      state: "sleep",
      cues: ["failed", "limit"],
    },
    {
      case: "restarting",
      facts: facts({ restarting: true }),
      state: "idle",
      cues: ["restart"],
      restarting: true,
    },
    {
      case: "back from a restart, reconnected",
      facts: facts({ watched: { backs: 1, moved: undefined, arrived: undefined } }),
      state: "idle",
      cues: ["back:1"],
    },
    { case: "idle", facts: facts(), state: "idle", cues: [] },
    {
      // A failure is no question: the face stands still, its double take and red line say it.
      case: "stopped on an error",
      facts: facts({ activity: reading({ kind: "failed", face: "needs", errorLine: "boom" }) }),
      state: "idle",
      cues: ["failed"],
    },
    {
      case: "asleep while its container is down",
      facts: facts({ connected: false, activity: undefined }),
      state: "sleep",
      cues: [],
    },
  ])(
    "the Mate's face in the chat's top bar and in the menu is the same face at the same moment: $case",
    ({ facts: input, state, cues, restarting = false }) => {
      const face = { state, cues, restarting, known: input.activity !== undefined };
      expect(topBar(input)).toEqual(face);
      expect(menuRow(input)).toEqual(face);
    },
  );
});

// Recorded 2026-10-10 (Milo, stress run 4B): its run over and a helper still on, Milo restarted;
// as it came back the menu row's clock opened at 0:00 over "Working on a reply", no run on. The
// restart rewrote every row, and the row's last change was read as a message just sent.
describe("one Mate, one face, from the engine's records", () => {
  const RUN_START = Date.parse("2026-10-10T08:27:44.600Z");
  const RUN_END = Date.parse("2026-10-10T08:28:15.700Z");
  const RESTARTED = Date.parse("2026-10-10T08:28:49.800Z");
  const run81 = RunId.make("r>/r/81");
  const ended = {
    id: run81,
    end: { kind: "completed" },
    endedAt: RUN_END,
    turnState: "completed",
  } as const;
  /** The menu's reading of the Mate off its row, as its socket hands it back after the restart. */
  const read = (row: Partial<ConversationRow>) => {
    const thread = overlayEngineRow(
      main,
      engineRow(FEN, MAIN, { subject: "Live stress test 4B", snippet: null, ...row }),
    );
    return threadAgentActivity({ ...thread, environmentId: FEN }, undefined, RESTARTED);
  };

  it.each<{
    readonly case: string;
    readonly row: Partial<ConversationRow>;
    readonly state: string;
    readonly face: string;
    readonly reply: string | undefined;
    /** Where its clock counts from; none while no run is on. */
    readonly since: number | undefined;
  }>([
    {
      case: "a run on: its clock from the run's start",
      row: {
        state: { kind: "working", since: RUN_START as never, waitsOnHelpers: false },
        activeRunId: run81,
        latestRun: { id: run81, end: null, endedAt: null, turnState: "running" },
        at: RESTARTED as never,
      },
      state: "working",
      face: "working",
      reply: "pending",
      since: RUN_START,
    },
    {
      case: "its run over, its helpers on after a restart: their words, no new message",
      row: {
        state: { kind: "working", since: RUN_END as never, waitsOnHelpers: true },
        runStatus: "ready",
        latestRun: ended,
        at: RESTARTED as never,
      },
      state: "working",
      face: "working",
      reply: "live",
      since: RUN_END,
    },
    {
      case: "nothing on after a restart: at rest, nothing of working",
      row: { state: { kind: "idle" }, latestRun: ended, at: RESTARTED as never },
      state: "idle",
      face: "idle",
      reply: undefined,
      since: undefined,
    },
  ])(
    "the Mate's face in the chat's top bar and in the menu is the same face at the same moment: $case",
    ({ row, state, face, reply, since }) => {
      const activity = read(row);
      const input = facts({ activity });
      const view = mateRowReading({ ...input, name: "Fen" });
      expect({
        state: view.state,
        face: view.face,
        reply: view.reply?.kind,
        since: runClockSince(restingActivity(activity), activity, RESTARTED + 1_000),
      }).toEqual({
        state,
        face,
        reply,
        since: since === undefined ? undefined : new Date(since).toISOString(),
      });
      expect(topBar(input).state).toBe(face);
    },
  );
});
