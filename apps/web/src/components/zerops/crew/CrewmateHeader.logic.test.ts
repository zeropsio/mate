import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { deriveCrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import { ThreadId, type CrewSnapshot, type Crewmate } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { crewmateHeaderModel } from "./CrewmateHeader.logic";

const IDLE = { status: { kind: "idle" }, word: null, working: false } as const;

const view = (snapshot: CrewSnapshot = crewSnapshotFixture()) =>
  deriveCrewView(snapshot, [], () => IDLE as never);

const withCrewmate = (handle: string, fields: Partial<Crewmate>): CrewSnapshot => {
  const snapshot = crewSnapshotFixture();
  return {
    ...snapshot,
    crewmates: snapshot.crewmates.map((crewmate) =>
      crewmate.handle === handle ? { ...crewmate, ...fields } : crewmate,
    ),
  };
};

const BACKEND = { crew: "shop", crewmate: "backend", stint: 2 } as const;
const ON_BACKEND = ThreadId.make("thread-crew-backend-2");

describe("crewmateHeaderModel", () => {
  it("heads a crewmate's chat with its face, name, @handle and job line", () => {
    expect(crewmateHeaderModel(view(), BACKEND, ON_BACKEND)).toMatchObject({
      handle: "backend",
      name: "Backend",
      tint: "sky",
      job: "Owns the API under src/api and its tests.",
    });
  });

  it.each<{
    readonly name: string;
    readonly running: { readonly brief: number; readonly job: number } | null;
    readonly current: { readonly brief: number; readonly job: number };
    readonly version: { readonly label: string; readonly pending: boolean };
  }>([
    {
      name: "names the job's version while the crewmate runs on it",
      running: { brief: 4, job: 4 },
      current: { brief: 4, job: 4 },
      version: { label: "Job v4", pending: false },
    },
    {
      name: "names the job version its next turn brings in",
      running: { brief: 4, job: 4 },
      current: { brief: 4, job: 5 },
      version: { label: "v5 at next turn", pending: true },
    },
    {
      name: "names the brief version its next turn brings in",
      running: { brief: 4, job: 4 },
      current: { brief: 5, job: 4 },
      version: { label: "Brief v5 at next turn", pending: true },
    },
    {
      name: "a crewmate before its first turn runs on what is current",
      running: null,
      current: { brief: 4, job: 2 },
      version: { label: "Job v2", pending: false },
    },
  ])("$name", ({ running, current, version }) => {
    const model = crewmateHeaderModel(
      view(
        withCrewmate("backend", {
          promptVersions: { running, current },
          jobVersion: current.job,
        }),
      ),
      BACKEND,
      ON_BACKEND,
    );
    expect(model?.version).toEqual(version);
  });

  it("lists its other conversations, newest first, the one it talks in now marked", () => {
    expect(
      crewmateHeaderModel(view(), BACKEND, ThreadId.make("thread-crew-backend-1"))?.previous,
    ).toEqual([{ threadId: "thread-crew-backend-2", label: "Conversation 2 · current" }]);
    expect(crewmateHeaderModel(view(), BACKEND, ON_BACKEND)?.previous).toEqual([
      { threadId: "thread-crew-backend-1", label: "Conversation 1" },
    ]);
  });

  it("tells the lead from a crewmate", () => {
    const LEAD = { crew: "shop", crewmate: "lead", stint: 1 } as const;
    expect(crewmateHeaderModel(view(), LEAD, ThreadId.make("thread-crew-lead-1"))?.lead).toBe(true);
    expect(crewmateHeaderModel(view(), BACKEND, ON_BACKEND)?.lead).toBe(false);
  });

  it("counts what Remove from crew would discard and what Forget memory would clear", () => {
    expect(crewmateHeaderModel(view(), BACKEND, ON_BACKEND)).toMatchObject({
      unlandedCommits: 3,
      memoryEntries: 6,
    });
  });

  it("names a crewmate on another login by that login's label", () => {
    const work = withCrewmate("backend", {
      login: { id: "claudeWork", label: "work", agent: "claude-code" },
    });
    expect(crewmateHeaderModel(view(work), BACKEND, ON_BACKEND)?.login).toBe("work");
    expect(crewmateHeaderModel(view(), BACKEND, ON_BACKEND)?.login).toBeNull();
  });

  it("falls back to the thread's own origin while the crew is not read yet", () => {
    expect(crewmateHeaderModel(null, BACKEND, ON_BACKEND)).toBeNull();
    expect(
      crewmateHeaderModel(view(), { crew: "shop", crewmate: "gone", stint: 1 }, ON_BACKEND),
    ).toBeNull();
  });
});
