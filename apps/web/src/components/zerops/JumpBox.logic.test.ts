import { describe, expect, it } from "vite-plus/test";

import {
  highlightParts,
  isFreeMate,
  jumpGroups,
  jumpKey,
  EMPTY_JUMP_INDEX,
  jumpMateOf,
  jumpWritePlan,
  readJumpQuery,
  slashOpensJumpBox,
  snippetAround,
  withLiveMates,
  type JumpActivity,
  type JumpConversation,
  type JumpHit,
  type JumpMate,
  type JumpWriteAction,
  type SidebarJumpIndex,
} from "./JumpBox.logic";

function mate(
  projectId: string,
  name: string,
  overrides: Partial<Omit<JumpMate, "projectId" | "name">> = {},
): JumpMate {
  return {
    projectId,
    name,
    tint: "slate",
    shape: "squircle",
    face: "idle",
    projectName: "Shop",
    subject: undefined,
    snippet: undefined,
    environmentId: `env-${projectId}`,
    connected: true,
    conversation: { threadId: `thread-${projectId}`, kind: "idle" },
    owner: undefined,
    pausedUntil: undefined,
    mine: true,
    ...overrides,
  };
}

const NOVA = mate("shop-nova", "Nova", {
  subject: "Take 10% off the items",
  snippet: "Done. The cart takes 10% off the items.",
});
const KAI = mate("shop-kai", "Kai", {
  face: "working",
  subject: "Run the build",
  conversation: { threadId: "thread-shop-kai", kind: "working" },
});
const NORA = mate("notes-nora", "Nora", {
  projectName: "Notes",
  face: "needs",
  subject: "Move finished items out of the way",
  conversation: { threadId: "thread-notes-nora", kind: "input" },
});
const ADA = mate("notes-ada", "Ada", {
  projectName: "Notes",
  face: "sleep",
  connected: false,
  conversation: undefined,
});

const INDEX: SidebarJumpIndex = {
  mates: [NOVA, KAI, NORA, ADA],
  projects: [
    { groupId: "shop", name: "Shop", mates: 2 },
    { groupId: "notes", name: "Notes", mates: 2 },
  ],
  changes: [
    {
      key: "appdev#41",
      groupId: "shop",
      repository: "appdev",
      number: 41,
      projectName: "Shop",
      label: "#41 Two-step checkout: the basket step",
      mateProjectId: "shop-kai",
      whose: "Kai",
    },
    {
      key: "appdev#6",
      groupId: "shop",
      repository: "appdev",
      number: 6,
      projectName: "Shop",
      label: "#6 Bump the linter",
      mateProjectId: "shop-nova",
      whose: "Nova",
    },
  ],
  stops: [
    {
      projectId: "shop-stage",
      groupId: "shop",
      title: "stage",
      projectName: "Shop",
      line: "3f9c1b2",
      dot: "spinner",
      word: "Stage, deploying",
    },
    {
      projectId: "shop-prod",
      groupId: "shop",
      title: "production",
      projectName: "Shop",
      line: "v2.11.0",
      dot: "ok",
      word: "Production v2.11.0, healthy",
    },
  ],
};

const labels = (
  value: string,
  hits: ReadonlyArray<JumpHit> = [],
  readOnly: ReadonlySet<string> = new Set(),
) =>
  jumpGroups(INDEX, value, hits, readOnly).map((group) => ({
    group: group.label,
    items: group.items.map((item) => item.value),
  }));

describe("readJumpQuery — what the box was asked", () => {
  it.each([
    { value: "", query: { mode: "find", text: "" } },
    { value: "  shop ", query: { mode: "find", text: "shop" } },
    { value: "@", query: { mode: "write", name: "" } },
    { value: "@no", query: { mode: "write", name: "no" } },
    { value: "@ no ", query: { mode: "write", name: "no" } },
    { value: "#41", query: { mode: "find", text: "#41" } },
  ])("reads $value", ({ value, query }) => {
    expect(readJumpQuery(value)).toEqual(query);
  });
});

describe("jumpGroups — what a query finds, grouped", () => {
  it("offers the menu's first Mates and every project before anything is typed", () => {
    expect(labels("")).toEqual([
      {
        group: "Mates",
        items: ["mate:shop-nova", "mate:shop-kai", "mate:notes-nora", "mate:notes-ada"],
      },
      { group: "Projects", items: ["project:shop", "project:notes", "new-project"] },
    ]);
  });

  // "New project" lives at the end of the menu's projects, and in the box
  // (D11): the projects' last item, found by its own words.
  it.each([
    { value: "new", items: ["new-project"] },
    { value: "new pro", items: ["new-project"] },
    { value: "PROJECT", items: ["new-project"] },
  ])("offers a new project for $value", ({ value, items }) => {
    expect(labels(value)).toEqual([{ group: "Projects", items }]);
  });

  it("offers a new project to an account with no project yet", () => {
    expect(
      jumpGroups({ ...INDEX, mates: [], projects: [] }, "", []).map((group) => ({
        group: group.label,
        items: group.items.map((item) => item.value),
      })),
    ).toEqual([{ group: "Projects", items: ["new-project"] }]);
  });

  it.each([
    {
      case: "a Mate by its name, the ones it starts first",
      value: "no",
      groups: [
        { group: "Mates", items: ["mate:shop-nova", "mate:notes-nora", "mate:notes-ada"] },
        { group: "Projects", items: ["project:notes"] },
      ],
    },
    {
      case: "a Mate by its project's name, as it is shown by its own name under it",
      value: "notes",
      groups: [
        { group: "Mates", items: ["mate:notes-nora", "mate:notes-ada"] },
        { group: "Projects", items: ["project:notes"] },
      ],
    },
    {
      case: "a stop by its project's name, as it is shown by its own name under it",
      value: "shop",
      groups: [
        { group: "Mates", items: ["mate:shop-nova", "mate:shop-kai"] },
        { group: "Projects", items: ["project:shop"] },
        { group: "Stops", items: ["stop:shop-stage", "stop:shop-prod"] },
      ],
    },
    {
      case: "a change by its number",
      value: "#41",
      groups: [{ group: "Changes", items: ["change:shop:appdev#41"] }],
    },
    {
      case: "a change by its title",
      value: "linter",
      groups: [{ group: "Changes", items: ["change:shop:appdev#6"] }],
    },
    {
      case: "a stop by its project and its name",
      value: "shop prod",
      groups: [{ group: "Stops", items: ["stop:shop-prod"] }],
    },
    {
      case: "a stop by what it runs",
      value: "v2.11",
      groups: [{ group: "Stops", items: ["stop:shop-prod"] }],
    },
    {
      case: "a Mate by the task it is on",
      value: "finished items",
      groups: [{ group: "In conversations", items: ["text:notes-nora:row"] }],
    },
    {
      case: "a Mate by its last words",
      value: "cart takes",
      groups: [{ group: "In conversations", items: ["text:shop-nova:row"] }],
    },
    { case: "nothing, for a word nothing holds", value: "zebra", groups: [] },
  ])("finds $case", ({ value, groups }) => {
    expect(labels(value)).toEqual(groups);
  });

  it("puts what the server found further back after what the menu says, once per Mate", () => {
    const hits: ReadonlyArray<JumpHit> = [
      { environmentId: "env-shop-kai", threadId: "t1", source: "assistant", snippet: "the basket" },
      { environmentId: "env-shop-kai", threadId: "t1", source: "user", snippet: "a basket again" },
      { environmentId: "env-hidden", threadId: "t9", source: "user", snippet: "basket" },
      { environmentId: "env-shop-nova", threadId: "t2", source: "user", snippet: "items basket" },
    ];
    expect(labels("basket", hits)).toEqual([
      { group: "Changes", items: ["change:shop:appdev#41"] },
      { group: "In conversations", items: ["text:shop-kai:t1", "text:shop-nova:t2"] },
    ]);
    // What the menu itself says comes first; the server's hit for the same Mate adds nothing.
    const again: ReadonlyArray<JumpHit> = [
      {
        environmentId: "env-shop-nova",
        threadId: "t2",
        source: "user",
        snippet: "the items again",
      },
    ];
    expect(labels("items", again).at(-1)).toEqual({
      group: "In conversations",
      items: ["text:shop-nova:row", "text:notes-nora:row"],
    });
  });

  it("lists the free Mates first when writing, a name it starts first in each", () => {
    expect(labels("@")).toEqual([
      { group: "Free now", items: ["write:shop-nova"] },
      { group: "Busy", items: ["write:shop-kai", "write:notes-nora", "write:notes-ada"] },
    ]);
    expect(labels("@a")).toEqual([
      { group: "Free now", items: ["write:shop-nova"] },
      { group: "Busy", items: ["write:notes-ada", "write:shop-kai", "write:notes-nora"] },
    ]);
  });

  it("never offers to write to a Mate somebody else signed in (D6), though it still finds it", () => {
    const theirs = new Set(["shop-kai", "shop-nova"]);
    expect(labels("@", [], theirs)).toEqual([
      { group: "Busy", items: ["write:notes-nora", "write:notes-ada"] },
    ]);
    expect(labels("kai", [], theirs)).toEqual([{ group: "Mates", items: ["mate:shop-kai"] }]);
  });

  it("caps each group so one kind of thing cannot push the rest out of sight", () => {
    const many: SidebarJumpIndex = {
      ...INDEX,
      mates: Array.from({ length: 9 }, (_, index) =>
        mate(`m${String(index)}`, `Mo${String(index)}`, { subject: "the same task" }),
      ),
    };
    const [mates] = jumpGroups(many, "mo", []);
    expect(mates?.items).toHaveLength(5);
    const [first] = jumpGroups(many, "", []);
    expect(first?.items).toHaveLength(6);
    const [conversations] = jumpGroups(many, "same task", []);
    expect(conversations?.items).toHaveLength(5);
  });
});

describe("isFreeMate — free to start on something now", () => {
  it.each([
    { face: "idle", pausedUntil: undefined, free: true },
    { face: "done", pausedUntil: undefined, free: true },
    { face: "done", pausedUntil: "2026-09-27T14:20:00Z", free: false },
    { face: "working", pausedUntil: undefined, free: false },
    { face: "needs", pausedUntil: undefined, free: false },
    { face: "sleep", pausedUntil: undefined, free: false },
  ] as const)("a $face Mate is free: $free", ({ face, pausedUntil, free }) => {
    expect(isFreeMate({ face, pausedUntil })).toBe(free);
  });
});

describe("jumpMateOf and withLiveMates — a Mate as its row says it, read afresh", () => {
  const activity = (overrides: Partial<JumpActivity> = {}): JumpActivity => ({
    threadId: "thread-shop-nova" as JumpActivity["threadId"],
    kind: "working",
    face: "working",
    subject: "Run the build",
    snippet: undefined,
    pausedUntil: undefined,
    ...overrides,
  });
  const base = {
    projectId: "shop-nova",
    name: "Nova",
    tint: "sky",
    shape: "seal",
    projectName: "Shop",
    environmentId: "env-shop-nova",
    owner: undefined,
    mine: true,
  } as const;

  it("reads a connected Mate's conversation, and nothing of one asleep", () => {
    expect(jumpMateOf({ ...base, connected: true, activity: activity() })).toMatchObject({
      face: "working",
      subject: "Run the build",
      conversation: { threadId: "thread-shop-nova", kind: "working" },
    });
    // Its last word, at rest: nothing of now.
    expect(
      jumpMateOf({ ...base, connected: false, activity: activity({ remembered: true }) }),
    ).toMatchObject({ face: "sleep", subject: undefined, conversation: undefined });
    expect(jumpMateOf({ ...base, connected: true, activity: undefined }).face).toBe("idle");
  });

  it("reads an unopened Mate's words from HQ's live word, and offers no conversation to write to", () => {
    expect(jumpMateOf({ ...base, connected: false, activity: activity() })).toMatchObject({
      face: "working",
      subject: "Run the build",
      conversation: undefined,
    });
  });

  // As on its row (`candidateContainerRuns`): a container that runs wears the face awake while
  // this browser's socket to it opens, and nothing of its conversation is read before it does.
  it("wears a running Mate awake before its socket opens, reading nothing of it yet", () => {
    expect(
      jumpMateOf({ ...base, connected: false, runs: true, activity: undefined }),
    ).toMatchObject({ face: "idle", subject: undefined, conversation: undefined });
    expect(jumpMateOf({ ...base, connected: false, runs: false, activity: undefined }).face).toBe(
      "sleep",
    );
  });

  it("keeps HQ's live activity before this tab opens the Mate socket", () => {
    expect(
      jumpMateOf({ ...base, connected: false, runs: true, activity: activity() }),
    ).toMatchObject({
      face: "working",
      subject: "Run the build",
      conversation: undefined,
    });
  });

  // Its pose as on its row (`mateFaceFor`): waking while it comes up and arrives, read afresh too.
  it.each([
    {
      case: "coming up",
      pose: { life: "coming" },
      connected: false,
      read: undefined,
      face: "waking",
    },
    {
      case: "did not come",
      pose: { life: "failed" },
      connected: false,
      read: undefined,
      face: "sleep",
    },
    {
      case: "arriving, its sign-in to come",
      pose: { arriving: true },
      connected: true,
      read: undefined,
      face: "waking",
    },
    {
      case: "arrived, at rest",
      pose: { arriving: false },
      connected: true,
      read: undefined,
      face: "idle",
    },
    {
      case: "arriving, talked to: its conversation's own",
      pose: { arriving: true },
      connected: true,
      read: activity({ kind: "working", face: "working" }),
      face: "working",
    },
    {
      case: "arrived, not running",
      pose: { arriving: false },
      connected: false,
      read: undefined,
      face: "sleep",
    },
  ] as const)("$case: $face", ({ pose, connected, read, face }) => {
    const listed = jumpMateOf({ ...base, connected, activity: read, pose });
    expect(listed.face).toBe(face);
    // Read afresh, it keeps the pose.
    const fresh = withLiveMates({ ...EMPTY_JUMP_INDEX, mates: [listed] }, () => read);
    expect(fresh.mates[0]?.face).toBe(face);
  });

  // Its change waiting for review needs you in the box as on its row (`mateFaceOf`).
  it.each([
    {
      case: "at rest, its change waits",
      activity: activity({ kind: "idle", face: "idle" }),
      connected: true,
      face: "needs",
    },
    {
      case: "at work, its change waits: the work shows",
      activity: activity(),
      connected: true,
      face: "working",
    },
    { case: "asleep, its change waits", activity: undefined, connected: false, face: "needs" },
  ])("$case", ({ activity: read, connected, face }) => {
    expect(jumpMateOf({ ...base, connected, activity: read, reviewWaits: true }).face).toBe(face);
    // Read afresh, it keeps the rule.
    const fresh = withLiveMates(
      {
        ...INDEX,
        mates: [jumpMateOf({ ...base, connected, activity: undefined, reviewWaits: true })],
      },
      () => read,
    );
    expect(fresh.mates[0]?.face).toBe(face);
  });

  it("puts each Mate's live conversation over what the menu last drew", () => {
    const fresh = withLiveMates(INDEX, (mate) =>
      mate.projectId === "shop-nova"
        ? activity({ kind: "input", face: "needs", subject: "Only the items?" })
        : undefined,
    );
    expect(fresh.mates[0]).toMatchObject({
      face: "needs",
      subject: "Only the items?",
      conversation: { kind: "input" },
    });
    // Nothing known of it now: its row says nothing either.
    expect(fresh.mates[1]).toMatchObject({ face: "idle", conversation: undefined });
    expect(fresh.projects).toBe(INDEX.projects);
  });
});

describe("highlightParts — the matched words, marked", () => {
  it.each([
    {
      text: "Nova",
      query: "no",
      parts: [
        ["No", true],
        ["va", false],
      ],
    },
    {
      text: "Shop production",
      query: "PROD",
      parts: [
        ["Shop ", false],
        ["prod", true],
        ["uction", false],
      ],
    },
    {
      text: "a basket, a basket",
      query: "basket",
      parts: [
        ["a ", false],
        ["basket", true],
        [", a ", false],
        ["basket", true],
      ],
    },
    { text: "Nova", query: "", parts: [["Nova", false]] },
    { text: "Nova", query: "x", parts: [["Nova", false]] },
    {
      text: "Beneš",
      query: "neš",
      parts: [
        ["Be", false],
        ["neš", true],
      ],
    },
  ])("marks $query in $text", ({ text, query, parts }) => {
    expect(highlightParts(text, query).map((part) => [part.text, part.match])).toEqual(parts);
  });
});

describe("snippetAround — the words around a match, not the conversation's opening", () => {
  it.each([
    { case: "short text whole", text: "It is on stage.", query: "stage", out: "It is on stage." },
    {
      case: "long text cut around the match",
      text: `${"x".repeat(60)} the basket keeps across a reload ${"y".repeat(80)}`,
      query: "basket",
      out: "…the basket keeps across a reload…",
    },
    { case: "whitespace folded", text: "one\n\ntwo   three", query: "two", out: "one two three" },
    {
      // Cut first, the name would fall away and leave "hunter2026 the basket".
      case: "a credential masked before the cut can part it from its name",
      text: `${"x".repeat(40)} DB_PASSWORD=hunter2026 the basket keeps`,
      query: "basket",
      out: "…DB_PASSWORD=•••••• the basket keeps",
    },
    {
      case: "markdown's marks dropped, the way the rows quote it",
      text: "Done: - **Checkout moved:** the `cart` is [live](https://x.dev)",
      query: "done",
      out: "Done: - Checkout moved: the cart is live",
    },
    {
      case: "whole words at both cuts",
      text: "Split the checkout into a two-step flow with a saved basket, and keep it",
      query: "basket",
      out: "…flow with a saved basket, and keep it",
    },
  ])("keeps $case", ({ text, query, out }) => {
    expect(snippetAround(text, query)).toBe(out);
  });
});

const conversation = (kind: JumpConversation["kind"] = "idle"): JumpConversation => ({
  threadId: "thread-nova",
  kind,
});

describe("jumpWritePlan — who reads it, when, and what Enter does", () => {
  const base = {
    name: "Nova",
    owner: { name: "Ada Lovelace", isViewer: true },
    conversation: conversation(),
    pausedUntilLabel: undefined,
    started: true,
    readOnly: false,
    decision: undefined,
  } as const;
  const question = (allowText: boolean) =>
    ({
      kind: "question",
      requestId: "r",
      questionId: "q",
      question: "Only the items?",
      choices: [{ label: "Yes", value: "yes", primary: false }],
      allowText,
    }) as const;

  const cases: ReadonlyArray<{
    readonly case: string;
    readonly input: Partial<Parameters<typeof jumpWritePlan>[0]>;
    readonly hint: string;
    readonly action: JumpWriteAction;
  }> = [
    { case: "a free Mate", input: {}, hint: "Nova reads it now", action: "send" },
    {
      case: "a Mate that finished",
      input: { conversation: conversation("done") },
      hint: "Nova reads it now",
      action: "send",
    },
    {
      case: "a Mate stopped on an error",
      input: { conversation: conversation("failed") },
      hint: "Nova reads it now",
      action: "send",
    },
    {
      case: "a Mate at work",
      input: { conversation: conversation("working") },
      hint: "Nova is working — it reads this at its next step",
      action: "send",
    },
    {
      case: "a Mate coming up",
      input: { conversation: conversation("connecting") },
      hint: "Nova is working — it reads this at its next step",
      action: "send",
    },
    {
      case: "a Mate watching in the background",
      input: { conversation: conversation("monitoring") },
      hint: "Nova is working — it reads this at its next step",
      action: "send",
    },
    {
      case: "a Mate asking one question in words",
      input: { conversation: conversation("input"), decision: question(true) },
      hint: "Nova is waiting for your answer — this answers it",
      action: "answer",
    },
    {
      case: "a Mate whose question is not read yet",
      input: { conversation: conversation("input"), decision: { kind: "reading" } },
      hint: "Nova is waiting for your answer — this answers it",
      action: "wait",
    },
    {
      case: "a Mate whose question takes only its options",
      input: { conversation: conversation("input"), decision: question(false) },
      hint: "Nova is waiting for you to pick an answer — Enter opens it",
      action: "open",
    },
    {
      case: "a Mate asking several things at once",
      input: {
        conversation: conversation("input"),
        decision: { kind: "questions", question: "Which rate?", count: 3 },
      },
      hint: "Nova is waiting for your answers — Enter opens it",
      action: "open",
    },
    {
      case: "a Mate waiting for an approval",
      input: { conversation: conversation("approval") },
      hint: "Nova is waiting for your approval — it reads this once you decide",
      action: "send",
    },
    {
      case: "a Mate that proposed a plan",
      input: { conversation: conversation("planReady") },
      hint: "Nova is waiting on its plan — this answers it",
      action: "send",
    },
    {
      case: "a usage limit with no known reset",
      input: { usageLimited: true },
      hint: "I've hit a usage limit. Sending tries again.",
      action: "send",
    },
    {
      case: "a Mate paused at a usage limit",
      input: { pausedUntilLabel: "2:30 PM" },
      hint: "I've hit a usage limit — available again at 2:30 PM. Sending tries again.",
      action: "send",
    },
    {
      case: "a Mate nobody has asked anything yet",
      input: { started: false },
      hint: "Nova reads it now — its conversation opens with it",
      action: "open-and-send",
    },
    {
      case: "a Mate whose conversation is not read yet",
      input: { started: undefined },
      hint: "Nova reads it now",
      action: "wait",
    },
    {
      case: "a colleague's Mate the viewer may write to, which says nothing of the colleague",
      input: { owner: { name: "Petra Malá", isViewer: false } },
      hint: "Nova reads it now",
      action: "send",
    },
    {
      case: "a Mate found to be somebody else's after it was picked",
      input: { owner: { name: "Petra Malá", isViewer: false }, readOnly: true },
      hint: "Nova is Petra's Mate — only Petra writes to it",
      action: "none",
    },
    {
      case: "a Mate somebody unnamed signed in",
      input: { owner: undefined, readOnly: true },
      hint: "Only the person who signed Nova in writes to it",
      action: "none",
    },
  ];
  it.each(cases)("says who reads it for $case", ({ input, hint, action }) => {
    const plan = jumpWritePlan({ ...base, ...input });
    expect(plan.hint).toBe(hint);
    expect(plan.action).toBe(action);
  });
});

describe("jumpKey — the keys the box answers itself", () => {
  const key = (overrides: Partial<Parameters<typeof jumpKey>[0]>) =>
    jumpKey({
      key: "Enter",
      shift: false,
      composing: false,
      targeted: false,
      value: "",
      ...overrides,
    });

  it.each([
    {
      case: "Enter sends to the Mate written to",
      input: { targeted: true, value: "hi" },
      action: "send",
    },
    {
      case: "Shift+Enter is not a send",
      input: { targeted: true, value: "hi", shift: true },
      action: undefined,
    },
    {
      case: "Enter while composing is the IME's",
      input: { targeted: true, composing: true },
      action: undefined,
    },
    {
      case: "Backspace on nothing picks another Mate",
      input: { targeted: true, key: "Backspace" },
      action: "back-to-list",
    },
    {
      case: "Backspace in words is a Backspace",
      input: { targeted: true, key: "Backspace", value: "hi" },
      action: undefined,
    },
    {
      case: "Escape leaves the Mate, not the box",
      input: { targeted: true, key: "Escape" },
      action: "back-to-find",
    },
    {
      case: "Tab stays in the box while writing",
      input: { targeted: true, key: "Tab" },
      action: "hold",
    },
    {
      case: "Tab writes to the Mate picked",
      input: { key: "Tab", value: "@no" },
      action: "choose",
    },
    {
      case: "Tab outside @ is the browser's",
      input: { key: "Tab", value: "shop" },
      action: undefined,
    },
    { case: "Enter on a list is the list's", input: { value: "@no" }, action: undefined },
  ])("$case", ({ input, action }) => {
    expect(key(input)).toBe(action);
  });
});

describe("slashOpensJumpBox — / opens the box where nothing else has the keys", () => {
  const base = { key: "/", modified: false, composing: false, handled: false, owned: false };
  it.each([
    { case: "on the page", input: {}, opens: true },
    { case: "with a modifier", input: { modified: true }, opens: false },
    { case: "while composing", input: { composing: true }, opens: false },
    { case: "once something took it", input: { handled: true }, opens: false },
    { case: "in a field, a menu or a list", input: { owned: true }, opens: false },
    { case: "for another key", input: { key: "?" }, opens: false },
  ])("$case: $opens", ({ input, opens }) => {
    expect(slashOpensJumpBox({ ...base, ...input })).toBe(opens);
  });
});
