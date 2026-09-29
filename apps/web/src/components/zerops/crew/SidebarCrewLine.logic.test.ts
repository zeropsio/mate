import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import {
  deriveCrewView,
  type CrewShellInput,
  type CrewThreadRead,
} from "@t3tools/client-runtime/zerops/projections/crew";
import { ThreadId, type CrewSnapshot } from "@t3tools/contracts";
import type { ThreadStatusKind } from "@t3tools/shared/threadStatus";
import { describe, expect, it } from "vite-plus/test";

import { crewLine } from "./SidebarCrewLine.logic";

/** A crew whose crewmates' threads say `kinds` (by handle), and nothing else waits on you. */
function crew(
  input: {
    readonly kinds?: Readonly<Record<string, ThreadStatusKind>>;
    readonly snapshot?: Partial<CrewSnapshot>;
  } = {},
) {
  const snapshot: CrewSnapshot = { ...crewSnapshotFixture(), attention: [], ...input.snapshot };
  const kinds = input.kinds ?? {};
  const shells: ReadonlyArray<CrewShellInput> = snapshot.crewmates.flatMap((mate) =>
    mate.currentThreadId === null ? [] : [{ id: mate.currentThreadId, archivedAt: null }],
  );
  const handleOf = (id: string) =>
    snapshot.crewmates.find((mate) => mate.currentThreadId === id)?.handle ?? "";
  const read = (shell: CrewShellInput): CrewThreadRead => {
    const kind = kinds[handleOf(shell.id)] ?? "idle";
    return {
      status: { kind, toneId: "neutral" },
      word: kind === "idle" ? null : kind,
      working: kind === "working",
    };
  };
  return { view: deriveCrewView(snapshot, shells, read), attention: snapshot.attention };
}

/** The fixture's board with task 13 made ready: it waits for your Land, the run on `person`. */
const readyTasks = (ids: ReadonlyArray<string>) =>
  crewSnapshotFixture().board.tasks.map((task) =>
    ids.includes(task.id) ? { ...task, state: "ready" as const } : task,
  );

describe("crewLine — the crew as one line under its Mate", () => {
  it("draws every crewmate's face, the lead first, each in its thread's state", () => {
    const { view, attention } = crew({ kinds: { backend: "working", frontend: "done" } });
    expect(crewLine(view, attention).faces).toEqual([
      expect.objectContaining({ handle: "lead", lead: true, state: "idle" }),
      expect.objectContaining({ handle: "backend", lead: false, state: "working" }),
      expect.objectContaining({ handle: "frontend", lead: false, state: "done" }),
      expect.objectContaining({ handle: "erik", lead: false, state: "idle" }),
    ]);
    expect(crewLine(view, attention).faces[1]?.threadId).toBe(
      ThreadId.make("thread-crew-backend-2"),
    );
  });

  it.each([
    { case: "nothing waits on you", input: {}, fact: null },
    {
      case: "a crewmate's thread asks you something",
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
      fact: { kind: "land", words: "1 task ready to land", taskId: "task-13" },
    },
    {
      case: "two tasks wait for your Land, the first on the board opens",
      input: { snapshot: { board: { tasks: readyTasks(["task-15", "task-13"]) } } },
      fact: { kind: "land", words: "2 tasks ready to land", taskId: "task-13" },
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
    const { view, attention } = crew(input);
    expect(crewLine(view, attention).fact).toEqual(fact);
  });

  it("counts no task the lead lands itself", () => {
    const fixture = crewSnapshotFixture();
    const { view, attention } = crew({
      snapshot: {
        board: { tasks: readyTasks(["task-13"]) },
        run: { ...fixture.run!, options: { ...fixture.run!.options, landing: "lead" } },
      },
    });
    expect(crewLine(view, attention).fact).toBeNull();
  });

  it("does not count a ready-to-land row of the waiting list as somebody needing you", () => {
    const { view } = crew({ snapshot: { board: { tasks: readyTasks(["task-13"]) } } });
    const ready = {
      ...crewSnapshotFixture().attention[0]!,
      id: "ready-to-land:task-13",
      kind: "ready-to-land" as const,
      handle: "frontend",
      taskId: "task-13",
    };
    expect(crewLine(view, [ready]).fact).toEqual({
      kind: "land",
      words: "1 task ready to land",
      taskId: "task-13",
    });
  });
});
