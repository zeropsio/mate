import { EnvironmentId } from "@t3tools/contracts";
import type { ZeropsProject, ZeropsService } from "@t3tools/client-runtime/zerops";
import { ARRIVAL_MS, deriveZeropsCandidates } from "@t3tools/client-runtime/zerops/candidates";
import {
  CONTAINER_CAPS_MS,
  IDLE_GUARDS,
  candidatePresence,
  containerVerdict,
  initialContainer,
  transitionContainer,
  initialEnvironment,
  mateLink,
  reachabilityPhrase,
  selectReachability,
  transitionEnvironment,
  type EnvironmentEvent,
  type EnvironmentMachine,
} from "@t3tools/client-runtime/zerops/environments";
import { describe, expect, it } from "vite-plus/test";

import {
  arrivalAwaitsAnswer,
  arrivalLinkHolds,
  mateComing,
  mateComingHeadlineClauses,
  mateComingPage,
  mateConnectKey,
  mateOpeningPhrase,
  type MateComingInput,
  HALF_MADE_LINE,
  HALF_MADE_OWNER_LINE,
  AWAITING_HQ_LINE,
  CHECKING_SETUP_LINE,
  CLOSING_OFF_LINE,
  halfMadeFor,
  firstBuildState,
  listingLacksCreation,
  mateArrivalShown,
  type MateComingPage,
} from "./mateComing";
import type { MateLink, Reachability } from "@t3tools/client-runtime/zerops/environments";
import {
  NO_ADDRESS_MEMORY,
  addressFactsOf,
  rememberAddresses,
  type AddressMemory,
} from "@t3tools/client-runtime/zerops/projections";

const NOW = Date.parse("2026-10-01T20:00:00.000Z");
const HELD = { startedAt: 1_000, container: true, retryable: false } as const;

// A new Mate's first minutes, as its row, its own view and the projects page say them: in the
// projects page's words, and never "ready" before it is connected (the owner, 2026-09-29: "on the
// left it looks like its ready to be opened, but it's not").
describe("mateComing — a Mate in its first minutes, in one set of words", () => {
  it.each<{
    readonly case: string;
    readonly input: MateComingInput;
    readonly expected: ReturnType<typeof mateComing>;
  }>([
    {
      case: "a press under way is coming up, on its clock",
      input: { press: HELD, candidate: undefined },
      expected: { kind: "coming", line: "Coming up. A few minutes.", since: 1_000 },
    },
    {
      case: "a press is coming up whatever the listing reads",
      input: { press: HELD, candidate: { group: "ready" } },
      expected: { kind: "coming", line: "Coming up. A few minutes.", since: 1_000 },
    },
    {
      case: "a project on its way up with no press made here is coming up",
      input: {
        press: undefined,
        candidate: { group: "provisioning", service: { status: "CREATING" } },
      },
      expected: { kind: "coming", line: "Coming up. A few minutes." },
    },
    {
      case: "a project the platform could not create says so, with Remove",
      input: {
        press: undefined,
        candidate: { group: "unavailable", creationFailed: { message: "quota exceeded" } },
      },
      expected: { kind: "failed", line: "Could not be created. Quota exceeded.", verb: "remove" },
    },
    {
      case: "a creation refused while its press still holds it is refused",
      input: {
        press: HELD,
        candidate: { group: "unavailable", creationFailed: { message: undefined } },
      },
      expected: { kind: "failed", line: "Could not be created.", verb: "remove" },
    },
    {
      case: "a press that stopped after the platform took the project says why, with Remove",
      input: {
        press: undefined,
        candidate: { group: "unavailable" },
        setUpFailed: "The agent container could not be imported",
      },
      expected: {
        kind: "failed",
        line: "Could not be set up. The agent container could not be imported.",
        verb: "remove",
      },
    },
    {
      case: "a press that stopped at a step safe to ask again offers Try again",
      input: {
        press: { ...HELD, retryable: true },
        candidate: { group: "ready" },
        setUpFailed: "Zerops did not answer",
      },
      expected: {
        kind: "failed",
        line: "Could not be set up. Zerops did not answer.",
        verb: "try-again",
      },
    },
    {
      case: "a Mate whose press elsewhere stopped before its container: half-made, with Finish setup",
      input: {
        press: undefined,
        candidate: { group: "unavailable", missingContainer: true },
        pressElsewhere: "stopped",
        nowMs: NOW,
      },
      expected: { kind: "failed", line: HALF_MADE_LINE, verb: "finish-setup" },
    },
    // The close-off gate (restores 0.12.3's closeOffGate): a Mate held because HQ says its project
    // is not closed off is closing off until HQ says it is — never failed on a clock (2026-10-05).
    // Finish setup stays in its menu (`finishMateSetupVerb`).
    ...[30_000, 3 * 60_000, 3 * 60 * 60_000].map((age) => ({
      case: `a Mate held for its close-off, its container ${age / 60_000} min old: closing off`,
      input: {
        press: undefined,
        candidate: {
          group: "ready" as const,
          service: { status: "ACTIVE", created: new Date(NOW - age).toISOString() },
        },
        closeOffHold: "open" as const,
        nowMs: NOW,
      },
      expected: { kind: "coming" as const, line: CLOSING_OFF_LINE },
    })),
    // Security review 4: every hold says why — never a Mate silently not opening.
    {
      case: "a Mate held while its container's marker is read",
      input: {
        press: undefined,
        candidate: { group: "ready", service: { status: "ACTIVE" } },
        closeOffHold: "checking",
        nowMs: NOW,
      },
      expected: { kind: "coming", line: CHECKING_SETUP_LINE },
    },
    {
      case: "a Mate held until HQ confirms its setup finished",
      input: {
        press: undefined,
        candidate: { group: "ready", service: { status: "ACTIVE" } },
        closeOffHold: "awaiting-hq",
        nowMs: NOW,
      },
      expected: { kind: "coming", line: AWAITING_HQ_LINE },
    },
    {
      case: "a Mate this tab made, its press over, before the listing holds it",
      input: { press: undefined, candidate: undefined, created: true },
      expected: { kind: "coming", line: "Coming up. A few minutes." },
    },
    {
      case: "a Mate this tab made, up and its link on its way",
      input: { press: undefined, candidate: { group: "ready" }, created: true, linkHolds: true },
      expected: { kind: "coming", line: "Coming up. A few minutes." },
    },
    {
      case: "a Mate in its first build, minutes young",
      input: {
        press: undefined,
        candidate: {
          group: "provisioning",
          service: { status: "READY_TO_DEPLOY", created: new Date(NOW - 60_000).toISOString() },
        },
        nowMs: NOW,
      },
      expected: { kind: "coming", line: "Coming up. A few minutes." },
    },
    {
      case: "a Mate whose first build failed: it never came, with Remove",
      input: {
        press: undefined,
        candidate: {
          group: "provisioning",
          service: { status: "READY_TO_DEPLOY", created: new Date(NOW - 60_000).toISOString() },
        },
        created: true,
        firstBuild: { kind: "failed", why: "the build failed" },
        nowMs: NOW,
      },
      expected: {
        kind: "failed",
        line: "Could not be set up. The build failed.",
        verb: "remove",
      },
    },
    {
      case: "a Mate this tab made whose container went before it came: half-made, with Finish setup",
      input: {
        press: undefined,
        candidate: { group: "unavailable", missingContainer: true },
        pressElsewhere: "stopped",
        created: true,
        nowMs: NOW,
      },
      expected: { kind: "failed", line: HALF_MADE_LINE, verb: "finish-setup" },
    },
    {
      case: "a Mate this tab made, in its first build",
      input: {
        press: undefined,
        candidate: { group: "provisioning", service: { status: "READY_TO_DEPLOY" } },
        created: true,
      },
      expected: { kind: "coming", line: "Coming up. A few minutes." },
    },
    // Past its grace a first build is still on its way: slow or queued looks the same from its
    // status as failed, and only its build's process tells — never a restart, never removed.
    ...[true, undefined].map((created) => ({
      case: `a first build past its grace, nothing known of it${created === true ? ", made here" : ""}`,
      input: {
        press: undefined,
        candidate: {
          group: "provisioning" as const,
          service: {
            status: "READY_TO_DEPLOY",
            created: new Date(NOW - 20 * 60_000).toISOString(),
          },
        },
        created,
        nowMs: NOW,
      },
      expected: { kind: "coming" as const, line: "Taking longer than usual." },
    })),
    {
      case: "a first build past its grace, its build still queued or running: taking longer too",
      input: {
        press: undefined,
        candidate: {
          group: "provisioning",
          service: {
            status: "READY_TO_DEPLOY",
            created: new Date(NOW - 20 * 60_000).toISOString(),
          },
        },
        firstBuild: { kind: "running" },
        nowMs: NOW,
      },
      expected: { kind: "coming", line: "Taking longer than usual." },
    },
    // A clock is no answer: half an hour on, with nothing read of its build, it is taking longer.
    ...[true, undefined].map((created) => ({
      case: `a first build half an hour on, nothing known of it${created === true ? ", made here" : ""}`,
      input: {
        press: undefined,
        candidate: {
          group: "provisioning" as const,
          service: {
            status: "READY_TO_DEPLOY",
            created: new Date(NOW - 40 * 60_000).toISOString(),
          },
        },
        created,
        nowMs: NOW,
      },
      expected: { kind: "coming" as const, line: "Taking longer than usual." },
    })),
    {
      case: "a first build half an hour on, its build still running: on its way",
      input: {
        press: undefined,
        candidate: {
          group: "provisioning",
          service: {
            status: "READY_TO_DEPLOY",
            created: new Date(NOW - 40 * 60_000).toISOString(),
          },
        },
        firstBuild: { kind: "running" },
        nowMs: NOW,
      },
      expected: { kind: "coming", line: "Taking longer than usual." },
    },
    // B5: a slow press in another browser holds it at HQ, however old its project: never half made.
    {
      case: "a Mate with no container, its press elsewhere held at HQ an hour on: still coming up",
      input: {
        press: undefined,
        candidate: { group: "unavailable", missingContainer: true },
        pressElsewhere: "pressing",
        nowMs: NOW + 60 * 60_000,
      },
      expected: { kind: "coming", line: "Coming up. A few minutes." },
    },
  ])("$case", ({ input, expected }) => {
    expect(mateComing(input)).toEqual(expected);
  });

  it.each<{ readonly case: string; readonly input: MateComingInput }>([
    { case: "nothing is known of it", input: { press: undefined, candidate: undefined } },
    {
      case: "connected: it is up, whatever this tab pressed",
      input: { press: HELD, candidate: { group: "connected" } },
    },
    {
      case: "a press with no container to bring up (a stage, a production)",
      input: { press: { ...HELD, container: false }, candidate: { group: "ready" } },
    },
    {
      case: "a Mate restarting is not a Mate being made",
      input: {
        press: undefined,
        candidate: { group: "provisioning", service: { status: "RESTARTING" } },
      },
    },
    {
      case: "a Mate that is up and not connected yet",
      input: { press: undefined, candidate: { group: "ready" } },
    },
    { case: "a stopped Mate", input: { press: undefined, candidate: { group: "unavailable" } } },
    {
      case: "a Mate this tab made, up, its link wanting someone (a restart, a cap passed)",
      input: { press: undefined, candidate: { group: "ready" }, created: true, linkHolds: false },
    },
    {
      case: "a Mate this tab made, up, nothing known of its link",
      input: { press: undefined, candidate: { group: "ready" }, created: true },
    },
    {
      case: "a Mate this tab made that a whole listing, read well after, lacks",
      input: { press: undefined, candidate: undefined, created: true, listingLacksIt: true },
    },
    {
      case: "a Mate with no container while HQ has said nothing of its presses: neither is said",
      input: {
        press: undefined,
        candidate: { group: "unavailable", missingContainer: true },
        pressElsewhere: "unknown",
      },
    },
    {
      case: "a Mate this tab made whose project is gone",
      input: { press: undefined, candidate: undefined, created: true, linkHolds: false },
    },
    {
      case: "a Mate this tab made, connected",
      input: { press: undefined, candidate: { group: "connected" }, created: true },
    },
    {
      case: "a Mate this tab made whose container stopped",
      input: {
        press: undefined,
        candidate: { group: "unavailable", service: { status: "STOPPED" } },
        created: true,
      },
    },
    // A press this tab made does not make a container that failed, stopped or is restarting read
    // as coming up: it shows its own state (pass 28 review).
    ...(["ACTION_FAILED", "STOPPED", "RESTARTING", "UPGRADING"] as const).map((status) => ({
      case: `a container ${status} under this tab's press`,
      input: {
        press: HELD,
        candidate: { group: "unavailable" as const, service: { status } },
      },
    })),
  ])("says nothing for $case", ({ input }) => {
    expect(mateComing(input)).toBeUndefined();
  });
});

describe("mateComingHeadlineClauses — its own view's words", () => {
  const QUINN = { name: "Quinn", project: "Acme Docs" };
  it.each<{
    readonly case: string;
    readonly mate: { readonly name: string; readonly project: string | undefined };
    readonly kind: "coming" | "failed" | "reaching" | "unreachable";
    readonly clauses: ReadonlyArray<string>;
  }>([
    {
      case: "coming up on its project",
      mate: QUINN,
      kind: "coming",
      clauses: ["Quinn is coming up on Acme Docs."],
    },
    {
      case: "coming up with no project named",
      mate: { name: "Quinn", project: undefined },
      kind: "coming",
      clauses: ["Quinn is coming up."],
    },
    {
      case: "not added",
      mate: QUINN,
      kind: "failed",
      clauses: ["Quinn could not be added to Acme\u00a0Docs."],
    },
    {
      case: "not added, with no project named",
      mate: { name: "Quinn", project: undefined },
      kind: "failed",
      clauses: ["Quinn could not be added."],
    },
    {
      case: "a two-word name kept whole",
      mate: { name: "Ada Lin", project: "Acme Docs" },
      kind: "coming",
      clauses: ["Ada Lin is coming up on Acme Docs."],
    },
    {
      case: "on its way to its conversation: its name, the line under it says the rest",
      mate: QUINN,
      kind: "reaching",
      clauses: ["Quinn"],
    },
    {
      case: "not to be opened: its name kept whole, the line under it says why",
      mate: { name: "Ada Lin", project: "Acme Docs" },
      kind: "unreachable",
      clauses: ["Ada Lin"],
    },
  ])("$case", ({ mate, kind, clauses }) => {
    expect(mateComingHeadlineClauses(mate, kind)).toEqual(clauses);
  });
});

// A Mate's own view (`/mate/$projectId`): where every door opens a Mate whose conversation cannot
// be opened yet. A new Mate comes up there; any other waits there for its link, saying what it
// waits for as its machine says it, then hands over to its conversation. It never hands the
// person to another screen on its own (the owner, 2026-09-30: "it just throws me at /zerops
// page"): a Mate that cannot be opened says why where it stands.
describe("mateComingPage — what a Mate's own view shows", () => {
  const COMING = { kind: "coming", line: "Coming up. A few minutes." } as const;
  const RECONNECTING = { kind: "reconnecting" } as const;
  const GONE = { kind: "gone", because: "complete-scope-omits-verified" } as const;
  const STOPPED = {
    kind: "container",
    container: { level: "inactive", status: "STOPPED" },
  } as const;
  const RETRYING = {
    kind: "retrying",
    retryAtMs: 5_000,
    last: { kind: "network" },
    restart: false,
  } as const;
  const BASE = {
    coming: undefined,
    candidate: { group: "ready" },
    complete: true,
    linked: false,
    reachability: null,
  } as const;
  it.each<{
    readonly case: string;
    readonly input: Parameters<typeof mateComingPage>[0];
    readonly expected: ReturnType<typeof mateComingPage>;
  }>([
    {
      case: "coming up: its progress",
      input: { ...BASE, coming: COMING, candidate: undefined, complete: false },
      expected: { kind: "coming", coming: COMING },
    },
    {
      case: "connected: it is up, and hands over",
      input: { ...BASE, candidate: { group: "connected" } },
      expected: { kind: "up" },
    },
    {
      case: "its environment registered, its socket reconnecting: it hands over",
      input: { ...BASE, linked: true, reachability: RECONNECTING },
      expected: { kind: "up" },
    },
    {
      case: "a press this tab still holds, its environment registered: it hands over",
      input: { ...BASE, coming: COMING, linked: true },
      expected: { kind: "up" },
    },
    {
      case: "a press this tab still holds, its row connected: it hands over",
      input: { ...BASE, coming: COMING, candidate: { group: "connected" } },
      expected: { kind: "up" },
    },
    {
      case: "listed and answering, its socket not open yet: what its machine waits for",
      input: { ...BASE, reachability: { kind: "connecting", waitingOn: "exchange" } },
      expected: { kind: "reaching", reachability: { kind: "connecting", waitingOn: "exchange" } },
    },
    {
      case: "listed and not answering: its machine's retry, never the projects screen",
      input: { ...BASE, reachability: RETRYING },
      expected: { kind: "reaching", reachability: RETRYING },
    },
    {
      case: "stopped: says so, with its Start, where it stands",
      input: { ...BASE, candidate: { group: "unavailable" }, reachability: STOPPED },
      expected: { kind: "reaching", reachability: STOPPED },
    },
    {
      case: "its row standing for its project, no machine named yet: looked for",
      input: { ...BASE, candidate: { group: "unavailable" } },
      expected: { kind: "reaching", reachability: null },
    },
    {
      case: "found gone: says why, never leaves on its own",
      input: { ...BASE, reachability: GONE },
      expected: { kind: "unreachable", reachability: GONE },
    },
    {
      case: "not on the account, the listing whole",
      input: { ...BASE, candidate: undefined },
      expected: { kind: "unreachable", reachability: null },
    },
    {
      case: "not listed yet, the listing still read, its machine reconnecting: what it waits for",
      input: { ...BASE, candidate: undefined, complete: false, reachability: RECONNECTING },
      expected: { kind: "reaching", reachability: RECONNECTING },
    },
    {
      case: "not listed yet, the listing still read, nothing known of it",
      input: { ...BASE, candidate: undefined, complete: false },
      expected: undefined,
    },
  ])("$case", ({ input, expected }) => {
    expect(mateComingPage(input)).toEqual(expected);
  });
});

// The line under a Mate's name in its own view: the route gate's words for the same verdict (§4.8,
// R5), so its own view and its conversation say one thing — what its link waits for while it is on
// its way, and why when it cannot be opened, each with its verbs.
describe("mateOpeningPhrase — what a Mate's own view says under its name", () => {
  const CONTEXT = { nowMs: 1_000, mateName: "Quinn" };
  it.each<{
    readonly case: string;
    readonly page: Parameters<typeof mateOpeningPhrase>[0];
    readonly phrase: ReturnType<typeof mateOpeningPhrase>;
  }>([
    {
      case: "reconnecting",
      page: { kind: "reaching", reachability: { kind: "reconnecting" } },
      phrase: { text: "Reconnecting…", actions: ["try-now"] },
    },
    {
      case: "nothing known of it yet",
      page: { kind: "reaching", reachability: null },
      phrase: { text: "Opening this conversation…", actions: [] },
    },
    {
      case: "its machine ready, with nothing to say",
      page: { kind: "reaching", reachability: { kind: "ready", notice: null } },
      phrase: { text: "Opening this conversation…", actions: [] },
    },
    {
      case: "not answering: its retry and Try now",
      page: {
        kind: "reaching",
        reachability: {
          kind: "retrying",
          retryAtMs: 6_000,
          last: { kind: "network" },
          restart: false,
        },
      },
      phrase: { text: "This Mate isn't answering. Trying again in 5 s.", actions: ["try-now"] },
    },
    {
      case: "stopped: its Start",
      page: {
        kind: "reaching",
        reachability: { kind: "container", container: { level: "inactive", status: "STOPPED" } },
      },
      phrase: { text: "This Mate isn't running.", actions: ["try-now", "start"] },
    },
    {
      case: "gone: why, and the projects",
      page: { kind: "unreachable", reachability: { kind: "gone", because: "direct-not-found" } },
      phrase: {
        text: "This project is no longer available. It was deleted, or you no longer have access.",
        actions: ["go-to-projects"],
      },
    },
    {
      case: "not on the account",
      page: { kind: "unreachable", reachability: null },
      phrase: {
        text: "This conversation isn't in your Zerops projects.",
        actions: ["go-to-projects"],
      },
    },
  ])("$case", ({ page, phrase }) => {
    expect(mateOpeningPhrase(page, CONTEXT)).toEqual(phrase);
  });
});

// What a Mate's own view connects: always a target its machine holds, so a connect that fails is
// the machine's to try again on its ladder — never an origin a listing not caught up yet turns
// away once, with nothing asking again while the view stays (a live run, 2026-10-01).
describe("mateConnectKey — what a Mate's own view connects", () => {
  it.each([
    {
      case: "its machine named, reaching: that machine's target",
      input: {
        reachingKey: "p:zcp-a",
        answering: false,
        candidateKey: "p:zcp-b",
      },
      expected: "p:zcp-a",
    },
    {
      case: "answering: its listed row's target",
      input: {
        reachingKey: undefined,
        answering: true,
        candidateKey: "p:zcp",
      },
      expected: "p:zcp",
    },
    {
      case: "not answering yet: nothing",
      input: {
        reachingKey: undefined,
        answering: false,
        candidateKey: "p:zcp",
      },
      expected: null,
    },
  ])("$case", ({ input, expected }) => {
    expect(mateConnectKey(input)).toBe(expected);
  });
});

// The view never says Finish setup completes it without a button the viewer can use (pass 28
// review): a viewer who may not finish it reads who can.
describe("halfMadeFor — a half-made Mate as its viewer may act on it", () => {
  const HALF = { kind: "failed", line: HALF_MADE_LINE, verb: "finish-setup" } as const;
  it.each([
    { case: "a viewer who may finish it", canFinish: true, want: HALF_MADE_LINE },
    { case: "a viewer who may not", canFinish: false, want: HALF_MADE_OWNER_LINE },
  ])("$case", ({ canFinish, want }) => {
    expect(halfMadeFor(HALF, canFinish)).toMatchObject({ line: want });
  });

  it("leaves any other state alone", () => {
    const coming = { kind: "coming", line: "Coming up" } as const;
    expect(halfMadeFor(coming, false)).toBe(coming);
  });
});

// The arrival is one surface from the press to the sign-in: once a Mate's own view has shown it
// coming up, a wait on its way to its conversation keeps the board — never "Almost there." under
// its name alone with a composer, and back (measured 2026-10-02: 10 s of it on a New project,
// 0.6 s on an Add).
describe("mateArrivalShown — what a Mate's own view keeps saying once it came up", () => {
  const OPENING = { kind: "coming", line: "Almost there." } as const;
  const COMING = { kind: "coming", line: "Coming up. A few minutes." } as const;
  const reaching = (reachability: Reachability | null): MateComingPage => ({
    kind: "reaching",
    reachability,
  });
  const container = (level: string, overdue = false): Reachability =>
    ({ kind: "container", container: { level, overdue } }) as Reachability;
  it.each<{
    readonly case: string;
    readonly page: MateComingPage | undefined;
    readonly cameUp: boolean;
    readonly failuresSinceConnect?: number;
    readonly expected: ReturnType<typeof mateArrivalShown>;
  }>([
    {
      case: "coming up: its words",
      page: { kind: "coming", coming: COMING },
      cameUp: false,
      expected: COMING,
    },
    {
      case: "up, having come up here: opening",
      page: { kind: "up" },
      cameUp: true,
      expected: OPENING,
    },
    {
      case: "up, never shown coming: nothing",
      page: { kind: "up" },
      cameUp: false,
      expected: undefined,
    },
    {
      case: "reaching, never shown coming: its link's words",
      page: reaching(null),
      cameUp: false,
      expected: undefined,
    },
    { case: "reaching, no machine yet", page: reaching(null), cameUp: true, expected: OPENING },
    {
      case: "reaching, its container booting",
      page: reaching(container("booting")),
      cameUp: true,
      expected: OPENING,
    },
    {
      case: "reaching, its container provisioning",
      page: reaching(container("provisioning")),
      cameUp: true,
      expected: OPENING,
    },
    {
      case: "reaching, its container restarting",
      page: reaching({
        kind: "container",
        container: { level: "restarting", by: "platform", overdue: false },
      }),
      cameUp: true,
      expected: OPENING,
    },
    {
      case: "reaching, connecting",
      page: reaching({ kind: "connecting", waitingOn: "exchange" }),
      cameUp: true,
      expected: OPENING,
    },
    {
      case: "reaching, reconnecting",
      page: reaching({ kind: "reconnecting" }),
      cameUp: true,
      expected: OPENING,
    },
    {
      case: "reaching, resolving",
      page: reaching({ kind: "resolving" }),
      cameUp: true,
      expected: OPENING,
    },
    {
      case: "reaching, ready",
      page: reaching({ kind: "ready", notice: null }),
      cameUp: true,
      expected: OPENING,
    },
    {
      case: "reaching, waiting for Zerops",
      page: reaching({ kind: "waiting-for-zerops" }),
      cameUp: true,
      expected: OPENING,
    },
    {
      case: "reaching, retrying on its own",
      page: reaching({
        kind: "retrying",
        retryAtMs: NOW,
        last: { kind: "network" },
        restart: false,
      } as Reachability),
      cameUp: true,
      expected: OPENING,
    },
    // Failing since it last connected: past its first three failures (the ladder's 2, 4 and 8 s),
    // no wait of its link holds the board — its retries and the attempts between them alike, so
    // the two never take turns.
    ...(
      [
        { kind: "retrying", retryAtMs: NOW, last: { kind: "network" }, restart: false },
        { kind: "connecting", waitingOn: "exchange" },
        { kind: "reconnecting" },
      ] as ReadonlyArray<Reachability>
    ).map((reachability) => ({
      case: `reaching, ${reachability.kind} after its fourth failure since it connected`,
      page: reaching(reachability),
      cameUp: true,
      failuresSinceConnect: 4,
      expected: undefined,
    })),
    {
      case: "reaching, connecting again after its third failure (a fresh server warming up)",
      page: reaching({ kind: "connecting", waitingOn: "exchange" }),
      cameUp: true,
      failuresSinceConnect: 3,
      expected: OPENING,
    },
    // Waiting on its access or its presence is a wait on Zerops, never its link not answering.
    ...(["access", "presence"] as const).map((waitingOn) => ({
      case: `reaching, connecting on its ${waitingOn} however often its link failed`,
      page: reaching({ kind: "connecting", waitingOn }),
      cameUp: true,
      failuresSinceConnect: 6,
      expected: OPENING,
    })),
    {
      case: "reaching, its container booting whatever its link failed",
      page: reaching({ kind: "container", container: { level: "booting", overdue: false } }),
      cameUp: true,
      failuresSinceConnect: 3,
      expected: OPENING,
    },
    {
      case: "reaching, retrying with a restart to offer",
      page: reaching({
        kind: "retrying",
        retryAtMs: NOW,
        last: { kind: "identity-failed" },
        restart: true,
      } as Reachability),
      cameUp: true,
      expected: undefined,
    },
    {
      case: "reaching, booting past its cap",
      page: reaching(container("booting", true)),
      cameUp: true,
      expected: undefined,
    },
    {
      case: "reaching, its container stopped",
      page: reaching({ kind: "container", container: { level: "inactive", status: "STOPPED" } }),
      cameUp: true,
      expected: undefined,
    },
    {
      case: "reaching, no public address",
      page: reaching({ kind: "no-address", reason: "subdomain-off" }),
      cameUp: true,
      expected: undefined,
    },
    {
      case: "reaching, an update required",
      page: reaching({ kind: "update-required", actual: "0.1.0", minimum: "0.2.0" }),
      cameUp: true,
      expected: undefined,
    },
    {
      case: "not to be opened",
      page: { kind: "unreachable", reachability: null },
      cameUp: true,
      expected: undefined,
    },
    { case: "nothing known yet", page: undefined, cameUp: true, expected: undefined },
  ])("$case", ({ page, cameUp, failuresSinceConnect = 0, expected }) => {
    expect(mateArrivalShown({ page, cameUp, failuresSinceConnect })).toEqual(expected);
  });

  // Live, 2026-10-05: a new Mate's arrival keeps its board while zcp's init runs, and through its
  // Mate not answering yet once the init is complete — until a boot's cap, when its words and
  // Try now speak instead.
  it("a new Mate keeps its board through its init and its Mate's first silence, until the cap", () => {
    const KEY = "project-wren:zcp";
    let nowMs = 1_000;
    const at = () => ({ wall: nowMs, mono: nowMs });
    let container = transitionContainer(
      initialContainer(),
      { type: "PLATFORM", status: { project: "ACTIVE", service: "ACTIVE" } },
      { now: at() },
    ).state;
    let environment: EnvironmentMachine = transitionEnvironment(
      initialEnvironment({ record: null }),
      { type: "PRESENCE", presence: { kind: "present", origin: "https://zcp-wren.example.test" } },
      { now: at(), random: () => 0.5 },
    ).state;
    const shown = () => {
      environment = transitionEnvironment(
        environment,
        { type: "CONTAINER", container: containerVerdict(container) },
        { now: at(), random: () => 0.5 },
      ).state;
      const link = mateLink({
        key: KEY,
        projectId: "project-wren",
        machines: new Map([[KEY, environment]]),
        index: { serving: new Map(), reported: new Map() },
        registered: new Set(),
      });
      return {
        reachability: link.reachability,
        arrival: mateArrivalShown({
          page: { kind: "reaching", reachability: link.reachability },
          cameUp: true,
          failuresSinceConnect: link.failuresSinceConnect,
        }),
      };
    };
    const probe = (
      reading: Parameters<typeof transitionContainer>[1] extends infer E
        ? E extends { readonly type: "PROBED"; readonly reading: infer R }
          ? R
          : never
        : never,
    ) => {
      nowMs += 1_000;
      container = transitionContainer(
        container,
        { type: "PROBED", reading, sentAt: at() },
        { now: at() },
      ).state;
    };

    // zcp's init still running: a boot on its way.
    probe({ kind: "initializing", initAt: null });
    expect(shown().reachability).toEqual({
      kind: "container",
      container: { level: "booting", overdue: false },
    });
    expect(shown().arrival).toEqual(OPENING);

    // Its init complete, its Mate not answering yet: not a start, and the board still stands.
    probe({ kind: "not-answering", initAt: "2026-10-05T01:00:00Z" });
    expect(shown().reachability).toEqual({ kind: "not-answering", overdue: false });
    expect(shown().arrival).toEqual(OPENING);

    // Past a boot's cap: its words, with Try now.
    nowMs += CONTAINER_CAPS_MS.booting;
    container = transitionContainer(container, { type: "TICK" }, { now: at() }).state;
    expect(shown().reachability).toEqual({ kind: "not-answering", overdue: true });
    expect(shown().arrival).toBeUndefined();
  });

  // The lead, 2026-10-05: a new Mate whose container is ready and whose exchanges keep failing is
  // healed on its own, and says so with Try now once its held failures are spent — in the window
  // that made it too, never "Almost there." for good.
  it("a new Mate whose container is ready and whose exchanges keep failing says so, with Try now", () => {
    const KEY = "project-wren:zcp";
    const GO = {
      ...IDLE_GUARDS,
      want: true,
      routeTarget: true,
      visible: true,
      postGrant: true,
      identityMint: { allowed: true },
      budget: true,
    } as const;
    let nowMs = 1_000;
    const step = (machine: EnvironmentMachine, event: EnvironmentEvent): EnvironmentMachine => {
      nowMs = event.type === "TICK" && machine.timer !== null ? machine.timer.wall : nowMs + 1_000;
      return transitionEnvironment(machine, event, {
        now: { wall: nowMs, mono: nowMs },
        random: () => 0.5,
      }).state;
    };
    let machine: EnvironmentMachine = initialEnvironment({ record: null });
    for (const event of [
      { type: "GUARDS", guards: GO },
      { type: "CONTAINER", container: { level: "ready" } },
      { type: "PRESENCE", presence: { kind: "present", origin: "https://zcp-wren.example.test" } },
    ] satisfies ReadonlyArray<EnvironmentEvent>) {
      machine = step(machine, event);
    }
    const linkOf = (current: EnvironmentMachine) =>
      mateLink({
        key: KEY,
        projectId: "project-wren",
        machines: new Map([[KEY, current]]),
        index: { serving: new Map(), reported: new Map() },
        registered: new Set(),
      });
    const holds: Array<boolean> = [];
    for (let failure = 1; failure <= 6; failure += 1) {
      if (machine.credential.kind !== "exchanging") throw new Error("no exchange");
      machine = step(machine, {
        type: "EXCHANGE_FAILED",
        attempt: machine.credential.attempt,
        failure: { class: "retryable", cause: { kind: "network" } },
        descriptor: null,
      });
      holds.push(arrivalLinkHolds(linkOf(machine)));
      // Still retried on its own: the next try is on the ladder.
      expect(machine.credential.kind).toBe("backoff");
      if (failure < 6) machine = step(machine, { type: "TICK" });
    }
    // The board through its first three failures, then its words: never "Almost there." for good.
    expect(holds).toEqual([true, true, true, false, false, false]);

    const link = linkOf(machine);
    const page = { kind: "reaching", reachability: link.reachability } as const;
    expect(
      mateArrivalShown({ page, cameUp: true, failuresSinceConnect: link.failuresSinceConnect }),
    ).toBeUndefined();
    const phrase = mateOpeningPhrase(page, { nowMs, mateName: "Wren" });
    expect(phrase.text).toMatch(/^This Mate isn't answering\. Trying again in \d+ s\.$/u);
    expect(phrase.actions).toEqual(["try-now"]);
  });
});

// A first build that failed leaves the Mate's service READY_TO_DEPLOY for good (the ledger,
// 2026-09: a failed buildFromGit): its newest build for that service says so.
describe("firstBuildState — a Mate's first build, as its project's processes say it", () => {
  const build = (status: string, created: string, extra: object = {}) => ({
    actionName: "stack.build",
    serviceStackIds: ["zcp", "buildzcp"],
    status,
    created,
    ...extra,
  });
  it.each<{
    readonly case: string;
    readonly processes: ReadonlyArray<ReturnType<typeof build>> | undefined;
    readonly expected: ReturnType<typeof firstBuildState>;
  }>([
    { case: "nothing read", processes: undefined, expected: undefined },
    {
      case: "building",
      processes: [build("RUNNING", "2026-10-02T10:00:00Z")],
      expected: { kind: "running" },
    },
    {
      case: "queued",
      processes: [build("PENDING", "2026-10-02T10:00:00Z")],
      expected: { kind: "running" },
    },
    {
      case: "built",
      processes: [build("FINISHED", "2026-10-02T10:00:00Z")],
      expected: undefined,
    },
    {
      case: "failed, with the platform's reason",
      processes: [build("FAILED", "2026-10-02T10:00:00Z", { failReason: "npm ci failed" })],
      expected: { kind: "failed", why: "npm ci failed" },
    },
    {
      case: "failed, with no reason",
      processes: [build("CANCELED", "2026-10-02T10:00:00Z")],
      expected: { kind: "failed", why: "Its container's first build did not finish" },
    },
    {
      case: "failed, then built again: the newest counts",
      processes: [
        build("FAILED", "2026-10-02T10:00:00Z"),
        build("RUNNING", "2026-10-02T10:05:00Z"),
      ],
      expected: { kind: "running" },
    },
    // Review (web #5): a deploy that fails after its build — an init command, its runtime's
    // prepare — leaves the build's process FINISHED and its version failed: the version's status is
    // the platform's word, and ends the wait with Remove.
    {
      case: "built, its version's deploy failed",
      processes: [
        build("FINISHED", "2026-10-02T10:00:00Z", { appVersion: { status: "DEPLOY_FAILED" } }),
      ],
      expected: { kind: "failed", why: "Its container's first deploy failed: DEPLOY_FAILED" },
    },
    {
      case: "its version's runtime prepare failed, with the platform's reason",
      processes: [
        build("FINISHED", "2026-10-02T10:00:00Z", {
          failReason: "init command failed",
          appVersion: { status: "PREPARING_RUNTIME_FAILED" },
        }),
      ],
      expected: { kind: "failed", why: "init command failed" },
    },
    {
      case: "built, its version still deploying",
      processes: [
        build("FINISHED", "2026-10-02T10:00:00Z", { appVersion: { status: "DEPLOYING" } }),
      ],
      expected: undefined,
    },
    {
      case: "another service's build failed",
      processes: [{ ...build("FAILED", "2026-10-02T10:00:00Z"), serviceStackIds: ["appdev"] }],
      expected: undefined,
    },
  ])("$case", ({ processes, expected }) => {
    expect(firstBuildState(processes, "zcp")).toEqual(expected);
  });
});

// A Mate this tab made whose project went before it ever connected: a whole listing read well
// after the creation that lacks it means it is gone, never coming up for good — one read before
// the platform's listing could hold it says nothing.
describe("listingLacksCreation — a whole listing that no longer holds this tab's creation", () => {
  const MADE = 1_000_000;
  it.each([
    { case: "listed", listed: true, complete: true, listedAtMs: MADE + 120_000, lacks: false },
    {
      case: "a partial listing",
      listed: false,
      complete: false,
      listedAtMs: MADE + 120_000,
      lacks: false,
    },
    {
      case: "a whole listing read moments after",
      listed: false,
      complete: true,
      listedAtMs: MADE + 5_000,
      lacks: false,
    },
    {
      case: "a whole listing read well after",
      listed: false,
      complete: true,
      listedAtMs: MADE + 120_000,
      lacks: true,
    },
    {
      case: "no creation time",
      listed: false,
      complete: true,
      listedAtMs: MADE + 120_000,
      madeAtMs: undefined,
      lacks: false,
    },
  ])("$case: $lacks", ({ listed, complete, listedAtMs, lacks, ...rest }) => {
    const madeAtMs = "madeAtMs" in rest ? rest.madeAtMs : MADE;
    expect(listingLacksCreation({ listed, complete, listedAtMs, madeAtMs })).toBe(lacks);
  });
});

// Live run 3 (2026-10-02), replayed: the platform makes a Mate's container ACTIVE a moment before
// it enables its address, and the tab held ACTIVE without an address for 5.6 s. Its row and its
// own view said "no public address" and an asleep face in that gap, then took it back. Each step
// here is a listing derivation, the target's presence and the machine's verdict, as this browser
// draws them.
describe("a new Mate whose container is ACTIVE before its address landed", () => {
  const CREATED_AT = "2026-10-02T12:00:00.000Z";
  const CREATED = Date.parse(CREATED_AT);
  const ENV = EnvironmentId.make("environment-new");
  const PROJECT: ZeropsProject = {
    id: "project-new",
    name: "Acme Docs",
    status: "ACTIVE",
    clientId: "org-1",
    publicZone: "fte2334ab.prg1-zerops.zone",
    zeropsSubdomainHost: "9f1c",
  };
  const zcp = (status: string, subdomainAccess: boolean): ZeropsService => ({
    id: "service-new",
    name: "zcp",
    status,
    subdomainAccess,
    ports: [{ port: 8080, httpSupport: true }],
    serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
    created: CREATED_AT,
  });
  const ORIGIN = "https://zcp-9f1c-8080.prg1.zerops.app";

  /**
   * How each tab reads it at `atMs` since its creation, where the platform says `enable` of turning
   * its address on, and watched it come up where `watched`.
   */
  const reading = (input: {
    readonly atMs: number;
    readonly service: ZeropsService;
    readonly enable?: "on" | "off";
    readonly watched?: boolean;
    readonly connected?: boolean;
    readonly created: boolean;
  }) => {
    const nowMs = CREATED + input.atMs;
    const candidate = deriveZeropsCandidates(
      PROJECT,
      [input.service],
      new Map(input.connected === true ? [[ORIGIN, ENV]] : []),
      undefined,
      {
        nowMs,
        addressSeen: () =>
          input.watched === true ? { addressed: false, building: true } : undefined,
        subdomainEnable: () => input.enable,
      },
    )[0]!;
    const presence = candidatePresence({ ...candidate, presence: "known" });
    const reachability = selectReachability(
      { ...initialEnvironment({ record: null }), presence },
      null,
    );
    const linkHolds = arrivalLinkHolds({ reachability, failuresSinceConnect: 0 });
    const coming = mateComing({
      press: undefined,
      candidate,
      nowMs,
      created: input.created,
      ...(input.created ? { linkHolds } : {}),
    });
    const page = mateComingPage({
      coming,
      candidate,
      complete: true,
      linked: false,
      reachability,
    });
    return {
      reachability,
      coming,
      arrival: mateArrivalShown({ page, cameUp: true, failuresSinceConnect: 0 }),
    };
  };

  const STEPS: ReadonlyArray<{
    readonly step: string;
    readonly atMs: number;
    readonly service: ZeropsService;
    readonly enable?: "on" | "off";
    readonly watched?: boolean;
  }> = [
    { step: "its first build", atMs: 60_000, service: zcp("READY_TO_DEPLOY", false) },
    {
      step: "ACTIVE, its processes not read yet",
      atMs: 109_700,
      service: zcp("ACTIVE", false),
      watched: true,
    },
    {
      step: "ACTIVE, its address being turned on",
      atMs: 113_000,
      service: zcp("ACTIVE", false),
      enable: "on",
    },
    { step: "its address landed", atMs: 115_300, service: zcp("ACTIVE", true), watched: true },
  ];

  describe.each([
    { viewer: "the tab that made it", created: true },
    { viewer: "another tab", created: false },
  ])("in $viewer", ({ created }) => {
    it.each(STEPS.filter((step) => step.service.subdomainAccess === false))(
      "$step: coming up, never without an address nor asleep",
      (step) => {
        const read = reading({ ...step, created });
        expect(read.reachability.kind).not.toBe("no-address");
        // Its row draws a coming Mate (`mateComingRowView`); asleep is a row with nothing coming.
        expect(read.coming?.kind).toBe("coming");
        expect(read.arrival?.kind).toBe("coming");
      },
    );

    it("its address landed: its view holds the board until it connects, then hands over", () => {
      const landed = reading({ ...STEPS[3]!, created });
      expect(landed.reachability.kind).not.toBe("no-address");
      expect(landed.arrival?.kind).toBe("coming");

      const connected = reading({ ...STEPS[3]!, atMs: 127_000, connected: true, created });
      expect(connected.coming).toBeUndefined();
    });
  });

  it("an old Mate whose access is off says it has no public address, with Open in Zerops", () => {
    const read = reading({
      atMs: 3 * 60 * 60_000,
      service: zcp("ACTIVE", false),
      enable: "off",
      created: false,
    });
    expect(read.coming).toBeUndefined();
    expect(read.reachability).toEqual({ kind: "no-address", reason: "no-subdomain" });
    expect(reachabilityPhrase(read.reachability, { nowMs: 0, mateName: "Quinn" })).toEqual({
      text: "This Mate has no public address.",
      actions: ["open-in-zerops"],
    });
  });

  it("a Mate whose address the platform did not turn on says so, watched or not", () => {
    const read = reading({
      atMs: 113_000,
      service: zcp("ACTIVE", false),
      enable: "off",
      watched: true,
      created: false,
    });
    expect(read.coming).toBeUndefined();
    expect(read.reachability.kind).toBe("no-address");
  });
});

// Run 4 (2026-10-02), replayed in the window that did not make the Mate: its container turned
// ACTIVE, its address landed seconds later, and its server answered about 15 s after ACTIVE. In that
// gap the row read asleep — "Nobody has signed in yet" under an asleep face — and took it back when
// the Mate answered. Each step is a listing derivation over the memory the listing keeps, then the
// link this window's machine reads.
describe("a Mate whose address landed, not answering yet, in a window that did not make it", () => {
  const CREATED_AT = "2026-10-02T12:00:00.000Z";
  const CREATED = Date.parse(CREATED_AT);
  const ENV = EnvironmentId.make("environment-larch");
  const PROJECT: ZeropsProject = {
    id: "project-larch",
    name: "Larch",
    status: "ACTIVE",
    clientId: "org-1",
    publicZone: "fte2334ab.prg1-zerops.zone",
    zeropsSubdomainHost: "1",
  };
  const ORIGIN = "https://zcp-1-8080.prg1.zerops.app";
  const zcp = (status: string, subdomainAccess: boolean): ZeropsService => ({
    id: "service-larch",
    name: "zcp",
    status,
    subdomainAccess,
    ports: [{ port: 8080, httpSupport: true }],
    serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
    created: CREATED_AT,
  });
  const BOOTING: Reachability = {
    kind: "container",
    container: { level: "booting", overdue: false },
  };
  const NOT_ANSWERING: Reachability = {
    kind: "retrying",
    retryAtMs: CREATED + 160_000,
    last: { kind: "descriptor-unreachable" },
    restart: false,
  };
  const link = (reachability: Reachability | null, answered = false, failures = 0, errors = 0) =>
    ({
      key: "project-larch:service-larch",
      environmentId: undefined,
      reachability,
      failuresSinceConnect: failures,
      errorsSinceConnect: errors,
      answered,
    }) satisfies MateLink;

  const KEY = "project-larch:service-larch";
  /** Its link as this window's machine reads it, after `events` from a machine that saw it present. */
  const machineLink = (events: ReadonlyArray<EnvironmentEvent>): MateLink => {
    let machine: EnvironmentMachine = initialEnvironment({ record: null });
    for (const [index, event] of [
      { type: "PRESENCE", presence: { kind: "present", origin: ORIGIN } } as const,
      ...events,
    ].entries()) {
      const at = CREATED + 160_000 + index * 1_000;
      machine = transitionEnvironment(machine, event, {
        now: { wall: at, mono: at },
        random: () => 0.5,
      }).state;
    }
    return mateLink({
      key: KEY,
      projectId: "project-larch",
      machines: new Map([[KEY, machine]]),
      index: { serving: new Map(), reported: new Map() },
      registered: new Set(),
    });
  };
  const READY = { type: "CONTAINER", container: { level: "ready" } } as const;
  const WANTED = { type: "GUARDS", guards: { ...IDLE_GUARDS, want: true } } as const;

  const STEPS: ReadonlyArray<{
    readonly step: string;
    readonly atMs: number;
    readonly service: ZeropsService;
    readonly link: MateLink;
    readonly connected?: true;
    readonly coming: boolean;
  }> = [
    {
      step: "its first build",
      atMs: 60_000,
      service: zcp("READY_TO_DEPLOY", false),
      link: link(null),
      coming: true,
    },
    {
      step: "ACTIVE, its address not enabled yet",
      atMs: 152_000,
      service: zcp("ACTIVE", false),
      link: link(BOOTING),
      coming: true,
    },
    {
      step: "its address landed, its Mate not answering",
      atMs: 157_600,
      service: zcp("ACTIVE", true),
      link: link(BOOTING),
      coming: true,
    },
    {
      step: "its probes failing past an arrival's held failures",
      atMs: 166_800,
      service: zcp("ACTIVE", true),
      link: link(NOT_ANSWERING, false, 5),
      coming: true,
    },
    {
      step: "its probe found it ready, its lease making its link",
      atMs: 166_900,
      service: zcp("ACTIVE", true),
      link: machineLink([WANTED, READY]),
      coming: true,
    },
    {
      step: "its Mate answered and its link connected",
      atMs: 167_000,
      service: zcp("ACTIVE", true),
      link: link({ kind: "ready", notice: null }, true),
      connected: true,
      coming: false,
    },
  ];

  /** The steps in order, the listing's memory carried from each to the next. */
  const replay = (steps: typeof STEPS, created = false) => {
    let memory: AddressMemory = NO_ADDRESS_MEMORY;
    return steps.map((step) => {
      const nowMs = CREATED + step.atMs;
      const candidate = deriveZeropsCandidates(
        PROJECT,
        [step.service],
        new Map(step.connected === true ? [[ORIGIN, ENV]] : []),
        undefined,
        addressFactsOf(memory, nowMs),
      )[0]!;
      memory = rememberAddresses(memory, [candidate]);
      return mateComing({
        press: undefined,
        candidate,
        nowMs,
        ...(created ? { created, linkHolds: arrivalLinkHolds(step.link) } : {}),
        answerAwaited: arrivalAwaitsAnswer(step.link),
      });
    });
  };

  it("reads coming up at every step until its Mate answers, never asleep in between", () => {
    expect(replay(STEPS).map((coming) => coming?.kind ?? "up")).toEqual(
      STEPS.map((step) => (step.coming ? "coming" : "up")),
    );
  });

  it("says it in the words a Mate coming up says everywhere", () => {
    expect(replay(STEPS)[3]).toEqual({ kind: "coming", line: "Coming up. A few minutes." });
  });

  it("past its two minutes, a Mate that never answered reads as any other", () => {
    const late = replay([...STEPS.slice(0, 3), { ...STEPS[3]!, atMs: 157_600 + ARRIVAL_MS }]);
    expect(late[3]).toBeUndefined();
  });

  it.each<{ readonly case: string; readonly link: MateLink }>([
    {
      case: "it answered once and its link dropped",
      link: link({ kind: "reconnecting" }, true),
    },
    { case: "it is gone", link: link({ kind: "gone", because: "direct-not-found" }) },
    {
      case: "its link asks for a restart",
      link: link({ ...NOT_ANSWERING, restart: true } as Reachability),
    },
    {
      case: "its container stopped",
      link: link({
        kind: "container",
        container: { level: "inactive", status: "STOPPED" },
      } as Reachability),
    },
  ])("within its two minutes, not coming up when $case", ({ link: now }) => {
    expect(replay([...STEPS.slice(0, 3), { ...STEPS[3]!, link: now }])[3]).toBeUndefined();
  });

  it("watched in its first build, its address landing with ACTIVE in one read: still coming up", () => {
    // An org socket's recovery re-read, or one push carrying both: no read between them.
    const read = replay([STEPS[0]!, { ...STEPS[2]!, atMs: 152_000 }, ...STEPS.slice(3)]);
    expect(read.map((coming) => coming?.kind ?? "up")).toEqual([
      "coming",
      "coming",
      "coming",
      "coming",
      "up",
    ]);
  });

  // Review, pass 34: a server that answers with an error is not one still starting — an arrival
  // holds through its first failures only, as the making window's does, and then its words speak.
  it.each([
    {
      case: "a 5xx, its first failure",
      reachability: { ...NOT_ANSWERING, last: { kind: "server", status: 502 } },
      failures: 1,
      errors: 1,
      coming: true,
    },
    {
      case: "a 5xx past an arrival's held failures",
      reachability: { ...NOT_ANSWERING, last: { kind: "server", status: 502 } },
      failures: 5,
      errors: 5,
      coming: false,
    },
    {
      case: "its fresh credentials refused past them",
      reachability: { kind: "refused-credential" },
      failures: 4,
      errors: 4,
      coming: false,
    },
    {
      case: "an attempt between errors its server answered, past them",
      reachability: { kind: "connecting", waitingOn: "exchange" },
      failures: 5,
      errors: 5,
      coming: false,
    },
    {
      case: "no answer at all, past them",
      reachability: { ...NOT_ANSWERING, last: { kind: "timeout" } },
      failures: 5,
      errors: 0,
      coming: true,
    },
  ] as const)("inside its two minutes, $case: coming up $coming", (row) => {
    const { reachability, failures, errors, coming } = row;
    const errored = link(reachability as Reachability, false, failures, errors);
    const [, , , read] = replay([...STEPS.slice(0, 3), { ...STEPS[3]!, link: errored }]);
    expect(read?.kind === "coming").toBe(coming);
  });

  it("in the window that made it, past an arrival's held failures, its link's words speak", () => {
    // Pass 31: "This Mate isn't answering" with Try now — never "Coming up" over it.
    const [, , , read] = replay(STEPS.slice(0, 4), true);
    expect(read).toBeUndefined();
  });

  // Review, pass 34: a Mate no lease holds sits waiting for an exchange nobody asks for. Its probe
  // found it up: it is not coming up, and its row offers what it offers (Finish setup) at once.
  it("its probe found it up, no lease linking it: no longer coming up", () => {
    const unlinked = machineLink([READY]);
    expect(unlinked.reachability?.kind).toBe("connecting");
    const [, , , read] = replay([...STEPS.slice(0, 3), { ...STEPS[3]!, link: unlinked }]);
    expect(read).toBeUndefined();
  });

  // Review, pass 34: a ready Mate silent past its grace is booting again by guess; it answered,
  // and never reads as coming up again — nor hides its Finish setup behind it.
  it("found up, then silent and booting again, nothing wanting its link: still not coming up", () => {
    const silent = machineLink([
      READY,
      { type: "CONTAINER", container: { level: "booting", overdue: false } },
    ]);
    expect(silent.reachability?.kind).toBe("container");
    const [, , , read] = replay([...STEPS.slice(0, 3), { ...STEPS[3]!, link: silent }]);
    expect(read).toBeUndefined();
  });

  it("an old Mate that stops answering still reads as asleep, never coming up", () => {
    // A reload — or an old Mate: first seen with its address, nothing watched it come.
    const [read] = replay([{ ...STEPS[3]!, atMs: 3 * 60 * 60_000 }]);
    expect(read).toBeUndefined();
    const [reloaded] = replay([STEPS[3]!]);
    expect(reloaded).toBeUndefined();
  });
});
