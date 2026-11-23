import { expect, it } from "vite-plus/test";
import type { SharedBirth } from "@t3tools/client-runtime/data";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { comingOfBirth, sharedBirthPresentation } from "../../zerops/sharedBirths.ts";
import {
  mateBornLine,
  mateComingRowView,
  mateDotLabel,
  mateRowView,
} from "./SidebarMateRow.logic.ts";
import { comingDeletionStage, comingHandOverDestination } from "./ZeropsMateComingPage.logic.ts";

// witness: apps/web/src/zerops/sharedBirths.ts | since: birth.startedAt, → since: undefined,
it("MN20: A Mate's coming line and clock are its HQ birth's from the press to the hello, on every device; breaks: two devices show different clocks or lines for one Mate coming", () => {
  const birth: SharedBirth = {
    id: "birth-1",
    appId: "shop",
    appName: "Shop",
    face: "slate:squircle",
    madeBy: "maker",
    projectId: "project-1",
    importProcessId: null,
    intent: undefined,
    // HQ accepted its operation at 2026-11-21T10:00:00Z.
    startedAt: Date.parse("2026-11-21T10:00:00Z"),
    progress: { phase: "import-accepted", next: { kind: "wait", for: "container" }, reason: null },
    state: "awaiting_link",
    offers: [],
  };
  // Every device reads this one birth from HQ: its row says the birth's own row line and counts
  // from HQ's acceptance, not from anything of its own.
  expect(comingOfBirth(birth)).toMatchObject({
    kind: "coming",
    line: sharedBirthPresentation(birth).row,
    since: Date.parse("2026-11-21T10:00:00Z"),
  });
});

// witness: apps/web/src/components/zerops/ZeropsMateComingPage.logic.ts | if (deletion.kind === "deleting") return { takesPage: true, action: null }; → if (deletion.kind === "deleting") return { takesPage: false, action: null };
it("MN40: A Mate's deletion takes its coming page while it runs, waits or failed, offering Continue only to the maker it waits for and Delete again after a failure only to a person HQ offers the record; breaks: the page of a Mate being deleted connects and hands over into a project that is going, or offers a press HQ refuses", () => {
  const failure = {
    step: "delete_project",
    code: "zerops_refused",
    at: "2026-11-23T10:00:00Z",
    origin: "zerops",
  };
  const waiting = { kind: "waiting", id: "op-1", continueBy: "ada", press: "Continue" } as const;
  const deletions = [
    undefined,
    { kind: "none" },
    { kind: "deleting" },
    { ...waiting, yours: true },
    { ...waiting, yours: false },
    { kind: "failed", failure },
  ] as const;
  const examples = deletions.flatMap((deletion) =>
    [true, false].map((remove) => ({ deletion, remove })),
  );
  expect(examples.map(({ deletion, remove }) => comingDeletionStage(deletion, remove))).toEqual([
    { takesPage: false, action: null },
    { takesPage: false, action: null },
    { takesPage: false, action: null },
    { takesPage: false, action: null },
    { takesPage: true, action: null },
    { takesPage: true, action: null },
    { takesPage: true, action: "continue-operation" },
    { takesPage: true, action: "continue-operation" },
    { takesPage: true, action: null },
    { takesPage: true, action: null },
    { takesPage: true, action: "delete" },
    { takesPage: true, action: null },
  ]);
});

// witness: apps/web/src/zerops/sharedBirths.ts | const stopped = birthStopped(birth.state); → const stopped = birthStopped(birth.state) || reason !== null;
it("MN41: A birth HQ stopped is its own card, and one HQ runs or finished never is, whatever Zerops shows of its container; breaks: a Mate whose container failed shows Delete alone and never its restart", () => {
  const birth: SharedBirth = {
    id: "birth-1",
    appId: "shop",
    appName: "Shop",
    face: "slate:squircle",
    madeBy: "maker",
    projectId: "project-1",
    importProcessId: null,
    intent: undefined,
    startedAt: Date.parse("2026-11-21T10:00:00Z"),
    progress: { phase: "import-accepted", next: { kind: "wait", for: "container" }, reason: null },
    state: "running",
    offers: [],
  };
  const troubled = {
    phase: "container-starting",
    next: { kind: "wait", for: "container" },
    reason: "Container failed.",
  } as const;
  // Each state with the offers HQ makes its maker in it (mate-hq spec/protocol.md, births).
  const states = [
    { state: "running", offers: [] },
    { state: "waiting_for_maker", offers: ["continue", "delete_project"] },
    { state: "failed", offers: ["delete_project"] },
    { state: "awaiting_link", offers: ["delete_project"] },
    { state: "awaiting_registration", offers: [] },
  ] as const;
  const examples = states.flatMap((held) =>
    [false, true].map((trouble) => ({
      ...birth,
      ...held,
      ...(trouble ? { progress: troubled } : {}),
    })),
  );
  expect(
    examples.map((example) => {
      const { stopped, attention, actions } = sharedBirthPresentation(example);
      return { stopped, attention, actions };
    }),
  ).toEqual([
    { stopped: false, attention: false, actions: [] },
    { stopped: false, attention: true, actions: [] },
    { stopped: true, attention: true, actions: ["continue-operation", "delete"] },
    { stopped: true, attention: true, actions: ["continue-operation", "delete"] },
    { stopped: true, attention: true, actions: ["delete"] },
    { stopped: true, attention: true, actions: ["delete"] },
    { stopped: false, attention: false, actions: ["delete"] },
    { stopped: false, attention: true, actions: ["delete"] },
    { stopped: false, attention: false, actions: [] },
    { stopped: false, attention: true, actions: [] },
  ]);
});

// witness: apps/web/src/components/zerops/ZeropsMateComingPage.logic.ts | to: "/$environmentId/$threadId" as const, → to: "/zerops" as const,
it("MN59: A coming Mate's page hands over to its own conversation's route in place of itself, never to the Overview; breaks: a Mate started from its page lands the person on the Overview", () => {
  const threadRef = {
    environmentId: EnvironmentId.make("env-rye"),
    threadId: ThreadId.make("thread-rye"),
  };
  expect(comingHandOverDestination(threadRef)).toEqual({
    to: "/$environmentId/$threadId",
    params: { environmentId: "env-rye", threadId: "thread-rye" },
    replace: true,
  });
});

// witness: apps/web/src/zerops/sharedBirths.ts | waitsOnMaker: waits && !continues, → waitsOnMaker: false,
it("MN+1: A birth HQ holds for its maker's Continue says it waits for its maker, not for you, to whoever HQ does not offer that Continue, and still waits for you to the maker it offers it to; breaks: an Owner or member is told a Mate waits for them when nothing they can press moves it", () => {
  const birth = (offers: SharedBirth["offers"]): SharedBirth => ({
    id: "birth-1",
    appId: "shop",
    appName: "Shop",
    face: "slate:squircle",
    madeBy: "maker",
    projectId: "project-1",
    importProcessId: null,
    intent: undefined,
    startedAt: Date.parse("2026-11-23T10:00:00Z"),
    progress: { phase: "import-accepted", next: { kind: "wait", for: "hq" }, reason: null },
    state: "waiting_for_maker",
    failure: { step: "import", code: "access_lost", at: "2026-11-23T10:01:00Z", origin: "hq" },
    offers,
  });
  const words = (offers: SharedBirth["offers"]) => {
    const coming = comingOfBirth(birth(offers));
    const { dot } = mateComingRowView(mateRowView(undefined, "idle"), coming);
    return dot === undefined ? mateBornLine(coming).words : mateDotLabel(dot);
  };
  expect([words(["delete_project"]), words([]), words(["continue", "delete_project"])]).toEqual([
    "Waiting for its maker",
    "Waiting for its maker",
    "Waiting for you",
  ]);
});
