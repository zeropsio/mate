import { expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import {
  ForwardCompatibleUnion,
  ForwardCompatibleUnionArray,
  UnknownUnionMember,
} from "./baseSchemas.ts";
import { UsageIdentity } from "./agentUsage.ts";
import { ConversationId, EngineEvent, ENGINE_EVENT_VERSION, itemId, runId } from "./engine.ts";
import { EngineAnswer, EngineConversationFrame } from "./engineWire.ts";
import { VcsCreateRefInput, VcsCreateWorktreeInput, VcsSwitchRefInput } from "./git.ts";
import { ReviewDiffFileContentsInput, ReviewDiffPreviewInput } from "./review.ts";
import { MateMessage } from "./mateMessage.ts";

/** A decode's value, or the case fails on an assertion (never a thrown parse error) when it failed. */
const decoded = <A>(exit: Exit.Exit<A, unknown>): A => {
  if (Exit.isSuccess(exit)) return exit.value;
  return expect.fail(`expected the value to decode: ${String(exit.cause)}`);
};

const conversation = ConversationId.make("mate");
const run = runId(conversation, 3);

// witness: packages/contracts/src/mateMessage.ts | about: MateMessageAbout, → about: Schema.optionalKey(MateMessageAbout),
it("CT7: A message of kind notice decodes with the change it is about and no sender; an ask or an answer without its sender, and a notice without its change, are refused", () => {
  const decode = Schema.decodeUnknownExit(MateMessage);
  const message = {
    id: "message-1",
    chainId: "chain-1",
    hop: 1,
    kind: "notice",
    about: {
      appId: "app-a",
      repo: "repo",
      number: 7,
      branch: "b",
      head: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      failed: ["github"],
    },
    words:
      "GitHub's checks failed on change #7 (repository repo, branch b): pull request #9 https://github.example/pull/9, commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.\n- build: failure, check run 1, https://github.example/runs/1",
    sentAt: "2026-11-24T00:00:00.000Z",
  };
  expect(decoded(decode(message))).toEqual(message);
  const { failed: _failed, ...withoutFailed } = message.about;
  expect(Exit.isFailure(decode({ ...message, about: withoutFailed }))).toBe(true);
  const { about: _about, ...withoutAbout } = message;
  expect(Exit.isFailure(decode(withoutAbout))).toBe(true);
  for (const kind of ["ask", "answer"]) {
    expect(Exit.isFailure(decode({ ...withoutAbout, kind })), kind).toBe(true);
    const from = { projectId: "project", projectName: "", mateName: "" };
    expect(Exit.isSuccess(decode({ ...withoutAbout, kind, from })), kind).toBe(true);
  }
});

// witness: packages/contracts/src/baseSchemas.ts | (value: string) => !known.has(value) → (value: string) => true
it("CT1: A list or union member from a newer build is dropped or read as unknown, while a known member with a broken payload still fails", () => {
  const at = "2026-10-05T00:00:00.000Z";
  const members = [
    Schema.Struct({
      kind: Schema.Literal("circle"),
      radius: Schema.Number,
      at: Schema.DateTimeUtc,
    }),
    Schema.Struct({ kind: Schema.Literal("square"), side: Schema.Number }),
  ] as const;
  // Clients decode through the JSON wire codec over the runtime schema.
  const union = Schema.decodeUnknownExit(
    Schema.toCodecJson(ForwardCompatibleUnion(members, "kind")),
  );
  const list = Schema.decodeUnknownExit(
    Schema.toCodecJson(ForwardCompatibleUnionArray(members, "kind")),
  );

  expect(decoded(union({ kind: "triangle", corners: 3 }))).toEqual(
    new UnknownUnionMember("kind", "triangle"),
  );
  const circle = decoded(union({ kind: "circle", radius: 1, at }));
  expect(DateTime.isDateTime((circle as { at: unknown }).at)).toBe(true);
  expect(
    decoded(
      list([{ kind: "triangle" }, { kind: "circle", radius: 1, at }, { kind: "square", side: 2 }]),
    ).map((shape) => shape.kind),
  ).toEqual(["circle", "square"]);

  expect(Exit.isFailure(union({ kind: "square", side: "wide" }))).toBe(true);
  expect(Exit.isFailure(list([{ kind: "square", side: "wide" }]))).toBe(true);
});

// witness: packages/contracts/src/engine.ts | if (typeof tag !== "string" || known.has(tag)) return raw → if (typeof tag !== "string") return raw
it("CT2: An engine event from a newer build decodes as Unknown in its place and run, and a known event with a damaged body is refused", () => {
  const decode = Schema.decodeUnknownExit(EngineEvent);
  const header = {
    v: ENGINE_EVENT_VERSION,
    conversationId: "mate",
    seq: 4,
    at: 1_700_000_000_000,
    commandId: "cmd-1",
  };

  expect(
    decoded(decode({ ...header, _tag: "RunTeleported", runId: run, destination: "mars" })),
  ).toMatchObject({
    _tag: "Unknown",
    type: "RunTeleported",
    seq: 4,
    runId: run,
    conversationId: "mate",
  });
  expect(Exit.isFailure(decode({ ...header, _tag: "RunStarted", runId: 42 }))).toBe(true);
});

// witness: packages/contracts/src/engineWire.ts | const ItemRecords = ForwardCompatibleArray(Item); → const ItemRecords = Schema.Array(Item);
it("CT3: An older client reads a newer engine's frame: an unknown record kind keeps its place and a damaged record is dropped alone, never the frame", () => {
  const decode = Schema.decodeUnknownExit(EngineConversationFrame);
  const record = (n: number) => ({
    id: itemId(run, n),
    conversationId: "mate",
    runId: run,
    seq: n,
    rev: n,
    at: 1,
    by: { kind: "mate" },
  });
  const changes = (items: ReadonlyArray<unknown>) => ({
    type: "changes",
    epoch: 3,
    from: 0,
    to: 9,
    runs: [],
    items,
    requests: [],
  });

  expect(
    decoded(
      decode(
        changes([
          { ...record(1), kind: "note", text: "Done.", streaming: false, answer: true },
          { ...record(2), kind: "chart", series: [1, 2, 3], summary: "CPU over the hour" },
        ]),
      ),
    ),
  ).toMatchObject({
    type: "changes",
    items: [
      { kind: "note", seq: 1 },
      { kind: "unknown", type: "chart", seq: 2, summary: "CPU over the hour" },
    ],
  });
  expect(
    decoded(
      decode(
        changes([
          { ...record(1), kind: "note", text: 42, streaming: false, answer: true },
          { ...record(2), kind: "note", text: "Kept.", streaming: false, answer: false },
        ]),
      ),
    ),
  ).toMatchObject({ type: "changes", items: [{ id: itemId(run, 2), text: "Kept." }] });
});

// witness: packages/contracts/src/engineWire.ts | kind: Schema.Literal("secret"), → kind: Schema.Literal("secret"), value: Schema.optionalKey(Schema.String),
it("CT4: A secret's answer on the wire says only how it ended, and a value sent with it never decodes", () => {
  const decode = Schema.decodeUnknownExit(EngineAnswer);
  // Assembled, so no secret-shaped literal sits in the repository.
  const value = ["sk", "_live_", "Q".repeat(16)].join("");

  expect(decoded(decode({ kind: "secret", outcome: "saved", value }))).toEqual({
    kind: "secret",
    outcome: "saved",
  });
  expect(decoded(decode({ kind: "secret", outcome: "declined" }))).toEqual({
    kind: "secret",
    outcome: "declined",
  });
});

// witness: packages/contracts/src/git.ts | Schema.isPattern(/^[^-]/) → Schema.isPattern(/^[^-]*/)
it("CT5: A ref name git would read as an option is refused wherever a ref crosses the wire", () => {
  const switchRef = Schema.decodeUnknownExit(VcsSwitchRefInput);
  const createRef = Schema.decodeUnknownExit(VcsCreateRefInput);
  const createWorktree = Schema.decodeUnknownExit(VcsCreateWorktreeInput);
  const preview = Schema.decodeUnknownExit(ReviewDiffPreviewInput);
  const fileContents = Schema.decodeUnknownExit(ReviewDiffFileContentsInput);
  const fileRefs = {
    cwd: "/repo",
    sourceKind: "branch-range",
    changeType: "change",
    oldPath: "README.md",
    newPath: "README.md",
  };
  const entries: ReadonlyArray<readonly [string, (ref: string) => Exit.Exit<unknown, unknown>]> = [
    ["VcsSwitchRefInput.refName", (ref) => switchRef({ cwd: "/repo", refName: ref })],
    ["VcsCreateRefInput.refName", (ref) => createRef({ cwd: "/repo", refName: ref })],
    [
      "VcsCreateWorktreeInput.refName",
      (ref) => createWorktree({ cwd: "/repo", refName: ref, path: null }),
    ],
    [
      "VcsCreateWorktreeInput.newRefName",
      (ref) => createWorktree({ cwd: "/repo", refName: "main", newRefName: ref, path: null }),
    ],
    [
      "VcsCreateWorktreeInput.baseRefName",
      (ref) => createWorktree({ cwd: "/repo", refName: "main", baseRefName: ref, path: null }),
    ],
    ["ReviewDiffPreviewInput.baseRef", (ref) => preview({ cwd: "/repo", baseRef: ref })],
    [
      "ReviewDiffFileContentsInput.baseRef",
      (ref) => fileContents({ ...fileRefs, baseRef: ref, headRef: "HEAD" }),
    ],
    [
      "ReviewDiffFileContentsInput.headRef",
      (ref) => fileContents({ ...fileRefs, baseRef: "main", headRef: ref }),
    ],
  ];

  const refused = ["--upload-pack=x", "--output=/tmp/x", "-b", "-"];
  const accepted = ["main", "feature/x-1", "origin/main", "0123456789abcdef"];
  const verdicts = entries.map(([name, decode]) => [
    name,
    [...refused, ...accepted].map((ref) => Exit.isSuccess(decode(ref))),
  ]);
  expect(verdicts).toEqual(
    entries.map(([name]) => [name, [...refused.map(() => false), ...accepted.map(() => true)]]),
  );
});

// witness: packages/contracts/src/agentUsage.ts | (/\p{Cs}/u.test(value) ? "Expected well-formed UTF-16" : undefined) → undefined
it("CT6: A usage identity with an unpaired surrogate is refused, so HQ is never sent a fact it cannot read", () => {
  const decode = Schema.decodeUnknownExit(UsageIdentity);
  const refused = ["turn-\uD800", "\uDC00-turn", "a\uDBFFb"].map((id) =>
    Exit.isSuccess(decode(id)),
  );
  expect(refused).toEqual([false, false, false]);
  expect(decoded(decode("turn-😀"))).toBe("turn-😀");
  expect(decoded(decode("turn-\uD800".toWellFormed()))).toBe("turn-�");
});
