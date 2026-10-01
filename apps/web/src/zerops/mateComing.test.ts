import { describe, expect, it } from "vite-plus/test";

import {
  mateComing,
  mateComingHeadlineClauses,
  mateComingPage,
  mateOpeningPhrase,
  type MateComingInput,
} from "./mateComing";

const HELD = { step: "harden", overdue: false, container: true } as const;

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
      case: "a birth writing its group entries is coming up",
      input: { birth: { ...HELD, step: "tags" }, candidate: undefined },
      expected: { kind: "coming", line: "Coming up. A few minutes.", verb: undefined },
    },
    {
      case: "a birth being closed off is coming up, whatever the listing reads",
      input: { birth: HELD, candidate: { group: "ready" } },
      expected: { kind: "coming", line: "Coming up. A few minutes.", verb: undefined },
    },
    {
      case: "a birth whose Mate is being waited on is almost there",
      input: { birth: { ...HELD, step: "health" }, candidate: { group: "ready" } },
      expected: { kind: "coming", line: "Almost there.", verb: undefined },
    },
    {
      case: "a birth past its step's cap says so, and waits on the person's Keep waiting",
      input: { birth: { ...HELD, overdue: true }, candidate: { group: "provisioning" } },
      expected: { kind: "coming", line: "Taking longer than usual.", verb: "keep-waiting" },
    },
    {
      case: "a project on its way up with no birth held here is coming up",
      input: {
        birth: undefined,
        candidate: { group: "provisioning", service: { status: "CREATING" } },
      },
      expected: { kind: "coming", line: "Coming up. A few minutes.", verb: undefined },
    },
    {
      case: "a project the platform could not create says so, with Remove",
      input: {
        birth: undefined,
        candidate: { group: "unavailable", creationFailed: { message: "quota exceeded" } },
      },
      expected: { kind: "failed", line: "Could not be created. Quota exceeded.", verb: "remove" },
    },
    {
      case: "a creation refused while its birth still runs is refused",
      input: {
        birth: HELD,
        candidate: { group: "unavailable", creationFailed: { message: undefined } },
      },
      expected: { kind: "failed", line: "Could not be created.", verb: "remove" },
    },
    {
      case: "a creation that stopped after the platform took the project says why, with Remove",
      input: {
        birth: undefined,
        candidate: { group: "unavailable" },
        setUpFailed: "The agent container could not be imported",
      },
      expected: {
        kind: "failed",
        line: "Could not be set up. The agent container could not be imported.",
        verb: "remove",
      },
    },
  ])("$case", ({ input, expected }) => {
    expect(mateComing(input)).toEqual(expected);
  });

  it.each<{ readonly case: string; readonly input: MateComingInput }>([
    { case: "nothing is known of it", input: { birth: undefined, candidate: undefined } },
    {
      case: "connected: it is up, even a moment before its birth is let go",
      input: { birth: { ...HELD, step: "health" }, candidate: { group: "connected" } },
    },
    {
      case: "a birth with no container to bring up (a stage, an import that failed)",
      input: { birth: { ...HELD, container: false }, candidate: { group: "ready" } },
    },
    {
      case: "a Mate restarting is not a Mate being made",
      input: {
        birth: undefined,
        candidate: { group: "provisioning", service: { status: "RESTARTING" } },
      },
    },
    {
      case: "a Mate that is up and not connected yet",
      input: { birth: undefined, candidate: { group: "ready" } },
    },
    { case: "a stopped Mate", input: { birth: undefined, candidate: { group: "unavailable" } } },
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
  const COMING = { kind: "coming", line: "Coming up. A few minutes.", verb: undefined } as const;
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
      case: "a birth left behind in this browser, its environment registered: it hands over",
      input: { ...BASE, coming: COMING, linked: true },
      expected: { kind: "up" },
    },
    {
      case: "a birth left behind in this browser, its row connected: it hands over",
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
      phrase: { text: "Reconnecting…", actions: [] },
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
      phrase: { text: "This Mate isn't running.", actions: ["start"] },
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
