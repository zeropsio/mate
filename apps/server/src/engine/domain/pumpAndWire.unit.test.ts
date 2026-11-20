import { assert, expect, it } from "@effect/vitest";
import {
  ConversationId,
  ENGINE_WIRE_BUDGETS,
  itemId,
  runId,
  type Item,
  type ItemBody,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import { makeSendLanes } from "../../sendLanes.ts";
import { makeLiveBus } from "../LiveBus.ts";
import { originAskOfCall, originSettledOfCall } from "../pump/originAsk.ts";
import { vaultAskOfCall, vaultStoredOfCall } from "../pump/vaultAsk.ts";
import {
  bytesOf,
  changesFrames,
  cutUtf8,
  fitItem,
  frameSizer,
  liveFrames,
} from "../wire/budget.ts";

const URL = "https://github.com/zeropsio/mate";

/** A finished zcp call whose answer is `answer`, written as JSON. */
function originCall(answer: unknown, toolName = "zerops_origin"): ItemBody {
  return {
    kind: "call",
    step: "mcp",
    tool: { name: toolName, server: "zerops" },
    words: null,
    state: "done",
    endedAt: 1,
    result: { toolName, resultText: JSON.stringify(answer) },
  };
}

function originRequested(origin: Record<string, unknown>) {
  return { requested: { origin }, nextActions: "Now waiting on the person." };
}

/** A finished `zerops_env` call with this result text (none when over the limit). */
function envCall(
  resultText: string | undefined,
  patch: Partial<Extract<ItemBody, { kind: "call" }>> = {},
): ItemBody {
  return {
    kind: "call",
    step: "mcp",
    tool: { name: "zerops_env", server: "zerops" },
    words: null,
    state: "done",
    endedAt: 1,
    result: { toolName: "zerops_env", ...(resultText === undefined ? {} : { resultText }) },
    ...patch,
  };
}

function envRequested(fields: Record<string, unknown>) {
  return JSON.stringify({ requested: fields, nextActions: "Now waiting on the person." });
}

function envStored(fields: Record<string, unknown>) {
  return JSON.stringify({ process: { id: "p1", status: "FINISHED" }, ...fields });
}

const conversation = ConversationId.make("mate");
const run = runId(conversation, 1);

function note(n: number, text: string): Item {
  return {
    id: itemId(run, n),
    conversationId: conversation,
    runId: run,
    seq: n,
    rev: n,
    at: 1,
    by: { kind: "mate" },
    kind: "note",
    text,
    streaming: false,
    answer: false,
  };
}

function itemCall(n: number, fields: Record<string, unknown>): Item {
  return {
    id: itemId(run, n),
    conversationId: conversation,
    runId: run,
    seq: n,
    rev: n,
    at: 1,
    by: { kind: "mate" },
    kind: "call",
    step: "mcp",
    tool: { name: "zerops_deploy", server: "zerops" },
    words: null,
    state: "done",
    endedAt: 2,
    ...fields,
  } as Item;
}

// witness: apps/server/src/engine/pump/originAsk.ts | if (url === null || typeof repo !== "string" || !REPO_NAME.test(repo)) return null; → if (url === null) return null;
it("ED115: A zcp call that asks the person to connect an origin opens an ask only from `zerops_origin`, for an https address without credentials and an HQ repository name, its why trimmed or none; an origin already connected asks nothing", () => {
  const rows: ReadonlyArray<readonly [ItemBody, unknown]> = [
    [
      originCall(originRequested({ url: URL, repo: "appdev", why: " Deliver work back. " })),
      { kind: "origin", url: URL, repo: "appdev", reason: "Deliver work back." },
    ],
    [
      originCall(originRequested({ url: URL, repo: "appdev" })),
      { kind: "origin", url: URL, repo: "appdev", reason: null },
    ],
    [originCall({ connected: { origin: { url: URL, repo: "appdev" } } }), null],
    [originCall(originRequested({ url: "https://x:tok@github.com/a/b", repo: "appdev" })), null],
    [originCall(originRequested({ url: "git@github.com:a/b.git", repo: "appdev" })), null],
    [originCall(originRequested({ url: URL })), null],
    [originCall(originRequested({ url: URL, repo: "appdev" }), "zerops_env"), null],
  ];
  for (const [body, ask] of rows) expect(originAskOfCall(body)).toEqual(ask);
});

// witness: apps/server/src/engine/pump/originAsk.ts | if (how === "connected" && repo === null) return null; → if (how === "withdrawn" && repo === null) return null;
it("ED116: An origin ask needs the person no more when zcp answers the asked repository connected or withdrawn, a withdrawal naming no repository settling every ask of the address, while a connected answer naming no asked repository, a standing ask or an address that is not https settles none", () => {
  const rows: ReadonlyArray<readonly [ItemBody, unknown]> = [
    [
      originCall({ connected: { origin: { url: URL, repo: "appdev" }, repo: "app" } }),
      { url: URL, how: "connected", repo: "appdev" },
    ],
    [originCall({ connected: { origin: { url: URL }, repo: "app" } }), null],
    [
      originCall({ withdrawn: { origin: { url: URL, repo: "appdev" } } }),
      { url: URL, how: "withdrawn", repo: "appdev" },
    ],
    [originCall({ withdrawn: { origin: { url: URL } } }), { url: URL, how: "withdrawn" }],
    [originCall(originRequested({ url: URL, repo: "appdev" })), null],
    [originCall({ withdrawn: { origin: { url: "git@github.com:a/b.git" } } }), null],
    [originCall({ connected: { origin: { url: URL, repo: "appdev" } } }, "zerops_env"), null],
  ];
  for (const [body, settled] of rows) expect(originSettledOfCall(body)).toEqual(settled);
});

// witness: apps/server/src/engine/pump/vaultAsk.ts | if (typeof key !== "string" || !ENV_KEY.test(key) || typeof sensitive !== "boolean") return null; → if (typeof key !== "string" || typeof sensitive !== "boolean") return null;
it("ED117: A value zcp asks the person for opens an ask only from a finished `zerops_env` call naming a key a vault takes, whether it is sensitive, and its vault, Shared or a named service's own, with the why it gives trimmed and the label it names; any other call or answer asks nothing", () => {
  const asks: ReadonlyArray<readonly [ItemBody, unknown]> = [
    [
      envCall(
        envRequested({
          key: "STRIPE_SECRET_KEY",
          reason: "Stripe charges cards.",
          scope: "shared",
          sensitive: true,
        }),
      ),
      {
        kind: "vault",
        key: "STRIPE_SECRET_KEY",
        scope: { kind: "shared" },
        sensitive: true,
        reason: "Stripe charges cards.",
      },
    ],
    [
      envCall(
        envRequested({
          key: "SUPPORT_EMAIL",
          reason: "Where replies come from.",
          scope: "service",
          serviceHostname: "api",
          sensitive: false,
        }),
      ),
      {
        kind: "vault",
        key: "SUPPORT_EMAIL",
        scope: { kind: "service", hostname: "api" },
        sensitive: false,
        reason: "Where replies come from.",
      },
    ],
    [
      envCall(
        envRequested({
          key: "STRIPE_SECRET_KEY",
          label: "Stripe secret key",
          why: "for checkout",
          scope: "shared",
          sensitive: true,
        }),
      ),
      {
        kind: "vault",
        key: "STRIPE_SECRET_KEY",
        label: "Stripe secret key",
        scope: { kind: "shared" },
        sensitive: true,
        reason: "for checkout",
      },
    ],
    [
      envCall(envRequested({ key: "API_KEY", scope: "shared", sensitive: true })),
      { kind: "vault", key: "API_KEY", scope: { kind: "shared" }, sensitive: true, reason: null },
    ],
  ];
  for (const [body, ask] of asks) expect(vaultAskOfCall(body)).toEqual(ask);

  const none: ReadonlyArray<ItemBody> = [
    envCall(JSON.stringify({ alreadySet: { key: "API_KEY", scope: "shared", alreadySet: true } })),
    envCall(envRequested({ key: "API_KEY", scope: "shared", sensitive: true }), {
      state: "failed",
    }),
    envCall(envRequested({ key: "API_KEY", scope: "shared", sensitive: true }), {
      result: {
        toolName: "zerops_deploy",
        resultText: envRequested({ key: "API_KEY", scope: "shared", sensitive: true }),
      },
    }),
    envCall(undefined),
    envCall("Error: not found"),
    envCall(envRequested({ key: "API_KEY=sk", scope: "shared", sensitive: true })),
    envCall(envRequested({ key: "API_KEY", scope: "service", sensitive: true })),
    { kind: "note", text: "hi", streaming: false, answer: false } as ItemBody,
  ];
  for (const body of none) expect(vaultAskOfCall(body)).toBeNull();
});

// witness: apps/server/src/engine/pump/vaultAsk.ts | return scope === null || keys.length === 0 ? null : { keys, scope }; → return scope === null ? null : { keys, scope };
it("ED118: A zcp call that stored values names the keys a vault takes and the vault they went to, never their values, and an answer that names no vault or stored no such key stores nothing an ask can match", () => {
  const stores: ReadonlyArray<readonly [ItemBody, unknown]> = [
    [
      envCall(envStored({ stored: [{ key: "STRIPE_SECRET_KEY", value: "***" }], scope: "shared" })),
      { keys: ["STRIPE_SECRET_KEY"], scope: { kind: "shared" } },
    ],
    [
      envCall(
        envStored({
          stored: [
            { key: "SMTP_USER", value: "mail" },
            { key: "SMTP_PASSWORD", value: "***", replaced: true },
          ],
          scope: "service",
          serviceHostname: "api",
        }),
      ),
      { keys: ["SMTP_USER", "SMTP_PASSWORD"], scope: { kind: "service", hostname: "api" } },
    ],
  ];
  for (const [body, values] of stores) expect(vaultStoredOfCall(body)).toEqual(values);

  const none: ReadonlyArray<ItemBody> = [
    envCall(envStored({ stored: [{ key: "API_KEY", value: "***" }] })),
    envCall(envStored({ stored: [{ key: "API_KEY", value: "***" }], scope: "service" })),
    envCall(envRequested({ key: "API_KEY", scope: "shared", sensitive: true })),
    envCall(envStored({ stored: [{ key: "API_KEY", value: "***" }], scope: "shared" }), {
      state: "failed",
    }),
    envCall(undefined, {
      result: {
        toolName: "zerops_deploy",
        resultText: envStored({ stored: [{ key: "API_KEY" }], scope: "shared" }),
      },
    }),
    envCall(envStored({ stored: [], scope: "shared" })),
    envCall(envStored({ stored: [{ key: "API_KEY=sk" }], scope: "shared" })),
  ];
  for (const body of none) expect(vaultStoredOfCall(body)).toBeNull();
});

// witness: apps/server/src/engine/wire/budget.ts | if (total <= ENGINE_WIRE_BUDGETS.itemTextBytes) return fitted; → if (total <= ENGINE_WIRE_BUDGETS.snapshotBytes) return fitted;
it("ED119: The wire carries a call's result over the inline budget cut out of its record, naming the part and its whole length and keeping the rest of the call, and a result within the budget whole", () => {
  const resultText = JSON.stringify({ buildLogs: "x".repeat(ENGINE_WIRE_BUDGETS.itemTextBytes) });
  const fitted = fitItem(
    itemCall(1, { result: { toolName: "zerops_deploy", resultText }, input: "deploy api" }),
  );
  if (fitted.kind !== "call") throw new Error(fitted.kind);
  expect(fitted.result).toEqual({ toolName: "zerops_deploy" });
  expect(fitted.cut).toEqual({ part: "result", total: resultText.length });
  expect(fitted.input).toBe("deploy api");

  const whole = itemCall(1, { result: { toolName: "zerops_deploy", resultText: '{"ok":true}' } });
  expect(fitItem(whole)).toEqual(whole);
});

// witness: apps/server/src/engine/wire/budget.ts | const SHOWS_BYTES = ENGINE_WIRE_BUDGETS.itemBytes / 2; → const SHOWS_BYTES = ENGINE_WIRE_BUDGETS.itemBytes * 2;
it("ED120: What a call's row shows stays within the item's budget, its long input left out first", () => {
  const shows = {
    toolName: "mcp__zerops__zerops_import",
    input: { content: "y".repeat(ENGINE_WIRE_BUDGETS.itemBytes) },
    files: [{ path: "/var/www/zerops.yaml" }],
  };
  const fitted = fitItem(itemCall(1, { shows }));
  if (fitted.kind !== "call") throw new Error(fitted.kind);
  expect(fitted.shows).toEqual({
    toolName: "mcp__zerops__zerops_import",
    files: [{ path: "/var/www/zerops.yaml" }],
  });
  expect(bytesOf(fitted)).toBeLessThanOrEqual(ENGINE_WIRE_BUDGETS.itemBytes);
});

// witness: apps/server/src/engine/wire/budget.ts | return decoder.decode(bytes.subarray(0, max)).replace(/�+$/u, ""); → return decoder.decode(bytes.subarray(0, max));
it("ED121: A message over the inline budget is cut to it, naming the part and its whole length in bytes, never splitting a character, and a message within it goes whole", () => {
  const text = "é".repeat(ENGINE_WIRE_BUDGETS.itemTextBytes);
  const fitted = fitItem(note(1, text));
  if (fitted.kind !== "note") throw new Error(fitted.kind);
  expect(new TextEncoder().encode(fitted.text).length).toBeLessThanOrEqual(
    ENGINE_WIRE_BUDGETS.itemTextBytes,
  );
  expect(fitted.cut).toEqual({ part: "text", total: text.length * 2 });

  expect(fitItem(note(1, "Deployed."))).toEqual(note(1, "Deployed."));

  expect(cutUtf8("aé", 2)).toBe("a");
  expect(cutUtf8("aé", 3)).toBe("aé");
});

// witness: apps/server/src/engine/wire/budget.ts | parts.push({ type: "changes", ...base, to: base.from, ...part }); → parts.push({ type: "changes", ...base, ...part });
it("ED122: Changes over the frame budget go as parts within it that share their start, the cursor moving only with the last part, every record once and in order", () => {
  const items = Array.from({ length: 12 }, (_, n) => note(n + 1, "x".repeat(1_000)));
  const frames = changesFrames(
    { epoch: 2, from: 10, to: 40 },
    { runs: [], items, requests: [] },
    4_000,
  );
  expect(frames.length).toBeGreaterThan(1);
  for (const frame of frames) expect(bytesOf(frame)).toBeLessThanOrEqual(4_000);
  expect(frames.map((frame) => [frame.from, frame.to])).toEqual(
    frames.map((_, index) => [10, index === frames.length - 1 ? 40 : 10]),
  );
  expect(frames.flatMap((frame) => frame.items.map((item) => item.id))).toEqual(
    items.map((item) => item.id),
  );
});

// witness: apps/server/src/engine/wire/budget.ts | offset += chunk.length; → offset = chunk.length;
it("ED123: Streamed text goes in live frames within a live frame's budget, the first opening the stream and each append at its offset, together the whole text", () => {
  const text = "word ".repeat(2_000);
  const frames = liveFrames(itemId(run, 2), "text", text, { open: true }, 4_096);
  expect(frames[0]?.type).toBe("live.open");
  let rebuilt = "";
  for (const frame of frames) {
    expect(bytesOf(frame.text)).toBeLessThanOrEqual(4_096 + 2);
    if (frame.type === "live.append") expect(frame.offset).toBe(rebuilt.length);
    rebuilt += frame.text;
  }
  expect(rebuilt).toBe(text);
});

// witness: apps/server/src/engine/wire/budget.ts | listed: (record: object, length: number) => sizeOf(record) + (length > 1 ? 1 : 0), → listed: (record: object, length: number) => sizeOf(record),
it("ED124: A frame tried at several sizes is counted in the bytes it is written in, and a record left out takes its bytes and its comma with it", () => {
  const frame = (items: ReadonlyArray<Item>) => ({
    type: "snapshot" as const,
    head: 9,
    runs: [],
    items,
    requests: [],
    window: { oldestOrdinal: 1, earlier: true },
  });
  const rows: ReadonlyArray<ReadonlyArray<Item>> = [
    [],
    [note(1, "Done.")],
    [note(1, "Done."), note(2, "Shipped."), note(3, "Green.")],
    [note(1, "Žluťoučký kůň 🐎"), note(2, "日本語")],
    [fitItem(note(1, "x".repeat(40_000)))],
  ];
  for (const items of rows) {
    const sizer = frameSizer();
    expect(sizer.bytesOf(frame(items))).toBe(bytesOf(frame(items)));
    const [first, ...rest] = items;
    if (first === undefined) continue;
    expect(sizer.bytesOf(frame(items)) - sizer.listed(first, items.length)).toBe(
      bytesOf(frame(rest)),
    );
  }
});

// witness: apps/server/src/engine/LiveBus.ts | offset <= before.length ? before.slice(0, offset) + text : before + text, → before + text,
it.effect(
  "ED125: A live subscriber gets the text so far first and then each append as it comes; text sent again at its offset is never doubled, and a closed item's whole text leaves the live plane",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const bus = yield* makeLiveBus();
        yield* bus.append(conversation, "h1.i1", "text", 0, "Hel");
        const frames = yield* bus.subscribe(conversation);
        yield* bus.append(conversation, "h1.i1", "text", 3, "lo");
        const seen = yield* Stream.runCollect(Stream.take(frames, 2));
        assert.deepStrictEqual(seen, [
          { _tag: "Open", items: [{ key: "h1.i1", stream: "text", text: "Hel" }], liveSeq: 1 },
          { _tag: "Append", key: "h1.i1", stream: "text", offset: 3, text: "lo", liveSeq: 2 },
        ]);

        const other = yield* makeLiveBus();
        yield* other.append(conversation, "h1.i1", "text", 0, "Hel");
        yield* other.append(conversation, "h1.i1", "text", 3, "lo");
        yield* other.append(conversation, "h1.i1", "text", 3, "lo");
        assert.strictEqual(yield* other.settle(conversation, "h1.i1"), "Hello");
        const [open] = yield* Stream.runCollect(
          Stream.take(yield* other.subscribe(conversation), 1),
        );
        assert.deepStrictEqual(open, { _tag: "Open", items: [], liveSeq: 3 });
      }),
    ),
);

// witness: apps/server/src/engine/LiveBus.ts | if (frame.liveSeq !== last + 1) return [{ _tag: "Gap" }]; → if (frame.liveSeq < last) return [{ _tag: "Gap" }];
it.effect(
  "ED126: A live subscriber that fell behind its buffer is told it missed frames instead of being handed the frames after the gap",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const bus = yield* makeLiveBus({ buffer: 2 });
        const frames = yield* bus.subscribe(conversation);
        for (let i = 0; i < 5; i++) yield* bus.append(conversation, "h1.i1", "text", i, "x");
        const seen = yield* Stream.runCollect(Stream.take(frames, 2));
        assert.deepStrictEqual(
          seen.map((frame) => frame._tag),
          ["Open", "Gap"],
        );
      }),
    ),
);

// witness: apps/server/src/engine/LiveBus.ts | if (value === null) channel.progress.delete(itemId); → if (value === undefined) channel.progress.delete(itemId);
it.effect(
  "ED127: A call's progress is live under its item, the latest held for a late subscriber until it is cleared",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const bus = yield* makeLiveBus();
        yield* bus.progress(conversation, "mate/r/1/i/2", { phase: "build" });
        const frames = yield* bus.subscribe(conversation);
        yield* bus.progress(conversation, "mate/r/1/i/2", { phase: "deploy" });
        const seen = yield* Stream.runCollect(Stream.take(frames, 2));
        assert.deepStrictEqual(seen, [
          {
            _tag: "Open",
            items: [],
            progress: [{ key: "mate/r/1/i/2", value: { phase: "build" } }],
            liveSeq: 1,
          },
          { _tag: "Progress", key: "mate/r/1/i/2", value: { phase: "deploy" }, liveSeq: 2 },
        ]);
        yield* bus.progress(conversation, "mate/r/1/i/2", null);
        const [open] = yield* Stream.runCollect(Stream.take(yield* bus.subscribe(conversation), 1));
        assert.deepStrictEqual(open, { _tag: "Open", items: [], liveSeq: 3 });
      }),
    ),
);

// witness: apps/server/src/sendLanes.ts | const lane = lanes.get(key) ?? { semaphore: Semaphore.makeUnsafe(1), users: 0 }; → const lane = lanes.get(key) ?? { semaphore: Semaphore.makeUnsafe(2), users: 0 };
it.effect(
  "ED128: Sends on one key run one at a time in the order they were asked, while a send on another key goes on its own",
  () =>
    Effect.gen(function* () {
      const rows = [
        ["thread-a", ["held", "next"]],
        ["thread-b", ["next", "held"]],
      ] as const;
      for (const [nextKey, order] of rows) {
        const lanes = makeSendLanes();
        const done: string[] = [];
        const gate = yield* Deferred.make<void>();
        const held = yield* Effect.forkChild(
          lanes(
            "thread-a",
            Deferred.await(gate).pipe(Effect.andThen(Effect.sync(() => done.push("held")))),
          ),
        );
        yield* Effect.yieldNow;
        const next = yield* Effect.forkChild(
          lanes(
            nextKey,
            Effect.sync(() => done.push("next")),
          ),
        );
        yield* Effect.yieldNow;
        yield* Deferred.succeed(gate, undefined);
        yield* Fiber.join(held);
        yield* Fiber.join(next);
        assert.deepStrictEqual(done, [...order]);
      }
    }),
);
