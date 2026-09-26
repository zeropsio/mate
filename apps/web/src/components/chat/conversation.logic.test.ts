import { describe, expect, it } from "vite-plus/test";

import type { TimelineEntry } from "../../session-logic";
import type { TurnDiffSummary } from "../../types";
import {
  browserCheckCaption,
  browserCheckFailure,
  browserStrip,
  deriveConversationStructure,
  deriveOutcome,
  formatWorkDuration,
  messageReceipt,
  noteLine,
  readSlashCommand,
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

describe("deriveConversationStructure", () => {
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
    ["https://shop.example.com/", "shop.example.com"],
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
