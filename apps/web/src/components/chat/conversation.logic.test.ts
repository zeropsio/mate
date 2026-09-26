import { describe, expect, it } from "vite-plus/test";

import type { TimelineEntry } from "../../session-logic";
import type { TurnDiffSummary } from "../../types";
import {
  browserCheckCaption,
  browserCheckFailure,
  browserStrip,
  browserTakeState,
  deriveConversationStructure,
  deriveOutcome,
  formatWorkDuration,
  messageReceipt,
  namedToolCall,
  noteLine,
  readSlashCommand,
  readsAsAnswer,
  splitBatchDeploy,
  toolCallWords,
  readUsageLimitNotice,
  stretchFace,
  stretchIncidents,
  stretchNotes,
  summarizeActivity,
} from "./conversation.logic";
import {
  assistant,
  at,
  landed,
  operation,
  reasoning,
  tool,
  turn,
  user,
} from "./conversationFixtures";

function structure(
  entries: TimelineEntry[],
  options: {
    live?: string;
    latest?: { id: string; state: string; completed: boolean };
    working?: boolean;
  } = {},
) {
  const latestTurn = options.latest
    ? {
        turnId: turn(options.latest.id),
        state: options.latest.state,
        startedAt: at(0),
        completedAt: options.latest.completed ? at(59) : null,
      }
    : null;
  return deriveConversationStructure({
    timelineEntries: entries,
    latestTurn,
    runningTurnId: options.live ? turn(options.live) : null,
    isWorking: options.working ?? options.live !== undefined,
    activeTurnStartedAt: options.live ? at(0) : null,
  });
}

describe("formatWorkDuration", () => {
  it.each([
    [0, "1s"],
    [400, "1s"],
    [42_000, "42s"],
    [59_999, "59s"],
    [60_000, "1m"],
    [72_000, "1m 12s"],
    [9 * 60_000 + 59_000, "9m 59s"],
    [10 * 60_000 + 30_000, "10m"],
    [13 * 60_000, "13m"],
    [60 * 60_000, "1h"],
    [126 * 60_000, "2h 6m"],
    [25 * 60 * 60_000, "1d 1h"],
    [Number.NaN, "1s"],
  ])("%d ms reads %s", (ms, expected) => {
    expect(formatWorkDuration(ms)).toBe(expected);
  });
});

describe("readSlashCommand", () => {
  it.each([
    ["/compact", { name: "compact", args: "" }],
    ["  /model opus  ", { name: "model", args: "opus" }],
    ["/Review:pr 12", { name: "review:pr", args: "12" }],
    ["compact", null],
    ["/ not a command", null],
    ["see /etc/hosts", null],
    ["/usr/bin is a path?", null],
  ])("%j", (text, expected) => {
    expect(readSlashCommand(text)).toEqual(expected);
  });
});

describe("readUsageLimitNotice", () => {
  it.each([
    [
      "You've hit your session limit · resets 9:20pm (UTC)",
      at(48),
      new Date(Date.UTC(2026, 8, 24, 21, 20)).toISOString(),
    ],
    [
      "You've hit your session limit · resets 12:30am (UTC)",
      at(48),
      new Date(Date.UTC(2026, 8, 25, 0, 30)).toISOString(),
    ],
    // Written after the named time: it is tomorrow's.
    [
      "You’ve hit your weekly limit · resets 4:10pm (UTC)",
      at(48),
      new Date(Date.UTC(2026, 8, 25, 16, 10)).toISOString(),
    ],
    [
      "You've hit your session limit · resets 11pm (Europe/Prague)",
      at(48),
      new Date(Date.UTC(2026, 8, 24, 21, 0)).toISOString(),
    ],
    [
      "Claude usage limit reached. This turn is paused until the 5-hour limit resets in 32m.",
      at(48),
      new Date(Date.UTC(2026, 8, 24, 21, 20)).toISOString(),
    ],
    [
      "Claude usage limit reached. This turn is paused until the limit resets in 1h 5m.",
      at(0),
      new Date(Date.UTC(2026, 8, 24, 21, 5)).toISOString(),
    ],
    ["Claude AI usage limit reached|1790283600", at(0), new Date(1790283600 * 1000).toISOString()],
    ["You've hit your session limit", at(0), null],
  ])("%j", (text, createdAt, resetsAt) => {
    expect(readUsageLimitNotice(text, createdAt)).toEqual({ resetsAt });
  });

  it("does not read a narration that mentions a limit", () => {
    expect(
      readUsageLimitNotice(
        "All three agents stopped on the session limit. I'm resuming each with its existing context, and checking what they'd already written so no work is lost — the rest of the plan stays as it was.",
        at(0),
      ),
    ).toBeNull();
    expect(readUsageLimitNotice("Deployed to stage.", at(0))).toBeNull();
  });
});

describe("readsAsAnswer", () => {
  // A note on the way is a sentence or three; an answer breaks into
  // paragraphs, lists, headings or tables early.
  it.each([
    { text: "Stage is built and PR #34 is open. Checking what changed.", answer: false },
    { text: "Yes, I know the one.\n\n**How it works** (desktop):", answer: true },
    { text: "Done:\n- the menu\n- the panel", answer: true },
    { text: "Done:\n1. the menu", answer: true },
    { text: "## What changed\nThe menu.", answer: true },
    { text: "| Page | Result |\n|---|---|", answer: true },
    { text: "x".repeat(481), answer: true },
    { text: "x".repeat(480), answer: false },
    { text: "  ", answer: false },
  ])("$text.length characters: $answer", ({ text, answer }) => {
    expect(readsAsAnswer(text)).toBe(answer);
  });
});

describe("deriveConversationStructure", () => {
  // The answer streams where it will stand: a running turn's last words are
  // its answer once they read as one and nothing came after them.
  it.each([
    {
      case: "a note on the way",
      entries: [user("m0", 0), tool("w1", "t1", 1), assistant("a1", "t1", 2, "Deploying now.")],
      answer: undefined,
    },
    {
      case: "words that read as the answer, nothing after them",
      entries: [
        user("m0", 0),
        tool("w1", "t1", 1),
        assistant("a1", "t1", 2, "It is live.\n\n**What changed**"),
      ],
      answer: "a1",
    },
    {
      case: "words that read as an answer, then more work: a note after all",
      entries: [
        user("m0", 0),
        assistant("a1", "t1", 1, "Plan:\n- the menu\n- the panel"),
        tool("w1", "t1", 2),
      ],
      answer: undefined,
    },
    {
      case: "the answer while the Mate still thinks after it",
      entries: [
        user("m0", 0),
        tool("w1", "t1", 1),
        assistant("a1", "t1", 2, "It is live.\n\n**What changed**"),
        reasoning("r1", "t1", 3),
      ],
      answer: "a1",
    },
  ])("a running turn: $case", ({ entries, answer }) => {
    const [only] = structure(entries, { live: "t1" }).turns;
    expect(only!.live).toBe(true);
    expect(only!.answer?.id).toBe(answer);
  });

  it("reads a settled turn as one stretch, its last message the answer", () => {
    const entries = [
      user("m0", 0),
      reasoning("r1", "t1", 1),
      tool("w1", "t1", 1),
      assistant("a1", "t1", 2, "Building now."),
      tool("w2", "t1", 3),
      assistant("a2", "t1", 4, "Done: the shop is live."),
    ];
    const result = structure(entries, {
      latest: { id: "t1", state: "completed", completed: true },
    });
    expect(result.turns).toHaveLength(1);
    const [only] = result.turns;
    expect(only!.stretches).toHaveLength(1);
    expect(only!.answer?.id).toBe("a2");
    expect(only!.live).toBe(false);
    expect(only!.stretches[0]).toMatchObject({
      key: "msg:m0",
      aside: false,
      live: false,
      last: true,
      startedAt: at(0),
    });
    expect(stretchNotes(only!.stretches[0]!, only!.answer).map((note) => note.id)).toEqual(["a1"]);
  });

  it("starts a stretch at every message sent into the turn", () => {
    const entries = [
      user("m0", 0),
      tool("w1", "t1", 1),
      assistant("a1", "t1", 2),
      user("m1", 3, "btw make the missions interesting"),
      tool("w2", "t1", 4),
      user("m2", 5, "and the intro screen"),
      assistant("a2", "t1", 6),
      assistant("a3", "t1", 8, "Everything is in."),
    ];
    const [only] = structure(entries, {
      latest: { id: "t1", state: "completed", completed: true },
    }).turns;
    expect(
      only!.stretches.map((stretch) => [
        stretch.key,
        stretch.aside,
        stretch.entries.map((entry) => entry.id),
      ]),
    ).toEqual([
      ["msg:m0", false, ["w1", "a1"]],
      ["msg:m1", true, ["w2"]],
      ["msg:m2", true, ["a2", "a3"]],
    ]);
    // A stretch cut by a message ends where the message was sent.
    expect(only!.stretches[0]!.endedAt).toBe(at(3));
    expect(only!.stretches[1]!.endedAt).toBe(at(5));
    expect(only!.answer?.id).toBe("a3");
  });

  it("keeps the running turn's last stretch live and names no answer yet", () => {
    const entries = [
      user("m0", 0),
      tool("w1", "t1", 1),
      assistant("a1", "t1", 2, "Checking the build."),
      user("m1", 3),
      assistant("a2", "t1", 4, "Still going.", { streaming: true }),
    ];
    const [only] = structure(entries, { live: "t1" }).turns;
    expect(only!.live).toBe(true);
    expect(only!.answer).toBeNull();
    expect(only!.stretches.map((stretch) => stretch.live)).toEqual([false, true]);
    expect(only!.stretches[1]!.endedAt).toBeNull();
    expect(stretchNotes(only!.stretches[1]!, only!.answer).map((note) => note.id)).toEqual(["a2"]);
  });

  it("gives messages sent back to back a stretch each, the empty one included", () => {
    const entries = [user("m1", 0), user("m2", 1), tool("w1", "t1", 2), assistant("a1", "t1", 3)];
    const [only] = structure(entries, {
      latest: { id: "t1", state: "completed", completed: true },
    }).turns;
    expect(only!.stretches.map((stretch) => [stretch.key, stretch.entries.length])).toEqual([
      ["msg:m1", 0],
      ["msg:m2", 2],
    ]);
  });

  it("holds a live stretch for a message the server has not opened a turn for yet", () => {
    const entries = [user("m0", 0)];
    const result = structure(entries, { working: true });
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]!.stretches).toEqual([
      expect.objectContaining({ key: "msg:m0", live: true, turnId: null }),
    ]);
  });

  it("keeps a turn live whose words arrive before the session names it", () => {
    // A finished background task wakes the Mate: the thread works, the
    // session names no running turn yet and the latest turn is the one that
    // finished — but the new turn's first words already carry its id.
    const result = structure(
      [
        user("m0", 0),
        assistant("a1", "t1", 1, "Started it."),
        assistant("a2", "t2", 70, "It printed done."),
      ],
      { latest: { id: "t1", state: "completed", completed: true }, working: true },
    );
    const last = result.turns.at(-1)!;
    expect(last).toMatchObject({ turnId: turn("t2"), live: true, answer: null });
    expect(result.turns[0]).toMatchObject({ live: false });

    // Working right after the person wrote is their message's turn, never the
    // one that finished before it.
    const sent = structure([user("m0", 0), assistant("a1", "t1", 1, "Done."), user("m1", 70)], {
      latest: { id: "t0", state: "completed", completed: true },
      working: true,
    });
    expect(sent.turns.find((candidate) => candidate.turnId === turn("t1"))).toMatchObject({
      live: false,
    });
  });

  it("reads a turn a usage limit refused as limit-only, with its reset", () => {
    const entries = [
      user("m0", 0),
      assistant("a1", "t1", 48, "You've hit your session limit · resets 9:20pm (UTC)"),
    ];
    const [only] = structure(entries, {
      latest: { id: "t1", state: "completed", completed: true },
    }).turns;
    expect(only!.limitOnly).toBe(true);
    expect(only!.limit).toEqual({
      resetsAt: new Date(Date.UTC(2026, 8, 24, 21, 20)).toISOString(),
    });
  });

  it("does not call a turn that worked and then hit the limit limit-only", () => {
    const entries = [
      user("m0", 0),
      tool("w1", "t1", 1),
      assistant("a1", "t1", 48, "You've hit your session limit · resets 9:20pm (UTC)"),
    ];
    const [only] = structure(entries, {
      latest: { id: "t1", state: "completed", completed: true },
    }).turns;
    expect(only!.limitOnly).toBe(false);
    expect(only!.limit).not.toBeNull();
  });

  it("marks the latest turn the person stopped", () => {
    const entries = [user("m0", 0), tool("w1", "t1", 1)];
    const [only] = structure(entries, {
      latest: { id: "t1", state: "interrupted", completed: true },
    }).turns;
    expect(only!.interrupted).toBe(true);
  });

  const plan = (id: string, turnId: string, minute: number): TimelineEntry => ({
    id,
    kind: "proposed-plan",
    createdAt: at(minute),
    proposedPlan: {
      id: id as Extract<TimelineEntry, { kind: "proposed-plan" }>["proposedPlan"]["id"],
      turnId: turn(turnId),
      planMarkdown: "1. Add the route.",
      implementedAt: null,
      implementationThreadId: null,
      createdAt: at(minute),
      updatedAt: at(minute),
    },
  });
  // Only the latest turn carries the server's word on how it ended: a stopped
  // turn read "stopped after 40s" until the next one began, then "worked for
  // 40s" (Nova, 2026-09-26). A turn that ended on a step, not a word, was
  // cut off — whichever turn is the latest.
  it.each([
    { name: "on a step", tail: [tool("w1", "t1", 1)], interrupted: true },
    {
      name: "on a thought",
      tail: [tool("w1", "t1", 1), reasoning("r1", "t1", 2)],
      interrupted: true,
    },
    {
      name: "on a word after its last step",
      tail: [tool("w1", "t1", 1), assistant("a1", "t1", 2, "Done.")],
      interrupted: false,
    },
    {
      name: "on a step after its words",
      tail: [assistant("a1", "t1", 1, "Checking."), tool("w1", "t1", 2)],
      interrupted: true,
    },
    {
      name: "on an error",
      tail: [tool("w1", "t1", 1, { tone: "error", label: "Runtime error" })],
      interrupted: false,
    },
    // A plan the Mate proposes ends its turn by design; a compaction is the
    // harness condensing the context, a /compact's whole turn.
    {
      name: "on a plan it proposed",
      tail: [tool("w1", "t1", 1), plan("p1", "t1", 2)],
      interrupted: false,
    },
    {
      name: "on a compaction",
      tail: [
        tool("c1", "t1", 1, {
          tone: "info",
          label: "Compacted context",
          sourceActivityKind: "context-compaction",
        }),
      ],
      interrupted: false,
    },
  ])(
    "tells a turn that ended $name as stopped or not, before the next one",
    ({ tail, interrupted }) => {
      const entries = [user("m0", 0), ...tail, user("m1", 10), assistant("a2", "t2", 11, "Hi.")];
      const [first] = structure(entries, {
        latest: { id: "t2", state: "completed", completed: true },
      }).turns;
      expect(first!.interrupted).toBe(interrupted);
    },
  );

  // A turn's span ends where its entries did — the same while it is the
  // latest and once another followed; "worked for 1m 16s" read "1m 20s" once
  // the next turn began, "1m 13s" read "1m 12s".
  it("ends a settled turn where its entries did, the latest or not", () => {
    const first = [user("m0", 0), tool("w1", "t1", 1), assistant("a1", "t1", 3, "Done.")];
    const alone = structure(first, { latest: { id: "t1", state: "completed", completed: true } });
    const followed = structure([...first, user("m1", 30), assistant("a2", "t2", 31, "Hi.")], {
      latest: { id: "t2", state: "completed", completed: true },
    });
    expect(alone.turns[0]!.stretches.at(-1)!.endedAt).toBe(
      followed.turns[0]!.stretches.at(-1)!.endedAt,
    );
  });

  it("leaves a message no turn took loose, and places a landing inside the turn it fell in", () => {
    const entries = [
      user("m0", 0),
      tool("w1", "t1", 1),
      landed("l1", 2),
      assistant("a1", "t1", 3),
      user("m1", 10),
    ];
    const result = structure(entries, {
      latest: { id: "t1", state: "completed", completed: true },
    });
    expect([...result.looseIndexes]).toEqual([4]);
    expect(result.stretchByIndex.get(2)?.key).toBe("msg:m0");
  });
});

describe("messageReceipt", () => {
  it("reads seen once the turn produced anything after the message, sent before", () => {
    const entries = [user("m0", 0), tool("w1", "t1", 1), user("m1", 2)];
    const result = structure(entries, { live: "t1" });
    const message = (index: number) =>
      (entries[index] as Extract<TimelineEntry, { kind: "message" }>).message;
    expect(messageReceipt(message(0), result, 0)).toBe("seen");
    expect(messageReceipt(message(2), result, 2)).toBe("sent");
  });

  it("reads a loose message as sent", () => {
    const entries = [user("m0", 0)];
    const result = structure(entries, {});
    expect(
      messageReceipt(
        (entries[0] as Extract<TimelineEntry, { kind: "message" }>).message,
        result,
        0,
      ),
    ).toBe("sent");
  });
});

describe("summarizeActivity", () => {
  it("says what the calls did in one fixed order", () => {
    const entry = (overrides: Parameters<typeof tool>[3], noCommand = false) => {
      const { command: _command, ...rest } = (
        tool("x", "t1", 0, overrides) as Extract<TimelineEntry, { kind: "work" }>
      ).entry;
      return noCommand ? rest : { ...rest, command: "pnpm test" };
    };
    expect(
      summarizeActivity([
        entry({ requestKind: "file-read" }, true),
        entry({}),
        entry({ changedFiles: ["a.ts", "b.ts"] }, true),
        entry({ changedFiles: ["a.ts"] }, true),
        entry({ itemType: "mcp_tool_call" }, true),
        entry({ requestKind: "file-read" }, true),
      ]),
    ).toBe("Edited 2 files · ran 1 command · read 2 files · used 1 tool");
  });

  // A tool the runtime names only in its detail is said by its name: "used 1
  // tool" over a Workflow call hid what the Mate did.
  it.each([
    { details: ["Workflow: {}"], summary: "Used Workflow" },
    { details: ["Workflow: {}", "Workflow: {}"], summary: "Used Workflow twice" },
    { details: ["Workflow: {}", "Workflow: {}", "Workflow: {}"], summary: "Used Workflow 3 times" },
    { details: ["Workflow: {}", "SendMessage: {}"], summary: "Used Workflow and SendMessage" },
    {
      details: ["Workflow: {}", "SendMessage: {}", "Skill: {}"],
      summary: "Used 3 tools",
    },
    { details: ["Workflow: {}", "not a name"], summary: "Used 2 tools" },
  ])("$summary", ({ details, summary }) => {
    const call = (detail: string) =>
      (
        tool("x", "t1", 0, {
          label: "Tool call",
          itemType: "dynamic_tool_call",
          detail,
        }) as Extract<TimelineEntry, { kind: "work" }>
      ).entry;
    const entries = details.map((detail) => {
      const { command: _command, ...rest } = call(detail);
      return rest;
    });
    expect(summarizeActivity(entries)).toBe(summary);
  });
});

describe("summarizeActivity, the Zerops tools", () => {
  // A Zerops tool with no card of its own is said by what it did; any other
  // connected tool by its own title.
  const mcp = (label: string, toolTitle: string) => {
    const { command: _command, ...rest } = (
      tool("x", "t1", 0, { label, toolTitle, itemType: "mcp_tool_call" }) as Extract<
        TimelineEntry,
        { kind: "work" }
      >
    ).entry;
    return rest;
  };
  it.each([
    { entries: [mcp("zerops_workflow", "Workflow")], summary: "Checked the workflow" },
    {
      entries: [mcp("zerops_workflow", "Workflow"), mcp("zerops_workflow", "Workflow")],
      summary: "Checked the workflow",
    },
    { entries: [mcp("zerops_knowledge", "Knowledge")], summary: "Read the Zerops guides" },
    {
      entries: [mcp("zerops_workflow", "Workflow"), mcp("figma_get", "Figma")],
      summary: "Checked the workflow · used Figma",
    },
  ])("$summary", ({ entries, summary }) => {
    expect(summarizeActivity(entries)).toBe(summary);
  });
});

describe("noteLine", () => {
  it.each([
    ["**Deployed.** Checking `appstage` next.", "Deployed. Checking appstage next."],
    ["## Plan\n\n- first\n- second", "Plan"],
    ["> [!WARNING]\n> The build is broken", "The build is broken"],
    ["See [the preview](https://x.dev/a?b=1).", "See the preview."],
  ])("%j", (text, expected) => {
    expect(noteLine(text)).toBe(expected);
  });
});

describe("stretchFace", () => {
  const settled = { latest: { id: "t1", state: "completed", completed: true } } as const;
  it.each([
    [
      "produced",
      [user("m0", 0), operation("d1", "t1", 1, { kind: "deploy" }), assistant("a1", "t1", 5)],
    ],
    [
      "failed",
      [
        user("m0", 0),
        operation("d1", "t1", 1, { kind: "deploy", phase: "failed", statusWord: "Failed" }),
        assistant("a1", "t1", 5),
      ],
    ],
    [
      "produced",
      [
        user("m0", 0),
        operation("d1", "t1", 1, { kind: "deploy", phase: "failed", statusWord: "Failed" }),
        operation("d2", "t1", 3, { kind: "deploy" }),
        assistant("a1", "t1", 5),
      ],
    ],
    ["idle", [user("m0", 0), tool("w1", "t1", 1), assistant("a1", "t1", 5)]],
  ] as const)("%s", (face, entries) => {
    const [only] = structure([...entries], settled).turns;
    expect(stretchFace({ stretch: only!.stretches[0]!, turn: only!, pausedHere: false })).toBe(
      face,
    );
  });
});

describe("browser checks", () => {
  it.each([
    ["https://shop.example.com/cz/products/%C5%A1umava?q=1.5&res=.5", "/cz/products/šumava"],
    ["https://shop.example.com/", "/"],
    ["shop.example.com/cart", "/cart"],
    ["the checkout page", "the checkout page"],
  ])("captions %j as %j", (subject, caption) => {
    const entry = operation("b1", "t1", 1, { kind: "browser", subject }) as Extract<
      TimelineEntry,
      { kind: "operation" }
    >;
    expect(browserCheckCaption(entry.operation)).toBe(caption);
  });

  it("says why a check failed", () => {
    const timedOut = operation("b1", "t1", 1, {
      kind: "browser",
      phase: "failed",
      closing: "Navigation timeout of 30000 ms exceeded.",
    }) as Extract<TimelineEntry, { kind: "operation" }>;
    expect(browserCheckFailure(timedOut.operation)).toBe("timed out, the page never loaded");
  });

  it("counts a check that failed and then passed on the same page as passed", () => {
    // The Mate asked for a device agent-browser does not know, then took the
    // same page on one it does: the page never failed.
    const entries = [
      user("m0", 0),
      operation("b1", "t1", 1, {
        kind: "browser",
        subject: "https://a.dev/",
        phase: "failed",
        deviceName: "iPhone 13",
      }),
      operation("b2", "t1", 2, {
        kind: "browser",
        subject: "https://a.dev/",
        deviceName: "iPhone 16",
      }),
      operation("b3", "t1", 3, { kind: "browser", subject: "https://b.dev/" }),
      assistant("a1", "t1", 4),
    ];
    const [only] = structure(entries, {
      latest: { id: "t1", state: "completed", completed: true },
    }).turns;
    // Two hosts' front pages are two pages, both captioned "/".
    expect(browserStrip(only!.stretches[0]!)).toMatchObject({ views: 2, failures: 0 });
    expect(deriveOutcome({ turn: only!, landed: [], diff: null })?.checks).toMatchObject({
      count: 3,
      views: 2,
      failures: 0,
    });
  });

  // A take drawn red with a ✗ under a heading saying "all passed" said two
  // things at once (Nova, 2026-09-26: iPhone 13 refused, retaken on iPhone 16).
  it("tells each take how it ended: a failure the same page passed later is a retry", () => {
    const checks = [
      operation("b1", "t1", 1, {
        kind: "browser",
        subject: "https://a.dev/",
        phase: "failed",
        deviceName: "iPhone 13",
      }),
      operation("b2", "t1", 2, { kind: "browser", subject: "https://a.dev/" }),
      operation("b3", "t1", 3, { kind: "browser", subject: "https://a.dev/cart", phase: "failed" }),
      operation("b4", "t1", 4, {
        kind: "browser",
        subject: "https://a.dev/cart",
        phase: "running",
      }),
    ].map((entry) => (entry as Extract<TimelineEntry, { kind: "operation" }>).operation);
    expect(checks.map((check) => browserTakeState(check, checks))).toEqual([
      "retried",
      "passed",
      "failed",
      "running",
    ]);
  });

  it("gathers a stretch's checks into one strip", () => {
    const entries = [
      user("m0", 0),
      operation("b1", "t1", 1, { kind: "browser", subject: "https://a.dev/" }),
      tool("w1", "t1", 2),
      operation("b2", "t1", 3, { kind: "browser", subject: "https://a.dev/cart" }),
      operation("b3", "t1", 4, { kind: "browser", subject: "https://a.dev/cart", phase: "failed" }),
      assistant("a1", "t1", 5),
    ];
    const [only] = structure(entries, {
      latest: { id: "t1", state: "completed", completed: true },
    }).turns;
    expect(browserStrip(only!.stretches[0]!)).toMatchObject({
      key: "strip:op:b1",
      views: 2,
      failures: 1,
      live: false,
    });
  });
});

describe("stretchIncidents", () => {
  it("tells a service that stopped answering and came back as one line", () => {
    const entries = [
      user("m0", 0),
      operation("s0", "t1", 1, {
        kind: "devServer",
        subject: "nextstoredev",
        statusWord: "Running",
        steps: [{ id: "dev-server", label: "Start", state: "done", stateLabel: "Done" }],
      }),
      operation("s1", "t1", 2, {
        kind: "devServer",
        subject: "nextstoredev",
        statusWord: "Not running",
        steps: [
          {
            id: "dev-server",
            label: "Health check",
            state: "failed",
            stateLabel: "Failed",
            note: "HTTP 502",
          },
        ],
      }),
      operation("s2", "t1", 3, {
        kind: "devServer",
        subject: "nextstoredev",
        statusWord: "Running",
        steps: [{ id: "dev-server", label: "Restart", state: "done", stateLabel: "Done" }],
      }),
      assistant("a1", "t1", 5),
    ];
    const [only] = structure(entries, {
      latest: { id: "t1", state: "completed", completed: true },
    }).turns;
    expect(stretchIncidents(only!.stretches[0]!)).toEqual([
      {
        key: "incident:op:s1",
        hostname: "nextstoredev",
        phases: ["stopped answering (502)", "restarted", "running again"],
        tone: "ok",
        appearedAt: at(2, 30),
      },
    ]);
  });

  it("is no incident when a dev server simply starts", () => {
    const entries = [
      user("m0", 0),
      operation("s0", "t1", 1, {
        kind: "devServer",
        subject: "nextstoredev",
        statusWord: "Running",
        steps: [{ id: "dev-server", label: "Start", state: "done", stateLabel: "Done" }],
      }),
    ];
    const [only] = structure(entries, { live: "t1" }).turns;
    expect(stretchIncidents(only!.stretches[0]!)).toEqual([]);
  });
});

describe("deriveOutcome", () => {
  const settled = { latest: { id: "t1", state: "completed", completed: true } } as const;
  const diff = (files: number): TurnDiffSummary =>
    ({
      turnId: turn("t1"),
      checkpointTurnCount: 1,
      checkpointRef: "ref" as TurnDiffSummary["checkpointRef"],
      status: "ready",
      files: Array.from({ length: files }, (_, index) => ({
        path: `src/file${index}.ts`,
        kind: "modified",
        additions: 10,
        deletions: 2,
      })),
      assistantMessageId: null,
      completedAt: at(9),
    }) as TurnDiffSummary;

  it("lists each service once with its final state and keeps a recovered failure as history", () => {
    const entries = [
      user("m0", 0),
      operation("d1", "t1", 1, {
        kind: "deploy",
        subject: "medusastage",
        version: { name: "a687dbd1234567890" },
        links: [{ label: "Open", url: "https://medusastage.example.dev" }],
      }),
      operation("v1", "t1", 2, {
        kind: "verify",
        subject: "medusastage",
        phase: "failed",
        statusWord: "Checks failed",
        explanation: { reason: "HTTP internal 403" },
      }),
      operation("d2", "t1", 3, { kind: "deploy", subject: "medusastage" }),
      operation("v2", "t1", 4, { kind: "verify", subject: "medusastage", statusWord: "Healthy" }),
      landed("l1", 5),
      operation("b1", "t1", 6, { kind: "browser", subject: "https://medusastage.example.dev/" }),
      operation("x1", "t1", 7, { kind: "delete", subject: "oldtier", statusWord: "Deleted" }),
      assistant("a1", "t1", 8),
    ];
    const result = structure(entries, settled);
    const [only] = result.turns;
    const outcome = deriveOutcome({
      turn: only!,
      landed: [entries[5] as Extract<TimelineEntry, { kind: "change-landed" }>],
      diff: diff(3),
    });
    expect(outcome).toEqual({
      key: "outcome:msg:m0",
      turnKey: "msg:m0",
      live: [
        {
          hostname: "medusastage",
          tone: "ok",
          word: "Healthy",
          version: null,
          url: "https://medusastage.example.dev",
          recovered: "First check failed: HTTP internal 403. It came back after that.",
        },
      ],
      landed: [{ key: "landed:l1", line: "titandev #17", title: "Draw distance" }],
      files: { count: 3, additions: 30, deletions: 6, turnId: turn("t1") },
      checks: {
        count: 1,
        views: 1,
        failures: 0,
        takes: [expect.objectContaining({ kind: "browser" })],
      },
      created: [],
      removed: ["oldtier"],
      notDone: [],
    });
  });

  it("has nothing to say for a turn that produced nothing, or one a limit refused", () => {
    const quiet = structure(
      [user("m0", 0), tool("w1", "t1", 1), assistant("a1", "t1", 2)],
      settled,
    );
    expect(deriveOutcome({ turn: quiet.turns[0]!, landed: [], diff: null })).toBeNull();
    const refused = structure(
      [
        user("m0", 0),
        assistant("a1", "t1", 1, "You've hit your session limit · resets 9:20pm (UTC)"),
      ],
      settled,
    );
    expect(deriveOutcome({ turn: refused.turns[0]!, landed: [], diff: diff(2) })).toBeNull();
  });

  it("reports checks alone, with every take: the report is where a settled turn's checks are seen", () => {
    const entries = [
      user("m0", 0),
      operation("b1", "t1", 1, { kind: "browser", subject: "https://shop.dev/" }),
      assistant("a1", "t1", 2),
    ];
    expect(
      deriveOutcome({ turn: structure(entries, settled).turns[0]!, landed: [], diff: null }),
    ).toMatchObject({
      checks: {
        count: 1,
        views: 1,
        failures: 0,
        takes: [expect.objectContaining({ kind: "browser" })],
      },
    });
  });

  it("reports each service a batch deployed, in its own state", () => {
    const entries = [
      user("m0", 0),
      operation("d1", "t1", 1, {
        kind: "deploy",
        batch: true,
        subject: "apistage, webstage",
        phase: "failed",
        statusWord: "Failed",
        steps: [
          { id: "apistage", label: "apistage", state: "done", stateLabel: "Done" },
          {
            id: "webstage",
            label: "webstage",
            state: "failed",
            stateLabel: "Failed",
            note: "Build failed",
          },
        ],
      }),
      assistant("a1", "t1", 2),
    ];
    const outcome = deriveOutcome({
      turn: structure(entries, settled).turns[0]!,
      landed: [],
      diff: null,
    });
    expect(outcome?.live).toEqual([
      expect.objectContaining({ hostname: "apistage", tone: "ok", word: "Deployed" }),
      expect.objectContaining({ hostname: "webstage", tone: "failed", word: "Failed" }),
    ]);
  });

  it("names what could not be done", () => {
    const entries = [
      user("m0", 0),
      operation("i1", "t1", 1, {
        kind: "import",
        subject: "gitea",
        phase: "failed",
        voice: "Importing gitea",
        statusWord: "Import failed",
        explanation: { reason: "Gitea isn't connected yet." },
      }),
      assistant("a1", "t1", 2),
    ];
    const outcome = deriveOutcome({
      turn: structure(entries, settled).turns[0]!,
      landed: [],
      diff: null,
    });
    expect(outcome?.notDone).toEqual(["Importing gitea: Gitea isn't connected yet"]);
  });
});

describe("splitBatchDeploy", () => {
  const step = (host: string, state: "queued" | "running" | "done" | "failed", note?: string) => ({
    id: host,
    label: host,
    state,
    stateLabel: state,
    ...(note === undefined ? {} : { note }),
  });
  const deploy = (overrides: Parameters<typeof operation>[3]) =>
    (operation("d1", "t1", 1, overrides) as Extract<TimelineEntry, { kind: "operation" }>)
      .operation;

  it.each([
    {
      name: "one deploy per service while the batch runs, each in its own state",
      batch: deploy({
        kind: "deploy",
        batch: true,
        subject: "apistage, webstage",
        phase: "running",
        statusWord: "Deploying",
        settledAt: undefined as never,
        steps: [step("apistage", "running"), step("webstage", "queued")],
      }),
      services: [
        ["op:d1:apistage", "apistage", "running", "Deploying"],
        ["op:d1:webstage", "webstage", "running", "Waiting"],
      ],
    },
    {
      name: "settled: the one that deployed, and the one that failed with its reason",
      batch: deploy({
        kind: "deploy",
        batch: true,
        subject: "apistage, webstage",
        phase: "failed",
        statusWord: "Failed",
        steps: [step("apistage", "done"), step("webstage", "failed", "Build failed")],
      }),
      services: [
        ["op:d1:apistage", "apistage", "done", "Deployed"],
        ["op:d1:webstage", "webstage", "failed", "Failed"],
      ],
    },
    {
      name: "a deploy of one service is itself",
      batch: deploy({ kind: "deploy", subject: "appdev" }),
      services: [["op:d1", "appdev", "done", "Deployed"]],
    },
  ])("$name", ({ batch, services }) => {
    const split = splitBatchDeploy(batch);
    expect(split.map((op) => [op.key, op.subject, op.phase, op.statusWord])).toEqual(services);
    // Each is a service's own deploy: named by it, observed by its hostname.
    for (const op of split) {
      expect(op.batch).toBeUndefined();
      expect(op.target).toEqual({ hostname: op.subject });
    }
    const failed = split.find((op) => op.phase === "failed");
    if (failed !== undefined) expect(failed.explanation).toEqual({ reason: "Build failed" });
  });
});

describe("tool calls in words", () => {
  it.each([
    [
      { itemType: "dynamic_tool_call", label: "Tool call", detail: 'AskUserQuestion: {"q":1}' },
      "AskUserQuestion",
    ],
    [{ itemType: "dynamic_tool_call", label: "Tool call", detail: "WebFetch: {}" }, "WebFetch"],
    [{ itemType: "dynamic_tool_call", label: "Tool call", detail: "no name here" }, null],
    [
      { itemType: "collab_agent_tool_call", label: "Subagent task", detail: "ListAgents: {}" },
      "ListAgents",
    ],
    [{ itemType: "command_execution", label: "Ran command", detail: "Foo: {}" }, null],
  ] as const)("names the tool a generic call ran: %j → %s", (entry, name) => {
    expect(namedToolCall(entry)).toBe(name);
  });

  it.each([
    ['Read: {"file_path":"/var/www/appdev/package.json"}', "Reading package.json"],
    ['Edit: {"file_path":"/var/www/appdev/src/status.ts","old_string":"a"', "Editing status.ts"],
    ['Write: {"file_path":"/var/www/appdev/README.md"}', "Writing README.md"],
    ['Grep: {"pattern":"TODO"}', "Searching the code"],
    ['Glob: {"pattern":"**/*.ts"}', "Looking for files"],
  ])("says a file call by its file: %s → %j", (detail, words) => {
    const name = namedToolCall({ itemType: "dynamic_tool_call", label: "Tool call", detail })!;
    expect(toolCallWords(name, detail)).toBe(words);
  });

  it("counts the calls a runtime names only in their details by what they did", () => {
    const call = (name: string, args: string) => ({
      id: name,
      createdAt: at(1),
      label: "Tool call",
      tone: "tool" as const,
      itemType: "dynamic_tool_call" as const,
      detail: `${name}: ${args}`,
    });
    expect(
      summarizeActivity([
        call("Read", '{"file_path":"/a/package.json"}'),
        call("Read", '{"file_path":"/a/README.md"}'),
        call("Grep", '{"pattern":"x"}'),
      ]),
    ).toBe("Read 2 files · searched the code once");
  });

  it.each([
    ["AskUserQuestion", "Waiting for your answer"],
    ["WebFetch", "Reading a web page"],
    ["WebSearch", "Searching the web"],
    ["Task", "Starting a helper"],
    ["Agent", "Starting a helper"],
    ["Skill", "Using a skill"],
    ["ToolSearch", "Looking up a tool"],
    ["SomeNewTool", "Using some new tool"],
  ])("says %s as %j, never its arguments", (name, words) => {
    expect(toolCallWords(name)).toBe(words);
  });
});
