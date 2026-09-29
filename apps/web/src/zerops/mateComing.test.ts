import { describe, expect, it } from "vite-plus/test";

import {
  mateComing,
  mateComingHeadlineClauses,
  mateComingPage,
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
    readonly kind: "coming" | "failed";
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
  ])("$case", ({ mate, kind, clauses }) => {
    expect(mateComingHeadlineClauses(mate, kind)).toEqual(clauses);
  });
});

// A new Mate's own view (`/mate/$projectId`): it waits there for the Mate to be up, then hands
// over to its conversation. Anything it has nothing to wait for goes to the projects screen,
// which owns its verbs; a listing still being read is waited on.
describe("mateComingPage — what a Mate's own view shows", () => {
  const COMING = { kind: "coming", line: "Coming up. A few minutes.", verb: undefined } as const;
  it.each<{
    readonly case: string;
    readonly input: Parameters<typeof mateComingPage>[0];
    readonly expected: ReturnType<typeof mateComingPage>;
  }>([
    {
      case: "coming up: its progress",
      input: { coming: COMING, candidate: undefined, health: undefined, complete: false },
      expected: { kind: "coming", coming: COMING },
    },
    {
      case: "connected: it is up, and hands over",
      input: {
        coming: undefined,
        candidate: { group: "connected" },
        health: "ready",
        complete: true,
      },
      expected: { kind: "up" },
    },
    {
      case: "listed and answering, its socket not open yet: almost there",
      input: { coming: undefined, candidate: { group: "ready" }, health: "ready", complete: true },
      expected: {
        kind: "coming",
        coming: { kind: "coming", line: "Almost there.", verb: undefined },
      },
    },
    {
      case: "listed, its Mate still starting: almost there",
      input: {
        coming: undefined,
        candidate: { group: "ready" },
        health: "initializing",
        complete: true,
      },
      expected: {
        kind: "coming",
        coming: { kind: "coming", line: "Almost there.", verb: undefined },
      },
    },
    {
      case: "listed and not answering: the projects screen's Try again",
      input: {
        coming: undefined,
        candidate: { group: "ready" },
        health: "unreachable",
        complete: true,
      },
      expected: { kind: "elsewhere" },
    },
    {
      case: "stopped: the projects screen's Start",
      input: {
        coming: undefined,
        candidate: { group: "unavailable" },
        health: undefined,
        complete: true,
      },
      expected: { kind: "elsewhere" },
    },
    {
      case: "not on the account, the listing whole",
      input: { coming: undefined, candidate: undefined, health: undefined, complete: true },
      expected: { kind: "elsewhere" },
    },
    {
      case: "not listed yet, the listing still read",
      input: { coming: undefined, candidate: undefined, health: undefined, complete: false },
      expected: undefined,
    },
  ])("$case", ({ input, expected }) => {
    expect(mateComingPage(input)).toEqual(expected);
  });
});
