import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { CrewDigest, MateThreadKind, OverviewLogins } from "@t3tools/shared/mateLink";
import { describe, expect, it } from "vite-plus/test";

import { crewRowFacts, type CrewRowRead } from "./SidebarCrewMinis.logic";

const ENVIRONMENT = EnvironmentId.make("env-minis");

/** Ada leads; Bo, Cy, Dee, Eve, Fay and Gus follow, in the crew's order. */
const NAMES = ["Ada", "Bo", "Cy", "Dee", "Eve", "Fay", "Gus"] as const;
const TINTS = ["violet", "sky", "coral", "rose", "olive", "amber", "sand"] as const;

/**
 * A crew of `size` as its Mate's overview carries it to HQ: each crewmate's chat in the kind
 * `kinds` says (by name), idle otherwise; `waiting` the names the crew's waiting list holds; the
 * tasks of `ready` (by owner's name) waiting for a Land, the person landing unless `leadLands`.
 */
function digest(
  input: {
    readonly size?: number;
    readonly kinds?: Readonly<Record<string, MateThreadKind | null>>;
    readonly waiting?: ReadonlyArray<string>;
    readonly ready?: ReadonlyArray<string>;
    readonly leadLands?: boolean;
  } = {},
): CrewDigest {
  const names = NAMES.slice(0, input.size ?? 4);
  return {
    crewmates: names.map((name, index) => ({
      handle: name.toLowerCase(),
      displayName: name,
      tint: TINTS[index]!,
      lead: index === 0,
      threadId: ThreadId.make(`thread-${name.toLowerCase()}`),
      threadKind: input.kinds?.[name] === undefined ? "idle" : input.kinds[name]!,
      loginKey: "claude-code",
    })),
    attention: (input.waiting ?? []).map((name) => ({
      id: `question:${name}`,
      kind: "question",
      handle: name.toLowerCase(),
    })),
    readyTasks: (input.ready ?? []).map((name) => ({
      id: `task-${name.toLowerCase()}`,
      owner: name.toLowerCase(),
    })),
    personLands: input.leadLands !== true,
  };
}

/** Every crewmate on Claude Code's login, the viewer's (Ada's account, "ada"). */
const MINE: OverviewLogins = { "claude-code": { signedInBy: "ada", present: true, token: false } };

function facts(
  crew: CrewDigest | null,
  input: Partial<Omit<CrewRowRead, "crew">> & { readonly mine?: boolean } = {},
) {
  return crewRowFacts({
    crew,
    logins: MINE,
    current: true,
    environmentId: ENVIRONMENT,
    viewerSubject: "ada",
    mine: true,
    ...input,
  });
}

const shown = (crew: CrewDigest, input: Parameters<typeof facts>[1] = {}) =>
  facts(crew, input)?.minis.map((mini) => `${mini.name}:${mini.state}`);

describe("crewRowFacts — the crew as mini faces after its Mate's name", () => {
  it.each([
    { case: "no crew", crew: null },
    { case: "a crew with nobody on it", crew: { ...digest(), crewmates: [] } },
  ])("draws nothing without a crew: $case", ({ crew }) => {
    expect(facts(crew)).toBeUndefined();
  });

  it.each([
    {
      case: "a crew at rest, in the crew's order, the lead first",
      crew: digest(),
      minis: ["Ada:idle", "Bo:idle", "Cy:idle", "Dee:idle"],
      more: 0,
    },
    {
      case: "the one who needs the viewer leads, then the lead",
      crew: digest({ kinds: { Cy: "input", Bo: "working" } }),
      minis: ["Cy:needs", "Ada:idle", "Bo:working", "Dee:idle"],
      more: 0,
    },
    {
      case: "two who need the viewer, in the crew's order, before the lead",
      crew: digest({ kinds: { Dee: "approval" }, waiting: ["Bo"] }),
      minis: ["Bo:needs", "Dee:needs", "Ada:idle", "Cy:idle"],
      more: 0,
    },
    {
      case: "five are all drawn whole",
      crew: digest({ size: 5 }),
      minis: ["Ada:idle", "Bo:idle", "Cy:idle", "Dee:idle", "Eve:idle"],
      more: 0,
    },
    {
      case: "six or more: four whole and the rest as +N",
      crew: digest({ size: 7, kinds: { Gus: "planReady", Fay: "working" } }),
      minis: ["Gus:needs", "Ada:idle", "Bo:idle", "Cy:idle"],
      more: 3,
    },
  ])("shows its crewmates whole in order: $case", ({ crew, minis, more }) => {
    expect(shown(crew)).toEqual(minis);
    expect(facts(crew)?.more).toBe(more);
  });

  it("draws each crewmate in its own tint and shape, with what it is doing", () => {
    const minis = facts(digest({ kinds: { Bo: "working", Cy: "input" } }))?.minis;
    expect(minis?.find((mini) => mini.name === "Cy")).toEqual({
      id: "cy",
      name: "Cy",
      lead: false,
      tint: "coral",
      shape: "pentagon",
      state: "needs",
      doing: "Asks you something",
    });
    expect(minis?.find((mini) => mini.name === "Bo")?.doing).toBe("Working");
    expect(minis?.find((mini) => mini.name === "Ada")).toMatchObject({
      lead: true,
      doing: undefined,
    });
  });

  it("draws a tint this build does not know as the first one", () => {
    const crew = digest({ size: 1 });
    const strange = { ...crew, crewmates: [{ ...crew.crewmates[0]!, tint: "ultraviolet" }] };
    expect(facts(strange)?.minis[0]).toMatchObject({ tint: "coral", shape: "pentagon" });
  });

  it("says the whole crew in words, the folded ones too", () => {
    expect(facts(digest({ size: 6, kinds: { Bo: "working", Fay: "input" } }))?.words).toBe(
      "Crew: Ada, Bo working, Cy, Dee, Eve, Fay needs you",
    );
  });

  it.each([
    { case: "nothing waits on the viewer", crew: digest(), need: undefined },
    {
      case: "a crewmate's chat asks",
      crew: digest({ kinds: { Bo: "input" } }),
      need: { kind: "ask", crewmate: "Bo", words: "Bo needs you" },
    },
    {
      case: "the waiting list names two crewmates",
      crew: digest({ waiting: ["Cy", "Dee"] }),
      need: { kind: "ask", crewmate: "Cy", words: "Cy and Dee need you" },
    },
    {
      case: "a task waits for the viewer's Land",
      crew: digest({ ready: ["Cy"] }),
      need: { kind: "land", crewmate: "Cy", words: "Cy's work is ready" },
    },
    {
      case: "two tasks wait for the viewer's Land",
      crew: digest({ ready: ["Dee", "Bo"] }),
      need: { kind: "land", crewmate: "Dee", words: "2 pieces of work are ready" },
    },
    {
      case: "a task is ready and a crewmate asks: the ask",
      crew: digest({ kinds: { Dee: "approval" }, ready: ["Cy"] }),
      need: { kind: "ask", crewmate: "Dee", words: "Dee needs you" },
    },
  ])("says the one most urgent fact: $case", ({ crew, need }) => {
    expect(facts(crew)?.need).toEqual(need);
  });

  it("counts no task the lead lands itself", () => {
    const row = facts(digest({ ready: ["Cy"], leadLands: true }));
    expect(row?.need).toBeUndefined();
    expect(row?.reviews).toEqual([]);
  });

  it("does not count a ready-to-land row of the waiting list as somebody needing you", () => {
    const crew = digest({ ready: ["Cy"] });
    const ready = { id: "ready-to-land:task-cy", kind: "ready-to-land", handle: "cy" };
    const row = facts({ ...crew, attention: [ready] });
    expect(row?.need).toEqual({ kind: "land", crewmate: "Cy", words: "Cy's work is ready" });
    expect(row?.minis.find((mini) => mini.name === "Cy")?.state).toBe("idle");
  });

  // Under a colleague's Mate the crew waits on its owner, never on the viewer (the owner,
  // 2026-09-30): no need for the viewer's line and no asking face — its finished work still
  // joins the Review tag for whoever may land it.
  it.each([
    { case: "a crewmate asks", crew: digest({ kinds: { Bo: "input" } }) },
    { case: "the waiting list names crewmates", crew: digest({ waiting: ["Cy"] }) },
    { case: "a task is ready", crew: digest({ ready: ["Cy"] }) },
  ])("says nobody needs the viewer under another's Mate: $case", ({ crew }) => {
    const row = facts(crew, { mine: false });
    expect(row?.need).toBeUndefined();
    expect(row?.minis.some((mini) => mini.state === "needs")).toBe(false);
  });

  it("tells a colleague's crewmate's ask without saying you", () => {
    const row = facts(digest({ kinds: { Bo: "input" } }), { mine: false });
    expect(row?.minis.find((mini) => mini.name === "Bo")).toMatchObject({
      state: "idle",
      doing: "Asks a question",
    });
  });

  it.each([
    {
      case: "a task the viewer may land",
      crew: digest({ ready: ["Cy"] }),
      input: {},
      reviews: [
        {
          key: `crew:${ENVIRONMENT}:task-cy`,
          target: { kind: "crew-task", environmentId: ENVIRONMENT, taskId: "task-cy" },
          title: "Cy's work is ready",
          crewmate: { name: "Cy", tint: "coral", shape: "pentagon" },
        },
      ],
    },
    {
      case: "a task under a colleague's Mate the viewer may land",
      crew: digest({ ready: ["Bo"] }),
      input: { mine: false },
      reviews: [expect.objectContaining({ key: `crew:${ENVIRONMENT}:task-bo` })],
    },
    {
      case: "its crewmate signed in by somebody else (D6)",
      crew: digest({ ready: ["Cy"] }),
      input: {
        logins: { "claude-code": { signedInBy: "bo", present: true, token: false } },
      },
      reviews: [],
    },
    {
      case: "the Mate's environment is not known",
      crew: digest({ ready: ["Cy"] }),
      input: { environmentId: undefined },
      reviews: [],
    },
  ])("turns finished work into the project's review items: $case", ({ crew, input, reviews }) => {
    expect(facts(crew, input)?.reviews).toEqual(reviews);
  });

  // HQ not answering now, or the Mate asleep: the faces keep their places at rest, with nothing
  // that is only true now.
  it("draws the crew at rest where what it does is not known now", () => {
    const row = facts(digest({ kinds: { Bo: "working", Cy: "input" }, ready: ["Dee"] }), {
      current: false,
    });
    expect(row?.known).toBe(false);
    expect(row?.minis.map((mini) => `${mini.name}:${mini.state}:${String(mini.doing)}`)).toEqual([
      "Ada:idle:undefined",
      "Bo:idle:undefined",
      "Cy:idle:undefined",
      "Dee:idle:undefined",
    ]);
    expect(row?.need).toBeUndefined();
    expect(row?.reviews).toEqual([]);
    expect(row?.words).toBe("Crew: Ada, Bo, Cy, Dee");
  });
});
