import {
  crewConversationId,
  crewEngineSnapshotFixture,
  crewSnapshotFixture,
} from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { deriveCrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import { ThreadId, type CrewPromptVersion } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { crewChatNotices } from "./crewChatNotices";

function backend(running: CrewPromptVersion, current: CrewPromptVersion) {
  const snapshot = crewSnapshotFixture();
  const view = deriveCrewView(
    {
      ...snapshot,
      crewmates: snapshot.crewmates.map((crewmate) =>
        crewmate.handle === "backend"
          ? { ...crewmate, promptVersions: { running, current }, jobVersion: current.job }
          : crewmate,
      ),
    },
    [],
    () => {
      throw new Error("no shells here");
    },
  );
  return view.crewmates.find(({ crewmate }) => crewmate.handle === "backend")!;
}

const CURRENT = ThreadId.make("thread-crew-backend-2");
const EARLIER = ThreadId.make("thread-crew-backend-1");

describe("crewChatNotices", () => {
  it.each<{
    readonly name: string;
    readonly running: CrewPromptVersion;
    readonly current: CrewPromptVersion;
    readonly pending: string | null;
  }>([
    {
      name: "says nothing while the crewmate runs on what is current",
      running: { brief: 4, job: 5 },
      current: { brief: 4, job: 5 },
      pending: null,
    },
    {
      name: "says a changed job starts a fresh conversation, with no version",
      running: { brief: 4, job: 4 },
      current: { brief: 4, job: 5 },
      pending: "Its job changed. Its next message starts a fresh conversation.",
    },
    {
      name: "says a changed goal starts a fresh conversation",
      running: { brief: 4, job: 5 },
      current: { brief: 5, job: 5 },
      pending: "The crew's goal changed. Its next message starts a fresh conversation.",
    },
    {
      name: "names both when both changed",
      running: { brief: 4, job: 4 },
      current: { brief: 5, job: 5 },
      pending: "Its job and the crew's goal changed. Its next message starts a fresh conversation.",
    },
  ])("$name", ({ running, current, pending }) => {
    expect(crewChatNotices(backend(running, current), CURRENT)).toEqual({ retired: null, pending });
  });

  it("points an earlier conversation at the one the crewmate talks in now, and sends nothing from it", () => {
    expect(crewChatNotices(backend({ brief: 4, job: 4 }, { brief: 4, job: 5 }), EARLIER)).toEqual({
      retired: {
        text: "An earlier conversation with Backend — it goes on in a newer one.",
        currentThreadId: CURRENT,
        sendBlock: "Write to Backend in its current conversation",
      },
      pending: null,
    });
  });
});

describe("crewChatNotices on the engine", () => {
  it("never points a crewmate's conversation at another: it talks in it, and sends from it", () => {
    const view = deriveCrewView(crewEngineSnapshotFixture(), [], () => {
      throw new Error("no shells here");
    });
    const backendRow = view.crewmates.find(({ crewmate }) => crewmate.handle === "backend")!;
    expect(crewChatNotices(backendRow, crewConversationId("backend")).retired).toBeNull();
  });
});
