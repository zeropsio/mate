import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { ThreadId, type CrewSnapshot } from "@t3tools/contracts";
import type { CrewDigest, LoginDigest, MateThreadKind } from "@t3tools/shared/mateLink";
import { describe, expect, it } from "vite-plus/test";

import { crewLine, crewTaskReviewable } from "./SidebarCrewLine.logic";

/**
 * The fixture's crew as its Mate's overview carries it to HQ: each crewmate's chat in the kind
 * `kinds` says (by handle), idle where it says none; the waiting list and the ready work as the
 * snapshot has them; the person landing unless the run lands itself.
 */
function digest(
  input: {
    readonly kinds?: Readonly<Record<string, MateThreadKind>>;
    readonly snapshot?: Partial<CrewSnapshot>;
  } = {},
): CrewDigest {
  const snapshot: CrewSnapshot = { ...crewSnapshotFixture(), attention: [], ...input.snapshot };
  return {
    crewmates: snapshot.crewmates.map((mate) => ({
      handle: mate.handle,
      displayName: mate.displayName,
      tint: mate.tint,
      lead: mate.kind === "lead",
      threadId: mate.currentThreadId,
      threadKind: mate.currentThreadId === null ? null : (input.kinds?.[mate.handle] ?? "idle"),
      loginKey: mate.login.agent,
    })),
    attention: snapshot.attention.map(({ id, kind, handle }) => ({ id, kind, handle })),
    readyTasks: snapshot.board.tasks
      .filter((task) => task.state === "ready")
      .map((task) => ({ id: task.id, owner: task.owner })),
    personLands: snapshot.run?.options.landing !== "lead",
  };
}

/** The fixture's board with `ids` made ready: they wait for your Land. */
const readyTasks = (ids: ReadonlyArray<string>) =>
  crewSnapshotFixture().board.tasks.map((task) =>
    ids.includes(task.id) ? { ...task, state: "ready" as const } : task,
  );

describe("crewLine — the crew as one line under its Mate", () => {
  it("draws an unopened Mate's faces from its digest, the lead first, each in its chat's kind", () => {
    const line = crewLine(digest({ kinds: { backend: "working", frontend: "input" } }), true);
    expect(line.faces).toEqual([
      expect.objectContaining({ handle: "lead", lead: true, state: "idle" }),
      expect.objectContaining({ handle: "backend", lead: false, state: "working" }),
      expect.objectContaining({ handle: "frontend", lead: false, state: "needs" }),
      expect.objectContaining({ handle: "erik", lead: false, state: "idle" }),
    ]);
    expect(line.faces[1]?.threadId).toBe(ThreadId.make("thread-crew-backend-2"));
    expect(line.faces[1]?.tint).toBe(crewSnapshotFixture().crewmates[1]?.tint);
  });

  it.each([
    { case: "nothing waits on you", input: {}, fact: null },
    {
      case: "a crewmate's chat asks you something",
      input: { kinds: { backend: "input" as const } },
      fact: { kind: "needs", words: "Backend needs you" },
    },
    {
      case: "the crew's waiting list names two crewmates",
      input: { snapshot: { attention: crewSnapshotFixture().attention.slice(0, 2) } },
      fact: { kind: "needs", words: "Frontend and Erik need you" },
    },
    {
      case: "every row of the waiting list, the lead's plan first",
      input: { snapshot: { attention: crewSnapshotFixture().attention } },
      fact: { kind: "needs", words: "Lead and 3 others need you" },
    },
    {
      case: "one task waits for your Land",
      input: { snapshot: { board: { tasks: readyTasks(["task-13"]) } } },
      fact: { kind: "land", words: "Frontend's work is ready", taskId: "task-13" },
    },
    {
      case: "two tasks wait for your Land, the first on the board opens",
      input: { snapshot: { board: { tasks: readyTasks(["task-15", "task-13"]) } } },
      fact: { kind: "land", words: "2 pieces of work are ready", taskId: "task-13" },
    },
    {
      case: "a task is ready and somebody needs you: who needs you first",
      input: {
        kinds: { erik: "approval" as const },
        snapshot: { board: { tasks: readyTasks(["task-13"]) } },
      },
      fact: { kind: "needs", words: "Erik needs you" },
    },
  ])("says the one most urgent fact: $case", ({ input, fact }) => {
    expect(crewLine(digest(input), true).fact).toEqual(fact);
  });

  // Under a colleague's Mate the crew waits on its owner, never on the viewer (the owner,
  // 2026-09-30): no "needs you", no needs face — and its finished work keeps its Review.
  it.each([
    {
      case: "a crewmate asks",
      input: { kinds: { backend: "input" as const } },
      fact: null,
    },
    {
      case: "the waiting list names crewmates",
      input: { snapshot: { attention: crewSnapshotFixture().attention.slice(0, 2) } },
      fact: null,
    },
    {
      case: "a crewmate asks and a task is ready: the work, not the ask",
      input: {
        kinds: { erik: "approval" as const },
        snapshot: { board: { tasks: readyTasks(["task-13"]) } },
      },
      fact: { kind: "land", words: "Frontend's work is ready", taskId: "task-13" },
    },
  ])("says nobody needs the viewer under another's Mate: $case", ({ input, fact }) => {
    const line = crewLine(digest(input), false);
    expect(line.fact).toEqual(fact);
    expect(line.faces.some((face) => face.state === "needs")).toBe(false);
  });

  it("counts no task the lead lands itself", () => {
    const fixture = crewSnapshotFixture();
    const crew = digest({
      snapshot: {
        board: { tasks: readyTasks(["task-13"]) },
        run: { ...fixture.run!, options: { ...fixture.run!.options, landing: "lead" } },
      },
    });
    expect(crewLine(crew, true).fact).toBeNull();
  });

  it("does not count a ready-to-land row of the waiting list as somebody needing you", () => {
    const crew = digest({ snapshot: { board: { tasks: readyTasks(["task-13"]) } } });
    const ready = { id: "ready-to-land:task-13", kind: "ready-to-land", handle: "frontend" };
    expect(crewLine({ ...crew, attention: [ready] }, true).fact).toEqual({
      kind: "land",
      words: "Frontend's work is ready",
      taskId: "task-13",
    });
  });

  it("draws a tint this build does not know as the first one", () => {
    const crew = digest();
    const strange = { ...crew, crewmates: [{ ...crew.crewmates[0]!, tint: "ultraviolet" }] };
    expect(crewLine(strange, true).faces[0]?.tint).toBe("coral");
  });
});

describe("crewTaskReviewable — Review only where the task's crewmate is the viewer's to run (D6)", () => {
  const crew = digest({ snapshot: { board: { tasks: readyTasks(["task-13"]) } } });
  // Frontend owns task 13 and runs on Claude Code's login.
  const login = (patch: Partial<LoginDigest>): Record<string, LoginDigest> => ({
    "claude-code": { signedInBy: "ada", present: true, token: false, ...patch },
  });

  it.each([
    { case: "signed in by the viewer", logins: login({}), viewer: "ada", reviews: true },
    { case: "signed in by somebody else", logins: login({}), viewer: "bo", reviews: false },
    {
      case: "a project token's, anybody's",
      logins: login({ token: true }),
      viewer: "bo",
      reviews: true,
    },
    {
      case: "signed in by nobody on record",
      logins: login({ signedInBy: null }),
      viewer: "ada",
      reviews: false,
    },
    { case: "no credential yet", logins: login({ present: false }), viewer: "bo", reviews: true },
    { case: "a login the overview names nothing of", logins: {}, viewer: "bo", reviews: true },
    { case: "a viewer not known yet", logins: login({}), viewer: undefined, reviews: false },
  ])(
    "offers Review only for a ready task the viewer may land: $case",
    ({ logins, viewer, reviews }) => {
      expect(crewTaskReviewable(crew, logins, viewer)("task-13")).toBe(reviews);
    },
  );
});
