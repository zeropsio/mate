import { mateState } from "@t3tools/client-runtime/zerops/mateState";
import { expect, it } from "vite-plus/test";
import { mateRowSecond } from "./SidebarMateRow.logic.ts";
import {
  deriveZeropsRowAction,
  deriveZeropsRowPresentation,
  mateCardHoldsMenu,
  mateHasNoContainer,
  mateLineHoldsVerb,
  type ZeropsRowCandidate,
  type ZeropsRowInput,
} from "./ZeropsProjectRow.logic.ts";
import { cardSecondWords } from "./projects/projectCard.logic.ts";

const every: ZeropsRowInput["can"] = {
  open: true,
  enable: true,
  setUpMate: true,
  start: true,
  restart: true,
  remove: true,
};

const running: ZeropsRowCandidate = {
  key: "Z_RYE:mate",
  project: { id: "Z_RYE", name: "bakery-rye", status: "ACTIVE", tagList: [] },
  group: "connected",
  service: { id: "S_MATE", name: "mate", status: "ACTIVE" },
  containerOrigin: "https://mate-1-8080.prg1.zerops.app",
};
const failedBirth: ZeropsRowCandidate = {
  ...running,
  group: "unavailable",
  creationFailed: { message: undefined },
};

const row = (
  candidate: ZeropsRowCandidate,
  can: ZeropsRowInput["can"],
  visibility: ZeropsRowInput["visibility"],
): ZeropsRowInput => ({ candidate, health: "ready", can, visibility });

// witness: apps/web/src/components/zerops/ZeropsProjectRow.logic.ts | if (input.visibility === "listed") return { kind: "none" }; → if (input.visibility === "hidden") return { kind: "none" };
it("MN10: A Mate the person may see but not open offers no verb, not even a restart, and no row offers a verb its caller cannot perform", () => {
  expect(deriveZeropsRowAction(row(running, every, "open")).kind).toBe("open");
  expect(deriveZeropsRowAction(row(running, every, "listed")).kind).toBe("none");
  // Its menu and its page: the same Mate, seen but not opened, offers no restart either.
  const { verbs } = mateState({
    candidate: running,
    level: { level: "ready", overdue: false },
    arrival: "none",
    pressed: false,
    deletionGoing: false,
    placementKnown: false,
    viewer: { role: "READ_ONLY", visibility: "listed", offers: undefined, handsOver: false },
  });
  expect(verbs).toMatchObject({ start: false, restart: false, redeploy: false });

  expect(deriveZeropsRowAction(row(running, { ...every, open: false }, "open")).kind).toBe("none");
  expect(deriveZeropsRowAction(row(failedBirth, { ...every, remove: false }, "open")).kind).toBe(
    "none",
  );
});

// witness: apps/web/src/components/zerops/ZeropsProjectRow.logic.ts | return coming?.kind === "coming"; → return coming?.kind === "failed";
it("MN13: A coming Mate's card on its project's page holds its menu, where Delete is, and any other Mate's card its one verb; breaks: a Mate whose setup stalls offers no Delete on its project's page (live check, 2026-11-20)", () => {
  expect(mateCardHoldsMenu({ kind: "coming", line: "Coming up" })).toBe(true);
  expect(
    mateCardHoldsMenu({ kind: "coming", line: "Coming up", birth: { attention: false } }),
  ).toBe(true);
  expect(mateCardHoldsMenu({ kind: "failed", line: "It did not come", verb: "remove" })).toBe(
    false,
  );
  expect(mateCardHoldsMenu(undefined)).toBe(false);
});

// witness: apps/web/src/components/zerops/ZeropsProjectRow.logic.ts | if (awaitsEnable(input)) return enable; →
it("MN21: A Mate whose container has Zerops Mate off offers Enable on its line, connected or with activity, to a viewer who may enable it; breaks: its card says it is not enabled and offers no Enable (whole check, 2026-11-22)", () => {
  const mateOff = (candidate: ZeropsRowCandidate): ZeropsRowInput => ({
    candidate,
    health: "predates-mate",
    mateFlag: false,
    can: every,
    visibility: "open",
  });
  const connected = deriveZeropsRowAction(mateOff(running));
  expect(connected.kind).toBe("enable");
  expect(mateLineHoldsVerb(connected)).toBe(true);
  expect(deriveZeropsRowAction(mateOff({ ...running, group: "ready" })).kind).toBe("enable");

  expect(deriveZeropsRowAction({ ...mateOff(running), mateFlag: true }).kind).toBe("open");
  expect(
    deriveZeropsRowAction({ ...mateOff(running), can: { ...every, enable: false } }).kind,
  ).toBe("none");
  expect(deriveZeropsRowAction({ ...mateOff(running), visibility: "listed" }).kind).toBe("none");
});

// witness: apps/web/src/components/zerops/SidebarMateRow.logic.ts | if (input.noContainer) return { kind: "no-container" }; → if (input.noContainer && input.deleting) return { kind: "no-container" };
it("MN22: A Mate whose project holds no container says so on its menu row in the words its card says, over anything asked of it before; breaks: its menu row reads Nothing asked yet beside a card that says it has no container (whole check, 2026-11-22)", () => {
  const containerless: ZeropsRowCandidate = {
    key: "Z_RYE",
    project: running.project,
    group: "unavailable",
    missingContainer: true,
    presence: "known",
  };
  for (const askLine of [
    { kind: "nothing-asked" },
    { kind: "ask", text: "Fix the oven" },
  ] as const) {
    const second = mateRowSecond({
      view: { state: "idle", reply: undefined, slot: { kind: "age" } },
      askLine,
      outsideHq: false,
      noContainer: mateHasNoContainer(containerless),
      mine: true,
      waitsOn: undefined,
      change: undefined,
    });
    expect(second.kind).toBe("no-container");
    expect(
      cardSecondWords({ second, reply: undefined, askLine, pausedUntil: (at) => at }).text,
    ).toBe(deriveZeropsRowPresentation(row(containerless, every, "open")).detail);
  }
  // Services not read yet are no missing container.
  expect(mateHasNoContainer({ group: "unavailable" })).toBe(false);
});
