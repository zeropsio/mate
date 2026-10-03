import type { MateLiveView } from "@t3tools/shared/hqMates";
import type { CrewDigest } from "@t3tools/shared/mateLink";
import { describe, expect, it } from "vite-plus/test";

import { mateCrewOf } from "./useCrew";

const DIGEST: CrewDigest = { crewmates: [], attention: [], readyTasks: [], personLands: true };

/** A Mate as HQ holds it: online and live, its crew as given. */
const mate = (patch: Partial<MateLiveView> = {}): MateLiveView =>
  ({
    presence: { online: true, since: "2026-10-03T10:00:00.000Z", overview: "live" },
    identity: { environmentId: "env-ada", serverVersion: "0.11.90", update: null },
    logins: {},
    crew: { status: "off" },
    ...patch,
  }) as MateLiveView;

describe("mateCrewOf — a Mate's crew as HQ holds it", () => {
  it.each([
    { case: "crew mode off", crew: { status: "off" as const }, status: "off", digest: null },
    {
      case: "crew mode on, no crew yet",
      crew: { status: "none" as const },
      status: "none",
      digest: null,
    },
    {
      case: "a crew applied",
      crew: { status: "applied" as const, ...DIGEST },
      status: "applied",
      digest: { status: "applied", ...DIGEST },
    },
  ])(
    "reads its crew's status with no socket to it, its digest once applied: $case",
    ({ crew, status, digest }) => {
      const read = mateCrewOf(mate({ crew }), true);
      expect([read.status, read.crew]).toEqual([status, digest]);
    },
  );

  it("knows nothing of the crew of a Mate HQ holds no overview of", () => {
    const old = { presence: { online: true, since: "2026-10-03T10:00:00.000Z", overview: "none" } };
    expect(mateCrewOf(old as MateLiveView, true)).toMatchObject({ status: null, crew: null });
    expect(mateCrewOf(undefined, true)).toMatchObject({ status: null, crew: null });
  });

  it.each([
    { case: "HQ's answer now, the Mate live", current: true, overview: "live", live: true },
    { case: "HQ's answer from before", current: false, overview: "live", live: false },
    { case: "the Mate asleep, its last overview", current: true, overview: "stored", live: false },
  ] as const)(
    "is current only while HQ answers now of a live Mate: $case",
    ({ current, overview, live }) => {
      const read = mateCrewOf(
        mate({ presence: { online: overview === "live", since: "x", overview } }),
        current,
      );
      expect(read.current).toBe(live);
    },
  );
});
