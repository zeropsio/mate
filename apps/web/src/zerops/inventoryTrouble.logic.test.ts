import { describe, expect, it } from "vite-plus/test";

import {
  INVENTORY_TROUBLE_HOLD_MS,
  accountFootLine,
  inventoryTroubleVoice,
  organizationKnowledge,
  troubleLatch,
  troubleSubject,
  type InventoryTroubleInput,
  type InventoryTroubleVoice,
} from "./inventoryTrouble.logic";

const SAYS = {
  sentence: "Zerops isn't answering. Trying again…",
  tryNow: true,
  retrying: true,
} as const;

/** A mounted product on a grant still held, its session alive, and nothing wrong. */
const calm: InventoryTroubleInput = {
  mounted: true,
  lapsed: false,
  sessionEnded: false,
  trouble: null,
  troubledForMs: 0,
  retrying: true,
};

describe("when the inventory's trouble speaks", () => {
  it.each<{
    readonly name: string;
    readonly input: Partial<InventoryTroubleInput>;
    readonly voice: typeof SAYS | null;
  }>([
    { name: "nothing wrong: silence", input: {}, voice: null },
    {
      name: "a round that failed a moment ago: silence, the retry runs on its own",
      input: { trouble: "grant", troubledForMs: 3_000 },
      voice: null,
    },
    {
      name: "a failure that cleared: silence",
      input: { trouble: null, troubledForMs: 0 },
      voice: null,
    },
    {
      name: "an organization's data refused a moment ago: silence",
      input: { trouble: "organization", troubledForMs: 3_000 },
      voice: null,
    },
    {
      name: "a round failing past the hold: says so, and offers Try now",
      input: { trouble: "grant", troubledForMs: INVENTORY_TROUBLE_HOLD_MS },
      voice: SAYS,
    },
    {
      name: "an organization's data blocked past the hold: the same words",
      input: { trouble: "organization", troubledForMs: INVENTORY_TROUBLE_HOLD_MS },
      voice: SAYS,
    },
    {
      name: "the grant it runs on has lapsed: the lapse's one banner speaks, not this",
      input: { trouble: "grant", troubledForMs: INVENTORY_TROUBLE_HOLD_MS, lapsed: true },
      voice: null,
    },
    {
      name: "the sign-in ended: the sign-in screen speaks, and nothing here offers Sign out",
      input: { trouble: "grant", troubledForMs: INVENTORY_TROUBLE_HOLD_MS, sessionEnded: true },
      voice: null,
    },
    {
      name: "before the product mounts: the gate's own wait speaks",
      input: { trouble: "grant", troubledForMs: INVENTORY_TROUBLE_HOLD_MS, mounted: false },
      voice: null,
    },
  ])("$name", ({ input, voice }) => {
    expect(inventoryTroubleVoice({ ...calm, ...input })).toEqual(voice);
  });
});

describe("what the account says at the menu's foot", () => {
  it.each<{
    readonly name: string;
    readonly lapse: { readonly sentence: string; readonly retry: boolean } | null;
    readonly trouble: InventoryTroubleVoice | null;
    readonly said: { readonly sentence: string; readonly actions: ReadonlyArray<string> } | null;
  }>([
    { name: "nothing wrong: nothing", lapse: null, trouble: null, said: null },
    {
      name: "a lapse still checking: its words, and the way out of the account (A9)",
      lapse: { sentence: "Checking your Zerops access…", retry: false },
      trouble: null,
      said: { sentence: "Checking your Zerops access…", actions: ["sign-out"] },
    },
    {
      name: "a lapse whose renewal failed: Try now, and the way out",
      lapse: { sentence: "Zerops isn't answering.", retry: true },
      trouble: null,
      said: { sentence: "Zerops isn't answering.", actions: ["try-now", "sign-out"] },
    },
    {
      name: "the inventory's lasting trouble: Try now only",
      lapse: null,
      trouble: SAYS,
      said: { sentence: "Zerops isn't answering. Trying again…", actions: ["try-now"] },
    },
  ])("$name", ({ lapse, trouble, said }) => {
    expect(accountFootLine({ lapse, trouble, attempt: "idle" })).toEqual(said);
  });
});

describe("what the inventory says of the organization in view", () => {
  it.each<{
    readonly name: string;
    readonly input: Parameters<typeof organizationKnowledge>[0];
    readonly known: ReturnType<typeof organizationKnowledge>;
  }>([
    {
      name: "every organization read: known, no trouble",
      input: { grantFailed: false, blocked: [], unread: [], active: "org-b" },
      known: { loading: false, trouble: null },
    },
    {
      name: "trouble in another organization: what org B's consumers see is unchanged",
      input: { grantFailed: false, blocked: ["org-a"], unread: ["org-a"], active: "org-b" },
      known: { loading: false, trouble: null },
    },
    {
      name: "trouble in the organization in view: not known, and the trouble is its",
      input: { grantFailed: false, blocked: ["org-b"], unread: [], active: "org-b" },
      known: { loading: true, trouble: "organization" },
    },
    {
      name: "the organization in view still unread: loading, no trouble",
      input: { grantFailed: false, blocked: [], unread: ["org-b"], active: "org-b" },
      known: { loading: true, trouble: null },
    },
    {
      name: "no organization chosen: every organization is in view",
      input: { grantFailed: false, blocked: ["org-a"], unread: [], active: null },
      known: { loading: true, trouble: "organization" },
    },
    {
      name: "a grant round failing: nothing is known, wherever",
      input: { grantFailed: true, blocked: [], unread: [], active: "org-b" },
      known: { loading: true, trouble: "grant" },
    },
  ])("$name", ({ input, known }) => {
    expect(organizationKnowledge(input)).toEqual(known);
  });
});

describe("Try now, and what the line names", () => {
  const lapse = { sentence: "Zerops isn't answering.", retry: true };
  it.each<{
    readonly name: string;
    readonly input: Parameters<typeof accountFootLine>[0];
    readonly said: { readonly sentence: string; readonly actions: ReadonlyArray<string> } | null;
  }>([
    {
      name: "pressed: the button says it is trying, and takes no second press",
      input: { lapse: null, trouble: SAYS, attempt: "trying" },
      said: { sentence: "Zerops isn't answering. Trying again…", actions: ["trying"] },
    },
    {
      name: "the trouble outlived the try: the line says so, and offers it again",
      input: { lapse: null, trouble: SAYS, attempt: "still" },
      said: { sentence: "Still not answering. Trying again…", actions: ["try-now"] },
    },
    {
      name: "a lapse being tried: trying, and the way out stays",
      input: { lapse, trouble: null, attempt: "trying" },
      said: { sentence: "Zerops isn't answering.", actions: ["trying", "sign-out"] },
    },
  ])("$name", ({ input, said }) => {
    const line = accountFootLine(input);
    expect(line === null ? null : { sentence: line.sentence, actions: line.actions }).toEqual(said);
  });

  it.each([
    {
      name: "the organization's own list, or more than one project: the organization",
      input: { organization: "Mate", projects: ["Vera", "Fen"], organizationList: false },
      subject: "Mate's projects and services",
    },
    {
      name: "the organization's list itself",
      input: { organization: "Mate", projects: [], organizationList: true },
      subject: "Mate's projects and services",
    },
    {
      name: "one project alone: that project",
      input: { organization: "Mate", projects: ["Vera"], organizationList: false },
      subject: "Vera in Mate",
    },
  ])("names $name", ({ input, subject }) => {
    expect(troubleSubject(input)).toBe(subject);
  });
});

describe("a failure that lasts across its retries", () => {
  const failed = (retryAtMs: number | null, retryable = true) =>
    ({ status: "failed", retryAtMs, retryable }) as const;
  const establishing = { status: "establishing" } as const;
  const observing = { status: "observing" } as const;
  type Step = ReadonlyArray<{
    readonly organizationId: string;
    readonly projectId: string | null;
    readonly interest: {
      readonly status: string;
      readonly retryAtMs?: number | null;
      readonly retryable?: boolean;
    };
  }>;
  const run = (steps: ReadonlyArray<Step>) => {
    let latch = troubleLatch(new Map(), []);
    const seen: Array<ReadonlyArray<readonly [string, boolean]>> = [];
    for (const step of steps) {
      latch = troubleLatch(latch, step as never);
      seen.push([...latch].map(([organization, entry]) => [organization, entry.retrying] as const));
    }
    return seen;
  };

  it("stays troubled through each retry's establishing, and ends once everything observes", () => {
    expect(
      run([
        [{ organizationId: "o", projectId: null, interest: failed(1_000) }],
        [{ organizationId: "o", projectId: null, interest: establishing }],
        [{ organizationId: "o", projectId: null, interest: failed(3_000) }],
        [{ organizationId: "o", projectId: null, interest: establishing }],
        [{ organizationId: "o", projectId: null, interest: observing }],
      ]),
    ).toEqual([[["o", true]], [["o", true]], [["o", true]], [["o", true]], []]);
  });

  it("an establishing read with no failure before it is no trouble", () => {
    expect(run([[{ organizationId: "o", projectId: null, interest: establishing }]])).toEqual([[]]);
  });

  it("a failure no retry follows is trouble that waits for a person", () => {
    expect(run([[{ organizationId: "o", projectId: "p", interest: failed(null, false) }]])).toEqual(
      [[["o", false]]],
    );
  });

  it("names the failing reads, kept through a retry", () => {
    let latch = troubleLatch(new Map(), [
      { organizationId: "o", projectId: "p", interest: failed(1_000) } as never,
    ]);
    latch = troubleLatch(latch, [
      { organizationId: "o", projectId: "p", interest: establishing } as never,
    ]);
    expect(latch.get("o")?.reads).toEqual([{ organizationId: "o", projectId: "p" }]);
  });
});

describe("Trying again… is said only of a retry that is coming", () => {
  it.each([
    [true, "Zerops isn't answering. Trying again…"],
    [false, "Zerops isn't answering. Try now to ask again."],
  ])("retrying %s: %s", (retrying, sentence) => {
    expect(
      inventoryTroubleVoice({
        ...calm,
        trouble: "organization",
        troubledForMs: INVENTORY_TROUBLE_HOLD_MS,
        retrying,
      }),
    ).toEqual({ sentence, tryNow: true, retrying });
  });

  it.each([
    [true, "Still not answering. Trying again…"],
    [false, "Still not answering. Try now to ask again."],
  ])("a trouble that outlived Try now, retrying %s: %s", (retrying, sentence) => {
    expect(
      accountFootLine({
        lapse: null,
        trouble: { sentence: "", tryNow: true, retrying },
        attempt: "still",
      })?.sentence,
    ).toBe(sentence);
  });
});
