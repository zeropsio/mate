import { mateState } from "@t3tools/client-runtime/zerops/mateState";
import { expect, it } from "vite-plus/test";
import { createDialogReplies } from "../../zerops/useDialogState.ts";
import { moveAttemptFor } from "./mateActions/moveAttempt.ts";
import { crewMayTakeLine, mateRowSecond } from "./SidebarMateRow.logic.ts";
import { moveAwaitsPlacement, movePlacementOf } from "./ZeropsMoveToGroupDialog.logic.ts";
import { appRenameView, renameAttemptFor } from "./ZeropsRenameProjectDialog.logic.ts";
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

// witness: apps/web/src/components/zerops/SidebarMateRow.logic.ts | if (moveLine !== undefined && !moveEnded) return moveLine; → if (moveLine !== undefined) return moveLine;
it("MN+1: A move HQ still runs outranks its Mate's own line, and one that ended is said only at rest, a crew's need taking it; breaks: a colleague's old rename replaces \"needs your answer\" on the row and card indefinitely", () => {
  const line = (state: "idle" | "needs", kind: "going" | "renamed-since") => {
    const view = { state, reply: undefined, slot: { kind: "age" } } as const;
    const standing =
      kind === "going"
        ? ({ kind, id: "op-1", yours: true } as const)
        : ({ kind: "renamed-since" } as const);
    return mateRowSecond({
      view,
      askLine: { kind: "ask", text: "Fix the oven" },
      move: { standing, name: "Shop - web" },
      outsideHq: false,
      noContainer: false,
      mine: true,
      waitsOn: undefined,
      asks: true,
      change: undefined,
    });
  };
  expect(line("needs", "going").kind).toBe("moving");
  expect(line("needs", "renamed-since")).toEqual({ kind: "ask", pending: false });
  const atRest = line("idle", "renamed-since");
  expect(atRest.kind).toBe("moved");
  expect(
    crewMayTakeLine(atRest, {
      state: "idle",
      reply: undefined,
    } as Parameters<typeof crewMayTakeLine>[1]),
  ).toBe(true);
});

// witness: apps/web/src/components/zerops/ZeropsRenameProjectDialog.logic.ts | !project.result?.startsWith(REFUSED) → project.result?.startsWith(REFUSED)
it("MN+2: A failed application rename permits a different name only when its project results are known and none was refused; breaks: a finished rename blocks later names, or a refused project gets another prefix", () => {
  const nameOf = () => "Old - web";
  const renamesLeft = {
    step: "rename_projects",
    code: "renames_left",
    at: "2026-11-22T10:00:05Z",
    origin: "hq",
  };
  expect(appRenameView({ kind: "none" }, undefined, nameOf).mayRename).toBe(true);
  expect(appRenameView({ kind: "failed", failure: renamesLeft }, undefined, nameOf).mayRename).toBe(
    false,
  );
  const operation = {
    id: "failed-1",
    kind: "app_rename",
    phase: "failed",
    at: "2026-11-22T10:00:05Z",
    acceptedAt: "2026-11-22T10:00:00Z",
    projects: [
      { projectId: "p1", result: "renamed" },
      { projectId: "p2", result: "moved" },
      { projectId: "p3", result: "gone" },
      { projectId: "p4", result: "renamed_since" },
    ],
  };
  const failed = { kind: "failed", failure: renamesLeft } as const;
  const view = appRenameView(failed, operation, nameOf);
  expect(view.mayRename).toBe(true);
  expect(
    appRenameView(
      failed,
      { ...operation, projects: [{ projectId: "p1", result: "refused:conflict" }] },
      nameOf,
    ).mayRename,
  ).toBe(false);
});

// witness: apps/web/src/components/zerops/ZeropsRenameProjectDialog.logic.ts | held?.name === name && held.after === after → held?.name === name
it("MN+5: Rename again starts a new application operation after a failure but keeps its id after a lost answer; breaks: a retry replays the failed operation or duplicates an uncertain start", () => {
  const first = renameAttemptFor(null, "Shop", "failed-1", () => "retry-1");
  expect(renameAttemptFor(first, "Shop", "failed-1", () => "unused").id).toBe("retry-1");
  const next = renameAttemptFor(first, "Shop", "failed-2", () => "retry-2");
  expect(next.id).toBe("retry-2");
  expect(renameAttemptFor(next, "Garden", "failed-2", () => "rename-3").id).toBe("rename-3");
});

// witness: apps/web/src/zerops/useDialogState.ts | if (isCurrent()) action(); → action();
it("MN+6: A move refusal reads destinations again only while the dialog that sent it remains open; breaks: a late held-changed answer reopens Move or replaces another dialog", () => {
  let visible: string | null = null;
  let destinations: "unread" | "reading" = "unread";
  const replies = createDialogReplies<string>((next) => {
    visible = next;
  });
  replies.setDialog("move");
  const oldMove = replies.captureReply();
  replies.setDialog(null);
  oldMove.ifCurrent(() => {
    destinations = "reading";
    replies.setDialog("move");
  });
  expect({ visible, destinations }).toEqual({ visible: null, destinations: "unread" });
  replies.setDialog("rename");
  oldMove.ifCurrent(() => {
    destinations = "reading";
    replies.setDialog("move");
  });
  expect({ visible, destinations }).toEqual({ visible: "rename", destinations: "unread" });
  replies.setDialog("move");
  replies.captureReply().ifCurrent(() => {
    destinations = "reading";
    replies.setDialog("move:reading");
  });
  expect({ visible, destinations }).toEqual({ visible: "move:reading", destinations: "reading" });
});

// witness: apps/web/src/components/zerops/mateActions/moveAttempt.ts | return held?.body === body ? held : { body, id: newId() }; → return held ?? { body, id: newId() };
it("MN+3: A project's move sends its id again only for the same body, and any other body replaces it; breaks: a later move replays an old operation and reports success without moving anything", () => {
  const first = moveAttemptFor(undefined, "A to B", () => "id-1");
  expect(moveAttemptFor(first, "A to B", () => "id-2").id).toBe("id-1");
  const back = moveAttemptFor(first, "B to A", () => "id-2");
  expect(back.id).toBe("id-2");
  expect(moveAttemptFor(back, "A to B", () => "id-3").id).toBe("id-3");
});

// witness: apps/web/src/components/zerops/ZeropsMoveToGroupDialog.logic.ts | return now === undefined || (now.appId === refused.appId && now.kind === refused.kind); → return now === undefined;
it("MN+4: After HQ refuses a move because the placement changed, a press waits until navigation shows a different application or kind; breaks: every later press sends the old placement and HQ refuses it again, so the Move dialog can never succeed", () => {
  const refused = { appId: "app-a", kind: "stage" } as const;
  const cases = [
    ["no refusal", undefined, { appId: "app-a", kind: "stage" }, false],
    ["navigation still old", refused, { appId: "app-a", kind: "stage" }, true],
    ["placement unread", refused, movePlacementOf("app-a", "unknown"), true],
    ["another application", refused, { appId: "app-b", kind: "stage" }, false],
    ["another kind", refused, { appId: "app-a", kind: "devstage" }, false],
    ["out of its application", refused, movePlacementOf(undefined, "none"), false],
  ] as const;
  for (const [state, from, now, waits] of cases)
    expect({ state, waits: moveAwaitsPlacement(from, now) }).toEqual({ state, waits });
});

// witness: apps/web/src/components/zerops/SidebarMateRow.logic.ts | mateRestartLine(input.restart) ?? mateMoveLine → mateMoveLine
it("MN+7: A failed Mate's restart HQ runs reads restarting on its row and card on every device, over the Mate's own line, and one that failed is said only at rest; breaks: a second device shows the failed Mate as if nothing restarts it, or an old failed restart hides what the Mate asks", () => {
  const line = (state: "idle" | "needs", restart: Parameters<typeof mateRowSecond>[0]["restart"]) =>
    mateRowSecond({
      view: { state, reply: undefined, slot: { kind: "age" } },
      askLine: { kind: "ask", text: "Fix the oven" },
      restart,
      outsideHq: false,
      noContainer: false,
      mine: true,
      waitsOn: undefined,
      asks: true,
      change: undefined,
    }).kind;
  const failed = {
    kind: "failed",
    failure: {
      step: "start",
      code: "restart_failed",
      at: "2026-11-23T10:00:00Z",
      origin: "zerops_process",
    },
  } as const;
  const cases = [
    ["going, the Mate asks", "needs", { kind: "going" }, "restarting"],
    [
      "waiting on its maker",
      "needs",
      { kind: "waiting", id: "op-1", continueBy: "eva", yours: false },
      "restarting",
    ],
    ["failed, the Mate asks", "needs", failed, "ask"],
    ["failed, at rest", "idle", failed, "restart-failed"],
    ["none", "idle", { kind: "none" }, "ask"],
  ] as const;
  for (const [standing, state, restart, kind] of cases)
    expect({ standing, kind: line(state, restart) }).toEqual({ standing, kind });
});
