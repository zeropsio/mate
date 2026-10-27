import { CrewSnapshot, CrewTint, type CrewTaskState } from "@t3tools/contracts";
import { MATE_TINTS } from "@t3tools/shared/brand";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { crewSnapshotFixture } from "./fixtures.ts";

const decodeSnapshot = Schema.decodeUnknownSync(CrewSnapshot);

/** States a crewmate's open task is never in (`openTaskId`'s doc). */
const NOT_OPEN: ReadonlySet<CrewTaskState> = new Set([
  "proposed",
  "queued",
  "landed",
  "parked",
  "discarded",
]);

describe("crewSnapshotFixture", () => {
  it("is a snapshot the crew feed could send", () => {
    const fixture = crewSnapshotFixture();
    expect(decodeSnapshot(fixture)).toEqual(fixture);
  });

  it("keeps the wire's cross-field rules", () => {
    const { status, crew, crewmates, board, landedNotDelivered } = crewSnapshotFixture();
    expect(status === "applied").toBe(crew !== null);
    expect(crewmates[0]?.kind).toBe("lead");
    expect(crewmates.filter((mate) => mate.kind === "lead").length).toBeLessThanOrEqual(1);
    for (const mate of crewmates) {
      expect(mate.readOnly, mate.handle).toBe(mate.kind !== "writer");
      expect(mate.jobVersion, mate.handle).toBe(mate.promptVersions.current.job);
      for (const perWriter of [mate.lane, mate.app, mate.host]) {
        expect(perWriter === null, mate.handle).toBe(mate.readOnly);
      }
      const owned = board.tasks.filter((task) => task.owner === mate.handle);
      const open = owned.find((task) => task.id === mate.openTaskId);
      if (mate.openTaskId !== null) {
        expect(open, mate.handle).toBeDefined();
        expect(NOT_OPEN.has(open!.state), mate.handle).toBe(false);
      }
      for (const queuedId of mate.queuedTaskIds) {
        expect(owned.find((task) => task.id === queuedId)?.state, queuedId).toBe("queued");
      }
    }
    expect(landedNotDelivered).toBe(
      board.tasks.filter((task) => task.state === "landed" && !task.delivered).length,
    );
  });

  it("puts tasks in every state a board draws differently", () => {
    const states = new Set(crewSnapshotFixture().board.tasks.map((task) => task.state));
    const drawnDifferently: ReadonlyArray<CrewTaskState> = [
      "proposed",
      "queued",
      "working",
      "blocked",
      "waiting-on-you",
      "landed",
      "parked",
      "discarded",
    ];
    for (const state of drawnDifferently) {
      expect(states.has(state), state).toBe(true);
    }
  });

  it("replaces a top-level field and keeps the rest", () => {
    const manual = crewSnapshotFixture({ run: null });
    expect(manual.run).toBeNull();
    expect(manual.crewmates).toEqual(crewSnapshotFixture().crewmates);
  });
});

describe("CrewTint", () => {
  it("names exactly the Mate tints, so a crewmate's face draws from MATE_TINTS", () => {
    expect([...CrewTint.literals].sort()).toEqual(Object.keys(MATE_TINTS).sort());
  });
});
