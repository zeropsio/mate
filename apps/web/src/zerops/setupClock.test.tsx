import { mateArrival } from "@t3tools/client-runtime/data";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  mateBornLine,
  mateBornLineText,
  pendingBornLine,
} from "../components/zerops/SidebarMateRow.logic";
import { formatWorkingTime } from "../components/zerops/SidebarZeropsTree.logic";
import { ZeropsBirthLine } from "../components/zerops/ZeropsBirthProgress";
import type { BirthLineProgress } from "../components/zerops/ZeropsBirthProgress.logic";
import { arrivalSteps, onSetupClock } from "./mateArrival";
import { placedPressesIn, pressComing, pressSince, type MatePress } from "./matePress";

const FIRST_PRESS = Date.parse("2026-10-15T10:00:00.000Z");
const MINUTE = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

const pressOf = (startedAt: number, pressedAt: number | undefined): MatePress => ({
  projectId: "p-alba",
  organizationId: "org",
  startedAt,
  ...(pressedAt === undefined ? {} : { pressedAt }),
  placement: { groupId: "g", groupName: "Recipe Box", kind: "mate", displayName: "Alba" },
  container: true,
  state: { kind: "pressing" },
});

// What the platform measured of it: its project made when the platform took the last press, its
// workspace started a moment after — each on its own clock, never the setup's.
const progressFrom = (acceptedAt: number): BirthLineProgress => {
  const steps = [
    {
      id: "project",
      label: "Project",
      state: "done",
      startedAt: iso(acceptedAt),
      endedAt: iso(acceptedAt + 5_000),
    },
    { id: "container", label: "Container", state: "active", startedAt: iso(acceptedAt + 6_000) },
    { id: "mate", label: "Mate", state: "waiting" },
  ] as const;
  return {
    steps,
    active: steps[1],
    failed: null,
    doneCount: 1,
    total: steps.length,
    complete: false,
    startedAt: iso(acceptedAt),
  };
};

// The owner, 2026-10-15: the menu row read "Coming up · 3:19" while the Mate's own page counted
// "0:00" — its row's clock counts from the first press (board D1, 2026-09-30), and so does every
// other time shown for its setup.
describe("one clock per Mate", () => {
  it.each([
    {
      case: "a New project tried again after a credit refusal",
      press: pressOf(FIRST_PRESS, undefined),
      acceptedAt: FIRST_PRESS + 3 * MINUTE + 19_000,
      nowMs: FIRST_PRESS + 3 * MINUTE + 51_000,
    },
    {
      case: "an Add pressed whole again",
      press: pressOf(FIRST_PRESS + 4 * MINUTE, FIRST_PRESS),
      acceptedAt: FIRST_PRESS + 4 * MINUTE,
      nowMs: FIRST_PRESS + 4 * MINUTE + 30_000,
    },
    {
      case: "an Add the platform took a moment after its press",
      press: pressOf(FIRST_PRESS + 3_000, FIRST_PRESS),
      acceptedAt: FIRST_PRESS + 3_000,
      nowMs: FIRST_PRESS + MINUTE + 12_000,
    },
    {
      case: "credit topped up an hour on",
      press: pressOf(FIRST_PRESS + 65 * MINUTE, FIRST_PRESS),
      acceptedAt: FIRST_PRESS + 65 * MINUTE,
      nowMs: FIRST_PRESS + 66 * MINUTE,
    },
  ])(
    "a Mate's setup shows one elapsed time wherever it is shown, counted from the first press: $case",
    ({ press, acceptedAt, nowMs }) => {
      const time = formatWorkingTime(nowMs - FIRST_PRESS);
      const coming = mateArrival({
        press: pressComing(press),
        candidate: undefined,
        created: true,
        nowMs,
      }).coming;
      const placed = placedPressesIn([press], "org")[0];
      const progress = onSetupClock(progressFrom(acceptedAt), pressSince(press));
      const shown = {
        listedRow: coming === undefined ? undefined : mateBornLineText(mateBornLine(coming), nowMs),
        pendingRow:
          placed === undefined
            ? undefined
            : mateBornLineText(pendingBornLine({ startedAt: placed.startedAt }), nowMs),
        page: arrivalSteps(progress, { name: "Alba", project: "Recipe Box" }, nowMs).find(
          (step) => step.state === "active",
        )?.time,
        card: renderToStaticMarkup(<ZeropsBirthLine nowMs={nowMs} progress={progress} />).includes(
          `>${time}<`,
        ),
      };
      expect(shown).toEqual({
        listedRow: `Coming up · ${time}`,
        pendingRow: `Coming up · ${time}`,
        page: time,
        card: true,
      });
    },
  );
});
