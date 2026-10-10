import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { overlayEngineShell } from "@t3tools/client-runtime/data";
import { engineRow } from "@t3tools/client-runtime/data/fixtures";
import {
  crewConversationId,
  crewEngineSnapshotFixture,
  crewSnapshotFixture,
} from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { deriveCrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type CrewSnapshot,
  type ConversationRow,
} from "@t3tools/contracts";
import { resolveThreadStatus } from "@t3tools/shared/threadStatus";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import {
  alsoWorkingLine,
  mateWorks,
  crewmateAccessibleName,
  foldCrew,
  lineChats,
  lineCrew,
  lineLeaving,
  lineMate,
  lineMotion,
  lineStage,
  MATE_SEAT,
  mateChats,
  mateWords,
  replacementChatToPin,
  type CrewRoom,
  type LineCrewmate,
  type LineMate,
  type LineStage,
} from "./ConversationStrip.logic";
import { threadAgentActivity } from "~/zerops/agentActivity";
import type { MateFaceFacts } from "~/zerops/mateFace.logic";

const FEN = EnvironmentId.make("env-fen");

function shell(
  id: string,
  overrides: Partial<EnvironmentThreadShell> = {},
): EnvironmentThreadShell {
  return {
    id: ThreadId.make(id),
    environmentId: FEN,
    projectId: ProjectId.make("project-1"),
    title: id,
    modelSelection: {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-opus-5-5",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-09-05T10:00:00.000Z",
    updatedAt: "2026-09-05T10:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: "2026-09-05T10:00:00.000Z",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

const running = {
  turnId: TurnId.make("turn-1"),
  state: "running",
  requestedAt: "2026-09-05T10:01:00.000Z",
  startedAt: "2026-09-05T10:01:00.000Z",
  completedAt: null,
  assistantMessageId: null,
} as const;

describe("mateChats", () => {
  it("puts the main chat first and the others in the order they were started", () => {
    const main = shell("main", { latestUserMessageAt: "2026-09-05T12:00:00.000Z" });
    const logs = shell("logs", {
      createdAt: "2026-09-05T11:00:00.000Z",
      latestUserMessageAt: "2026-09-05T11:30:00.000Z",
    });
    const migration = shell("migration", {
      createdAt: "2026-09-05T10:30:00.000Z",
      latestUserMessageAt: "2026-09-05T11:45:00.000Z",
    });
    const archived = shell("archived", { archivedAt: "2026-09-05T11:50:00.000Z" });

    expect(mateChats([logs, archived, migration, main]).map((chat) => chat.id)).toEqual([
      "main",
      "migration",
      "logs",
    ]);
  });
});

describe("lineMate", () => {
  const MATE = { name: "Fen", tint: "amber" } as const;
  const main = shell("main", { pinnedAt: "2026-09-05T09:00:00.000Z" });
  const logs = shell("logs", {
    pinnedAt: "2026-09-05T10:00:00.000Z",
    latestTurn: running,
  });
  /** What the data layer reads of the Mate: the chat its attention names (`mateActivityAtom`). */
  const reads = (chat: EnvironmentThreadShell | undefined, facts: Partial<MateFaceFacts> = {}) => ({
    connected: true,
    activity: chat === undefined ? undefined : threadAgentActivity(chat, undefined),
    reviewWaits: false,
    mine: true,
    restarting: false,
    ...facts,
  });
  const mate = (input: Partial<Parameters<typeof lineMate>[0]> = {}) =>
    lineMate({
      mate: MATE,
      face: reads(main),
      chats: [main, logs],
      crewChatOpen: false,
      subject: "Build the game server from the spec, tests first.",
      ...input,
    });

  it.each<{
    readonly name: string;
    readonly input: Partial<Parameters<typeof lineMate>[0]>;
    readonly open: boolean;
    readonly face: string;
    readonly tooltip: string | null;
  }>([
    {
      name: "on its own chat: on the band, its face there, the chat's subject on hover",
      input: {},
      open: true,
      face: "idle",
      tooltip: "Build the game server from the spec, tests first.",
    },
    {
      name: "arriving, on its own chat nobody has spoken into: waking, as its row",
      input: { chats: [shell("main")], face: reads(shell("main"), { pose: { arriving: true } }) },
      open: true,
      face: "waking",
      tooltip: "Build the game server from the spec, tests first.",
    },
    {
      name: "on another chat of its own: on the band, in that chat's face",
      input: { face: reads(logs), subject: "Logs" },
      open: true,
      face: "working",
      tooltip: "Logs",
    },
    {
      name: "on a chat nobody has spoken into: on the band, nothing on hover",
      input: { subject: null },
      open: true,
      face: "idle",
      tooltip: null,
    },
    {
      name: "on a chat being started: on the band at rest",
      input: { face: reads(undefined), subject: null },
      open: true,
      face: "idle",
      tooltip: null,
    },
    {
      name: "on a crewmate's chat: off the band, in its main chat's face, its own chat on hover",
      input: {
        chats: [shell("main", { latestTurn: running }), logs],
        face: reads(shell("main", { latestTurn: running })),
        crewChatOpen: true,
        subject: null,
      },
      open: false,
      face: "working",
      tooltip: "Fen's own chat",
    },
    {
      name: "asleep while its container is not connected",
      input: { face: reads(undefined, { connected: false }) },
      open: true,
      face: "sleep",
      tooltip: "Build the game server from the spec, tests first.",
    },
  ])("$name", ({ input, open, face, tooltip }) => {
    expect(mate(input)).toMatchObject({
      name: "Fen",
      tint: "amber",
      face,
      open,
      threadId: main.id,
      tooltip,
    });
  });

  it.each([
    { name: "the shape its person picked", shape: "seal" as const },
    { name: "its tint's own when nobody picked one", shape: undefined },
  ])("leads the line wearing $name", ({ shape }) => {
    expect(mate({ mate: { ...MATE, shape } }).shape).toBe(shape);
  });

  it("opens its main chat, and nothing while it has none", () => {
    expect(mate({ crewChatOpen: true }).threadId).toBe(main.id);
    expect(mate({ chats: [] }).threadId).toBeNull();
  });
});

describe("mateWords", () => {
  const MATE: LineMate = {
    name: "Fen",
    tint: "amber",
    face: "idle",
    open: true,
    threadId: ThreadId.make("main"),
    tooltip: "Build the game server from the spec, tests first.",
  };

  it.each<{
    readonly name: string;
    readonly mate: Partial<LineMate>;
    readonly crew: boolean;
    readonly cut: boolean;
    readonly words: ReturnType<typeof mateWords>;
  }>([
    {
      name: "a Mate with no crew writes its chat's subject on the line, no hover while it fits",
      mate: {},
      crew: false,
      cut: false,
      words: { subject: "Build the game server from the spec, tests first.", hover: null },
    },
    {
      name: "and the subject whole on hover once the line cuts it off",
      mate: {},
      crew: false,
      cut: true,
      words: {
        subject: "Build the game server from the spec, tests first.",
        hover: "Build the game server from the spec, tests first.",
      },
    },
    {
      name: "a chat nobody has spoken into has nothing to write, nor to hover",
      mate: { tooltip: null },
      crew: false,
      cut: false,
      words: { subject: null, hover: null },
    },
    {
      name: "with a crew the faces need the room: the subject is the name's hover",
      mate: {},
      crew: true,
      cut: false,
      words: { subject: null, hover: "Build the game server from the spec, tests first." },
    },
    {
      name: "on a crewmate's chat the Mate's hover says a press opens its own",
      mate: { open: false, tooltip: "Fen's own chat" },
      crew: true,
      cut: false,
      words: { subject: null, hover: "Fen's own chat" },
    },
  ])("$name", ({ mate, crew, cut, words }) => {
    expect(mateWords({ ...MATE, ...mate }, { crew, cut })).toEqual(words);
  });
});

describe("lineChats", () => {
  const main = shell("main", { title: "Build the game server" });
  const logs = shell("logs", { title: "Fix the flaky login test" });
  const orders = shell("orders", { title: "Rename the orders column" });

  it("has nothing to list for a Mate with one chat", () => {
    expect(lineChats([main], main.id)).toBeNull();
  });

  it.each<{
    readonly name: string;
    readonly current: string | null;
    readonly checked: ReadonlyArray<boolean>;
    readonly close: string | null;
  }>([
    {
      name: "on the main chat: it is checked, and it cannot be closed",
      current: "main",
      checked: [true, false, false],
      close: null,
    },
    {
      name: "on another chat: it is checked, and it closes",
      current: "logs",
      checked: [false, true, false],
      close: "logs",
    },
    {
      name: "on a crewmate's chat: none is checked, none closes",
      current: "thread-crew-rules-1",
      checked: [false, false, false],
      close: null,
    },
    {
      name: "on a chat being started: none is checked, none closes",
      current: null,
      checked: [false, false, false],
      close: null,
    },
  ])("lists every chat, the main one first and marked — $name", ({ current, checked, close }) => {
    const listed = lineChats(
      [main, logs, orders],
      current === null ? null : ThreadId.make(current),
    );
    expect(listed?.chats.map((chat) => [chat.title, chat.main, chat.open])).toEqual([
      ["Build the game server", true, checked[0]],
      ["Fix the flaky login test", false, checked[1]],
      ["Rename the orders column", false, checked[2]],
    ]);
    expect(listed?.close?.threadId ?? null).toBe(close);
  });

  it("holds a chat's close while its turn runs, as archiving would refuse it", () => {
    const working = shell("logs", {
      title: "Fix the flaky login test",
      session: {
        threadId: ThreadId.make("logs"),
        status: "running",
        providerName: null,
        runtimeMode: "full-access",
        activeTurnId: TurnId.make("turn-1"),
        lastError: null,
        updatedAt: "2026-09-05T10:01:00.000Z",
      },
    });
    expect(lineChats([main, working], working.id)?.close).toEqual({
      threadId: working.id,
      title: "Fix the flaky login test",
      busy: true,
    });
    expect(lineChats([main, logs], logs.id)?.close?.busy).toBe(false);
  });
});

describe("lineCrew", () => {
  const crewShell = (
    handle: string,
    stint: number,
    overrides: Partial<EnvironmentThreadShell> = {},
  ) =>
    shell(`thread-crew-${handle}-${stint}`, {
      crew: { crew: "main", crewmate: handle, stint },
      ...overrides,
    });
  const shells = [
    crewShell("lead", 1),
    crewShell("backend", 1, { archivedAt: "2026-09-27T09:10:00.000Z" }),
    crewShell("backend", 2, { latestTurn: running }),
    crewShell("frontend", 1),
    crewShell("erik", 1),
  ];
  const view = (snapshot: CrewSnapshot = crewSnapshotFixture()) =>
    deriveCrewView(snapshot, shells, (thread) => ({
      status: resolveThreadStatus(thread),
      word: null,
      working: false,
    }));
  const crew = (input: Partial<Parameters<typeof lineCrew>[0]> = {}) =>
    lineCrew({
      view: view(),
      remembered: undefined,
      crewChat: null,
      mateName: "Fen",
      connected: true,
      lastVisitedAtById: {},
      ...input,
    });
  const REMEMBERED = {
    faces: [
      { handle: "lead", displayName: "Lead", tint: "violet", lead: true },
      { handle: "backend", displayName: "Backend", tint: "sky", lead: false },
    ],
  } as const;

  it("draws a face per crewmate, the lead first, each opening the stint it talks in now", () => {
    expect(
      crew()?.map(({ handle, name, tint, threadId, lead, open, known }) => [
        handle,
        name,
        tint,
        threadId,
        lead,
        open,
        known,
      ]),
    ).toEqual([
      ["lead", "Lead", "violet", "thread-crew-lead-1", true, false, true],
      ["backend", "Backend", "sky", "thread-crew-backend-2", false, false, true],
      ["frontend", "Frontend", "coral", "thread-crew-frontend-1", false, false, true],
      ["erik", "Erik", "amber", "thread-crew-erik-1", false, false, true],
    ]);
  });

  describe("on the engine, each face from its conversation's row", () => {
    const rowOf = (handle: string, state: ConversationRow["state"]) =>
      engineRow("env-fen", crewConversationId(handle), {
        agent: {
          instanceId: "claudeAgent",
          driver: "claudeAgent",
          model: null,
          profile: { kind: "crewmate", id: handle, name: handle },
        },
        ...(state === undefined ? {} : { state }),
      });
    const engineView = () => {
      const shell = overlayEngineShell(
        {
          snapshot: Option.some({
            snapshotSequence: 1,
            projects: [{ id: "project-fen" }],
            threads: [],
            updatedAt: "2026-09-27T09:00:00.000Z",
          }),
          status: "live",
          error: Option.none(),
        } as unknown as Parameters<typeof overlayEngineShell>[0],
        [
          rowOf("lead", { kind: "idle" }),
          rowOf("backend", { kind: "working", since: 1, waitsOnHelpers: false }),
          rowOf("frontend", { kind: "idle" }),
          rowOf("erik", { kind: "idle" }),
        ],
      );
      const threads = (Option.getOrNull(shell.snapshot)?.threads ?? []).map((thread) => ({
        ...thread,
        environmentId: "env-fen" as EnvironmentThreadShell["environmentId"],
      }));
      return deriveCrewView(crewEngineSnapshotFixture(), threads, (thread) => ({
        status: resolveThreadStatus(thread),
        word: null,
        working: false,
      }));
    };

    it("draws a face per crewmate, the lead first, each opening the stint it talks in now", () => {
      expect(
        crew({ view: engineView() })?.map(({ handle, threadId }) => [handle, threadId]),
      ).toEqual([
        ["lead", "crew-game-lead-1"],
        ["backend", "crew-game-backend-1"],
        ["frontend", "crew-game-frontend-1"],
        ["erik", "crew-game-erik-1"],
      ]);
    });

    it("wears each face's state, and says it only in its accessible name", () => {
      const backend = crew({ view: engineView() })?.find((entry) => entry.handle === "backend");
      expect(backend?.face).toBe("working");
      expect(backend === undefined ? null : crewmateAccessibleName(backend)).toBe(
        "Backend, one of Fen's crew, Working",
      );
    });
  });

  it("says on hover who each is, and a crewmate's job in its first sentence", () => {
    expect(crew()?.map(({ name, role, job }) => [`${name}${role}`, job])).toEqual([
      ["Lead, Fen's lead — plans and reviews the crew's work", null],
      ["Backend, one of Fen's crew", "Owns the API under src/api and its tests."],
      ["Frontend, one of Fen's crew", "Owns the game UI: the camera, the HUD and their tests."],
      ["Erik, one of Fen's crew", "Writes the business plan in docs/business-plan.md."],
    ]);
  });

  it("says a job written to its crewmate as the person's line", () => {
    const snapshot = crewSnapshotFixture();
    const told = view({
      ...snapshot,
      crewmates: snapshot.crewmates.map((crewmate) =>
        crewmate.handle === "backend"
          ? { ...crewmate, jobFirstLine: "You own Backend: the API under src/api. Test it." }
          : crewmate.handle === "frontend"
            ? { ...crewmate, jobFirstLine: "You own the game UI — the camera and the HUD." }
            : crewmate,
      ),
    });
    expect(crew({ view: told })?.map((entry) => entry.job)).toEqual([
      null,
      "The API under src/api.",
      "The game UI — the camera and the HUD.",
      "Writes the business plan in docs/business-plan.md.",
    ]);
  });

  it("puts the crewmate whose chat is on screen on the band", () => {
    expect(
      crew({ crewChat: { handle: "backend", title: "Backend" } })
        ?.filter((entry) => entry.open)
        .map((entry) => entry.handle),
    ).toEqual(["backend"]);
  });

  it("wears each face's state, and says it only in its accessible name", () => {
    const backend = crew()?.find((entry) => entry.handle === "backend");
    expect(backend?.face).toBe("working");
    expect(backend === undefined ? null : crewmateAccessibleName(backend)).toBe(
      "Backend, one of Fen's crew, Working",
    );
    const lead = crew()?.find((entry) => entry.handle === "lead");
    expect(lead === undefined ? null : crewmateAccessibleName(lead)).toBe(
      "Lead, Fen's lead — plans and reviews the crew's work",
    );
  });

  it("sleeps every face while the Mate's container is not connected", () => {
    expect(new Set(crew({ connected: false })?.map((entry) => entry.face))).toEqual(
      new Set(["sleep"]),
    );
  });

  it("opens nothing for a crewmate before its first turn", () => {
    const snapshot = crewSnapshotFixture();
    const [first] =
      crew({
        view: view({
          ...snapshot,
          crewmates: snapshot.crewmates.map((crewmate) =>
            crewmate.handle === "lead"
              ? { ...crewmate, currentThreadId: null, stints: [] }
              : crewmate,
          ),
        }),
      }) ?? [];
    expect(first).toMatchObject({ handle: "lead", threadId: null, status: null });
  });

  it.each<{
    readonly name: string;
    readonly input: Partial<Parameters<typeof lineCrew>[0]>;
    readonly drawn: ReadonlyArray<readonly [string, string, string | null, boolean]> | null;
  }>([
    {
      name: "a Mate with no crew: no divider and no faces",
      input: { view: view(crewSnapshotFixture({ status: "none", crew: null, crewmates: [] })) },
      drawn: null,
    },
    {
      name: "before the feed answers, nothing remembered: nothing yet",
      input: { view: null },
      drawn: null,
    },
    {
      name: "before the feed answers: the faces this browser last read",
      input: { view: null, remembered: REMEMBERED },
      drawn: [
        ["lead", "Lead", "violet", false],
        ["backend", "Backend", "sky", false],
      ],
    },
    {
      name: "before the feed answers, in a crewmate's chat: it on the band among them",
      input: {
        view: null,
        remembered: REMEMBERED,
        crewChat: { handle: "backend", title: "Backend" },
      },
      drawn: [
        ["lead", "Lead", "violet", false],
        ["backend", "Backend", "sky", true],
      ],
    },
    {
      name: "before the feed answers, in the chat of a crewmate not remembered: added last",
      input: {
        view: null,
        remembered: REMEMBERED,
        crewChat: { handle: "rules", title: "Game Rules" },
      },
      drawn: [
        ["lead", "Lead", "violet", false],
        ["backend", "Backend", "sky", false],
        ["rules", "Game Rules", null, true],
      ],
    },
    {
      name: "a crewmate's chat with nothing read or remembered: it alone, named as its chat",
      input: { view: null, crewChat: { handle: "rules", title: "Game Rules" } },
      drawn: [["rules", "Game Rules", null, true]],
    },
    {
      name: "a crewmate's chat whose crew is gone: it alone",
      input: {
        view: view(crewSnapshotFixture({ status: "none", crew: null, crewmates: [] })),
        remembered: REMEMBERED,
        crewChat: { handle: "rules", title: "Game Rules" },
      },
      drawn: [["rules", "Game Rules", null, true]],
    },
  ])("$name", ({ input, drawn }) => {
    const entries = crew(input);
    expect(
      entries === null
        ? null
        : entries.map((entry) => [entry.handle, entry.name, entry.tint, entry.open]),
    ).toEqual(drawn);
    for (const entry of entries ?? []) {
      expect(entry).toMatchObject({
        face: "idle",
        known: false,
        threadId: null,
        job: null,
        status: null,
      });
    }
  });
});

describe("foldCrew", () => {
  const face = (handle: string, open = false): LineCrewmate => ({
    handle,
    name: handle,
    tint: "sky",
    face: "idle",
    lead: false,
    open,
    known: true,
    threadId: ThreadId.make(`thread-crew-${handle}-1`),
    role: ", one of Fen's crew",
    job: null,
    status: null,
  });
  // Faces are 28 px; the open one's pill 120; 2 px between; *N more* 60 with its gap.
  const room = (width: number, crew: ReadonlyArray<LineCrewmate>): CrewRoom => ({
    width,
    widths: new Map(crew.map((entry) => [entry.handle, entry.open ? 120 : 28])),
    gap: 2,
    more: 60,
  });
  const handles = (entries: ReadonlyArray<LineCrewmate>) => entries.map((entry) => entry.handle);
  const crew = [face("lead"), face("a"), face("b"), face("c", true), face("d"), face("e")];

  it.each<{
    readonly name: string;
    readonly width: number | null;
    readonly visible: ReadonlyArray<string>;
    readonly folded: ReadonlyArray<string>;
    readonly more: boolean;
  }>([
    {
      name: "keeps every face while the line holds them",
      width: 5 * 28 + 120 + 5 * 2,
      visible: ["lead", "a", "b", "c", "d", "e"],
      folded: [],
      more: false,
    },
    {
      name: "folds nothing before it is measured",
      width: null,
      visible: ["lead", "a", "b", "c", "d", "e"],
      folded: [],
      more: false,
    },
    {
      name: "folds the tail into N more, never the crewmate on screen",
      width: 2 * 28 + 120 + 2 * 2 + 60,
      visible: ["lead", "a", "c"],
      folded: ["b", "d", "e"],
      more: true,
    },
    {
      name: "keeps the crewmate on screen alone, with N more, where nothing else fits",
      width: 120 + 60,
      visible: ["c"],
      folded: ["lead", "a", "b", "d", "e"],
      more: true,
    },
    {
      name: "lets N more give way where even that does not fit beside it",
      width: 120 + 30,
      visible: ["c"],
      folded: ["lead", "a", "b", "d", "e"],
      more: false,
    },
  ])("$name", ({ width, visible, folded, more }) => {
    const folding = foldCrew(crew, width === null ? null : room(width, crew));
    expect(handles(folding.visible)).toEqual(visible);
    expect(handles(folding.folded)).toEqual(folded);
    expect(folding.more).toBe(more);
  });

  it("folds from the tail on a Mate's own chat, where no crewmate is on screen", () => {
    const shut = crew.map((entry) => ({ ...entry, open: false }));
    const folding = foldCrew(shut, room(3 * 28 + 2 * 2 + 60, shut));
    expect(handles(folding.visible)).toEqual(["lead", "a", "b"]);
    expect(handles(folding.folded)).toEqual(["c", "d", "e"]);
    expect(folding.more).toBe(true);
  });
});

describe("lineStage", () => {
  const seat = (handle: string, open = false) => ({ handle, open });

  it.each<{
    readonly name: string;
    readonly mate: { readonly open: boolean };
    readonly crew: ReadonlyArray<{ readonly handle: string; readonly open: boolean }> | null;
    readonly stage: LineStage;
  }>([
    {
      name: "a Mate with no crew: no band, no crew",
      mate: { open: true },
      crew: null,
      stage: { band: null, crew: null },
    },
    {
      name: "the Mate's own chat: the band on the Mate, the crew in its order",
      mate: { open: true },
      crew: [seat("lead"), seat("rules"), seat("web")],
      stage: { band: MATE_SEAT, crew: ["lead", "rules", "web"] },
    },
    {
      name: "a crewmate's chat: the band on that crewmate",
      mate: { open: false },
      crew: [seat("lead"), seat("rules", true), seat("web")],
      stage: { band: "rules", crew: ["lead", "rules", "web"] },
    },
  ])("$name", ({ mate, crew, stage }) => {
    expect(lineStage(mate, crew)).toEqual(stage);
  });

  it("names the Mate's place with a key no crewmate's handle can be", () => {
    expect(/^[a-z0-9-]{1,20}$/.test(MATE_SEAT)).toBe(false);
  });
});

describe("lineMotion", () => {
  const CREW = ["lead", "rules", "web"];
  const on = (band: string | null, crew: ReadonlyArray<string> | null = CREW): LineStage => ({
    band,
    crew,
  });

  it.each<{
    readonly name: string;
    readonly previous: LineStage | null;
    readonly next: LineStage;
    readonly motion: "travel" | "place";
  }>([
    {
      name: "the first paint — a reload, a Mate opened — is placed",
      previous: null,
      next: on(MATE_SEAT),
      motion: "place",
    },
    {
      name: "the Mate's own chat to a crewmate's travels",
      previous: on(MATE_SEAT),
      next: on("rules"),
      motion: "travel",
    },
    {
      name: "one crewmate's chat to its neighbour's travels",
      previous: on("lead"),
      next: on("rules"),
      motion: "travel",
    },
    {
      name: "a crewmate's chat to one far down the line travels",
      previous: on("lead"),
      next: on("web"),
      motion: "travel",
    },
    {
      name: "a crewmate's chat back to the Mate's own travels",
      previous: on("web"),
      next: on(MATE_SEAT),
      motion: "travel",
    },
    {
      name: "another of the Mate's own chats keeps the band where it is",
      previous: on(MATE_SEAT),
      next: on(MATE_SEAT),
      motion: "place",
    },
    {
      name: "the crew arriving — the crewmate on screen alone, then its whole crew — is placed",
      previous: on("rules", ["rules"]),
      next: on("rules"),
      motion: "place",
    },
    {
      name: "a crewmate added as the chat changes is placed",
      previous: on("lead"),
      next: on("rules", [...CREW, "docs"]),
      motion: "place",
    },
    {
      name: "a crewmate removed is placed",
      previous: on("lead"),
      next: on(MATE_SEAT, ["lead", "rules"]),
      motion: "place",
    },
    {
      name: "the crew read in another order is placed",
      previous: on("lead"),
      next: on("rules", ["rules", "lead", "web"]),
      motion: "place",
    },
    {
      name: "a crew appearing under a Mate that had none is placed",
      previous: on(null, null),
      next: on(MATE_SEAT),
      motion: "place",
    },
    {
      name: "a crew gone, its band with it, is placed",
      previous: on("rules"),
      next: on(null, null),
      motion: "place",
    },
  ])("$name", ({ previous, next, motion }) => {
    expect(lineMotion(previous, next, { reducedMotion: false })).toBe(motion);
    // Reduced motion cross-fades what would travel, and places the rest the same.
    expect(lineMotion(previous, next, { reducedMotion: true })).toBe(
      motion === "travel" ? "fade" : "place",
    );
  });
});

describe("lineLeaving", () => {
  const CREW = ["lead", "rules", "web"];
  const on = (band: string | null, crew: ReadonlyArray<string> | null = CREW): LineStage => ({
    band,
    crew,
  });

  it.each<{
    readonly name: string;
    readonly previous: { readonly stage: LineStage; readonly leaving: ReadonlyArray<string> };
    readonly next: LineStage;
    readonly motion: "travel" | "fade" | "place";
    readonly leaving: ReadonlyArray<string>;
  }>([
    {
      name: "the crewmate left folds its name back into its face",
      previous: { stage: on("lead"), leaving: [] },
      next: on("rules"),
      motion: "travel",
      leaving: ["lead"],
    },
    {
      name: "the Mate keeps its name: leaving it folds nothing",
      previous: { stage: on(MATE_SEAT), leaving: [] },
      next: on("rules"),
      motion: "travel",
      leaving: [],
    },
    {
      name: "a name still folding keeps folding as the next press lands",
      previous: { stage: on("rules"), leaving: ["lead"] },
      next: on("web"),
      motion: "travel",
      leaving: ["lead", "rules"],
    },
    {
      name: "a crewmate pressed again while its name folds opens it again",
      previous: { stage: on("rules"), leaving: ["lead"] },
      next: on("lead"),
      motion: "travel",
      leaving: ["rules"],
    },
    {
      name: "reduced motion fades the name left the same way",
      previous: { stage: on("lead"), leaving: [] },
      next: on(MATE_SEAT),
      motion: "fade",
      leaving: ["lead"],
    },
    {
      name: "a line placed keeps nothing folding",
      previous: { stage: on("rules"), leaving: ["lead"] },
      next: on("web", [...CREW, "docs"]),
      motion: "place",
      leaving: [],
    },
  ])("$name", ({ previous, next, motion, leaving }) => {
    expect(lineLeaving(previous, next, motion)).toEqual(leaving);
  });
});

describe("mateWorks", () => {
  // Whether the Mate is at work in any of its chats: a turn running, or helpers it started
  // still running after the turn — what holds its review ask back.
  it.each([
    {
      name: "a turn runs in its main chat",
      chats: [shell("main", { latestTurn: running })],
      works: true,
    },
    {
      name: "a turn runs in another of its chats",
      chats: [shell("main"), shell("logs", { latestTurn: running })],
      works: true,
    },
    {
      name: "helpers it started still run after the turn",
      chats: [shell("main", { backgroundLiveness: "working" })],
      works: true,
    },
    {
      name: "only a watch loop runs",
      chats: [shell("main", { backgroundLiveness: "monitoring" })],
      works: false,
    },
    { name: "every chat rests", chats: [shell("main"), shell("logs")], works: false },
    { name: "it has no chat", chats: [], works: false },
  ])("$name: $works", ({ chats, works }) => {
    expect(mateWorks(chats)).toBe(works);
  });
});

describe("alsoWorkingLine", () => {
  const working = { latestTurn: running };
  const main = shell("main");
  const logs = shell("logs", { title: "Logs", createdAt: "2026-09-05T11:00:00.000Z" });
  const line = (input: {
    chats: ReadonlyArray<EnvironmentThreadShell>;
    current: string | null;
    typing: boolean;
  }) =>
    alsoWorkingLine({
      mateName: "Fen",
      chats: input.chats,
      currentThreadId: input.current === null ? null : ThreadId.make(input.current),
      typing: input.typing,
    });

  it.each([
    {
      name: "names the main chat while you type in another",
      chats: [shell("main", working), logs],
      current: "logs",
      typing: true,
      expected: "Fen is also working in your main chat — both change the same files.",
    },
    {
      name: "names another chat by its title while you type in the main one",
      chats: [main, shell("logs", { ...working, title: "Logs" })],
      current: "main",
      typing: true,
      expected: "Fen is also working in ‘Logs’ — both change the same files.",
    },
    {
      name: "counts every chat as another while you start a new one",
      chats: [shell("main", working), logs],
      current: null,
      typing: true,
      expected: "Fen is also working in your main chat — both change the same files.",
    },
    {
      name: "stays silent until you type",
      chats: [shell("main", working), logs],
      current: "logs",
      typing: false,
      expected: null,
    },
    {
      name: "stays silent when only the chat you are in works",
      chats: [main, shell("logs", { ...working, title: "Logs" })],
      current: "logs",
      typing: true,
      expected: null,
    },
  ])("$name", (row) => {
    expect(line(row)).toBe(row.expected);
  });
});

describe("replacementChatToPin", () => {
  const pinned = { pinnedAt: "2026-09-05T09:00:00.000Z" };
  const archived = { ...pinned, archivedAt: "2026-09-05T11:00:00.000Z" };
  const sent = ThreadId.make("fresh");
  it.each<{
    readonly name: string;
    readonly threads: ReadonlyArray<EnvironmentThreadShell>;
    readonly pin: string | null;
  }>([
    {
      name: "pins the chat that replaced the main one, whose pin went with the archive",
      threads: [shell("old-main", archived), shell("logs"), shell("fresh")],
      pin: "fresh",
    },
    {
      name: "writes nothing while another chat is main",
      threads: [shell("main", pinned), shell("fresh")],
      pin: null,
    },
    {
      name: "writes nothing for a Mate's only chat, which is main without a pin",
      threads: [shell("old-main", { archivedAt: "2026-09-05T11:00:00.000Z" }), shell("fresh")],
      pin: null,
    },
    {
      name: "counts a crewmate's thread as no chat of the Mate's",
      threads: [
        shell("old-main", archived),
        shell("crew", { crew: { crew: "shop", crewmate: "backend", stint: 1 } }),
      ],
      pin: null,
    },
  ])("$name", ({ threads, pin }) => {
    expect(replacementChatToPin(threads, sent)).toBe(pin);
  });
});
