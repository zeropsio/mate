import { describe, expect, it } from "vite-plus/test";

import {
  addAutomatedButton,
  automatedFaces,
  automatedNames,
  automatedNext,
  automatedSourcesWords,
  automatedSubmit,
  automatedWhatTheyDo,
} from "./addAutomatedMates.logic";

const TIER = { kind: "tier" as const, tier: "mate" as const, yaml: "services: []\n" };
const LIMITS = { minutes: 60, costUsd: 3 };

describe("how many automated Mates one Add makes, and who they are", () => {
  const propose = (taken: ReadonlyArray<string>) => ["Ada", "Otto", "Milo"][taken.length]!;

  it("proposes a name for each Mate, keeping the ones already there as the count changes", () => {
    expect(automatedNames([], 1, propose)).toEqual(["Ada"]);
    expect(automatedNames(["Zola"], 3, propose)).toEqual(["Zola", "Otto", "Milo"]);
    expect(automatedNames(["Zola", "Otto", "Milo"], 2, propose)).toEqual(["Zola", "Otto"]);
  });

  it("never gives two Mates of one Add the same colour", () => {
    const faces = automatedFaces(["Ada", "Otto", "Milo"], () => "sky");
    expect(new Set(faces.map((face) => face.tint)).size).toBe(3);
    expect(faces[0]).toEqual({ tint: "sky", shape: expect.any(String) });
  });

  it.each([
    [1, "Add 1 automated Mate"],
    [3, "Add 3 automated Mates"],
  ])("names how many it adds on its button: %i", (count, words) => {
    expect(addAutomatedButton(count)).toBe(words);
  });
});

describe("automatedSubmit — Add with several names", () => {
  const submit = (names: ReadonlyArray<string>, over: { complete?: boolean } = {}) =>
    automatedSubmit({
      names,
      appName: "Tea Shop",
      takenBotNames: { names: ["Fen"], complete: over.complete ?? true },
      tier: TIER,
      tierLoading: false,
    });

  it.each([
    {
      case: "names free on the account: every Mate is made with the project's recipe",
      names: ["Ada", "Otto"],
      expected: { kind: "create", recipe: TIER },
    },
    {
      case: "a name another Mate has: that one is refused",
      names: ["Ada", "Fen"],
      expected: { kind: "refuse", index: 1, error: "Another Mate already has that name." },
    },
    {
      case: "two of the Add's own with one name: the second is refused",
      names: ["Ada", "ada "],
      expected: { kind: "refuse", index: 1, error: "Two of them have the same name." },
    },
    {
      case: "a blank name: refused",
      names: ["Ada", " "],
      expected: { kind: "refuse", index: 1, error: "Give the Mate a name." },
    },
  ])("$case", ({ names, expected }) => {
    expect(submit(names)).toEqual(expected);
  });

  it("waits for every Mate's name to be read before making any", () => {
    expect(submit(["Ada", "Otto"], { complete: false })).toEqual({ kind: "wait", on: "names" });
  });
});

describe("what automated Mates do, in one paragraph", () => {
  it.each([
    {
      case: "the project's GitHub issues, the organization's key, the limits per task",
      input: {
        count: 2,
        sources: {
          kind: "named" as const,
          words: "GitHub issues labelled “mate” in acme/tea-shop",
        },
        key: "set" as const,
        limits: LIMITS,
      },
      words: [
        "They take tasks from GitHub issues labelled “mate” in acme/tea-shop.",
        "They run on the organization's key (Nebius · GLM-5.3), at most $3 and 60 minutes per task.",
      ],
    },
    {
      case: "a project with no source yet says where one is added",
      input: {
        count: 1,
        sources: { kind: "none" as const },
        key: "set" as const,
        limits: undefined,
      },
      words: [
        "No sources of tasks yet — add one on the project's page.",
        "It runs on the organization's key (Nebius · GLM-5.3).",
      ],
    },
    {
      case: "a monthly budget says what is spent of it",
      input: {
        count: 3,
        sources: { kind: "reading" as const },
        key: "set" as const,
        limits: { minutes: 30, costUsd: null, monthlyBudgetUsd: 50, spentThisMonthUsd: 6 },
      },
      words: [
        "They run on the organization's key (Nebius · GLM-5.3), at most 30 minutes per task.",
        "$6 of $50 spent this month.",
      ],
    },
    {
      case: "an organization with no key says it isn't set",
      input: {
        count: 1,
        sources: { kind: "none" as const },
        key: "missing" as const,
        limits: LIMITS,
      },
      words: [
        "No sources of tasks yet — add one on the project's page.",
        "It runs on the organization's key (Nebius · GLM-5.3), which isn't set yet, at most $3 and 60 minutes per task.",
      ],
    },
    {
      case: "sources withheld from the reader send them to the project's page",
      input: {
        count: 2,
        sources: { kind: "withheld" as const },
        key: "set" as const,
        limits: undefined,
      },
      words: [
        "They take tasks from the sources set on the project's page.",
        "They run on the organization's key (Nebius · GLM-5.3).",
      ],
    },
  ])("$case", ({ input, words }) => {
    expect(automatedWhatTheyDo(input)).toEqual(words);
  });

  const channel = (name: string | null) => ({
    state: "known" as const,
    held: { channel: name === null ? null : { channel: name } },
    stale: false,
  });
  const listed = (count: number) => ({
    state: "known" as const,
    held: Array.from({ length: count }, () => ({})),
    stale: false,
  });
  const UNREAD = { state: "unread" as const };
  const WITHHELD = { state: "withheld" as const };
  const NONE = {
    intake: null,
    slack: channel(null),
    discord: channel(null),
    webhooks: listed(0),
    schedules: listed(0),
  };

  it("names every source a project takes tasks from", () => {
    expect(
      automatedSourcesWords({
        intake: { repo: "acme/tea-shop", label: "mate", waiting: 2 },
        slack: channel("support"),
        discord: channel(null),
        webhooks: listed(1),
        schedules: { state: "unsupported" },
      }),
    ).toEqual({
      kind: "named",
      words: "GitHub issues labelled “mate” in acme/tea-shop, #support on Slack and a webhook",
    });
    expect(automatedSourcesWords(NONE)).toEqual({ kind: "none" });
  });

  it.each([
    { case: "its GitHub intake", reads: { ...NONE, intake: undefined } },
    { case: "its Slack channel", reads: { ...NONE, slack: UNREAD } },
    { case: "its Discord channel", reads: { ...NONE, discord: { state: "reading" as const } } },
    { case: "its webhooks", reads: { ...NONE, webhooks: UNREAD } },
    { case: "its schedules", reads: { ...NONE, schedules: UNREAD } },
  ])("waits for every source before saying a project has none: $case", ({ reads }) => {
    expect(automatedSourcesWords(reads)).toEqual({ kind: "reading" });
  });

  it.each([
    {
      case: "all but its GitHub intake withheld",
      reads: {
        ...NONE,
        slack: WITHHELD,
        discord: WITHHELD,
        webhooks: WITHHELD,
        schedules: WITHHELD,
      },
    },
    {
      case: "a webhook read failed",
      reads: { ...NONE, webhooks: { state: "failed" as const, words: "HQ did not answer." } },
    },
    {
      case: "a source named beside one withheld",
      reads: {
        ...NONE,
        intake: { repo: "acme/tea-shop", label: "mate", waiting: 0 },
        schedules: WITHHELD,
      },
    },
  ])(
    "never says a project takes tasks from nowhere while some of its sources are refused to the reader: $case",
    ({ reads }) => {
      expect(automatedSourcesWords(reads)).toEqual({ kind: "withheld" });
    },
  );
});

describe("what happens once automated Mates are added", () => {
  it.each([
    ["none", 2, "They come up in about 2–4 minutes and take the first task waiting."],
    [
      "recipe",
      1,
      "It comes up in about 2–4 minutes, sets up development in up to 15 more, then takes the first task waiting.",
    ],
  ] as const)("a project with %s: %i Mates", (recipe, count, words) => {
    expect(automatedNext(count, recipe)).toBe(words);
  });
});
