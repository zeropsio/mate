/**
 * Plays a tree on a fresh world with the oracle after every op, and minimises a failing tree to
 * the fewest ops that still break the same rule.
 */
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { engineFactId } from "@t3tools/client-runtime/data";

import { makeRng } from "../../../server/src/engine/testing/rng.ts";
import { checkFace, checkReading, checkSame, checkSince, type Finding } from "./oracle.ts";
import { readConversation, type Reading } from "./reading.ts";
import { drain, emptyModel, play, type Model, type Op } from "./tree.ts";
import { KEY, makeOracleWorld, type Client, type OracleWorld } from "./world.ts";

export interface Verdict {
  readonly findings: ReadonlyArray<Finding>;
  /** The ops the world allowed, in order, the drain's included. */
  readonly played: ReadonlyArray<Op>;
  /** The index in the tree of the op after which the oracle first spoke; -1 for the end. */
  readonly at: number;
}

/** Opens every card: each run's lines paged in, both ways, until the client holds them all. */
const openEveryCard = (world: OracleWorld, client: Client, model: Model) =>
  Effect.gen(function* () {
    for (let round = 0; round < 40; round++) {
      let asked = false;
      for (const runId of model.cardOfRun.keys()) {
        const span = client.reads().fact("mateEngineSpan", engineFactId(KEY.environmentId, runId));
        if (span.kind !== "known") continue;
        if (span.value.from !== null)
          asked = client.conversations.readRunPage(KEY, runId, "earlier") || asked;
        if (span.value.to !== null)
          asked = client.conversations.readRunPage(KEY, runId, "later") || asked;
      }
      yield* world.settle;
      if (!asked) return;
    }
  });

/** A fresh client on the same record: its closed faces, then every card opened, against the live. */
const reloadAgainst = (world: OracleWorld, live: Client, model: Model) =>
  Effect.gen(function* () {
    const fresh = world.openClient();
    yield* world.settle;
    const now = yield* Clock.currentTimeMillis;
    const findings: Finding[] = [];
    const liveReading = readConversation(live.reads(), KEY, now);
    const face = readConversation(fresh.reads(), KEY, now);
    if (liveReading !== null && face !== null) findings.push(...checkFace(liveReading, face));
    // What a reload shows before any card opens — its helpers, its dock — holds on its own.
    if (face !== null) findings.push(...checkReading(model, face, false));
    yield* openEveryCard(world, fresh, model);
    yield* openEveryCard(world, live, model);
    const opened = readConversation(fresh.reads(), KEY, now);
    const liveOpened = readConversation(live.reads(), KEY, now);
    if (liveOpened !== null && opened !== null) findings.push(...checkSame(liveOpened, opened));
    fresh.close();
    return findings;
  });

export const playTree = (ops: ReadonlyArray<Op>, options: { readonly drainSeed?: number } = {}) =>
  Effect.scoped(
    Effect.gen(function* () {
      const world = yield* makeOracleWorld;
      const live = world.openClient();
      yield* world.settle;
      const model = emptyModel();
      let before: Reading | null = null;
      const look = (settled: boolean) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const reading = readConversation(live.reads(), KEY, now);
          if (reading === null) return [];
          const findings = [
            ...checkReading(model, reading, settled),
            ...checkSince(before, reading),
          ];
          before = reading;
          return findings;
        });
      for (const [index, op] of ops.entries()) {
        const done = yield* play(world, model, op);
        if (!done) {
          model.skipped += 1;
          continue;
        }
        model.played.push(op);
        const findings = yield* look(false);
        if (op.op === "reload") findings.push(...(yield* reloadAgainst(world, live, model)));
        if (findings.length > 0)
          return { findings, played: model.played, at: index } satisfies Verdict;
      }
      const drained = yield* drain(world, model, makeRng(options.drainSeed ?? 1));
      model.played.push(...drained);
      const findings = yield* look(true);
      findings.push(...(yield* reloadAgainst(world, live, model)));
      return { findings, played: model.played, at: -1 } satisfies Verdict;
    }),
  );

/** A finding's class: its rule and words with the tree's ids and numbers taken out. */
export const classOf = (finding: Finding) => {
  const words = finding.words
    .replace(/mate\/r\/\d+/gu, "R")
    .replace(/\b[CJH]\d+\b/gu, "X")
    .replace(/\d+/gu, "n");
  // A reload's difference is classed by where it is, not by what each side said.
  return `${finding.rule}: ${finding.rule === "same" ? words.split(":")[0] : words}`;
};

/**
 * The fewest ops (ddmin over the played ops) that still break the rule of `target`: each tree
 * tried is played whole on a fresh world.
 */
export const minimise = (ops: ReadonlyArray<Op>, target: string) =>
  Effect.gen(function* () {
    const fails = (tree: ReadonlyArray<Op>) =>
      Effect.map(playTree(tree), (verdict) =>
        verdict.findings.some((finding) => classOf(finding) === target),
      );
    let current = [...ops];
    let chunks = 2;
    while (current.length >= 2) {
      const size = Math.ceil(current.length / chunks);
      let reduced = false;
      for (let start = 0; start < current.length; start += size) {
        const without = [...current.slice(0, start), ...current.slice(start + size)];
        if (without.length > 0 && (yield* fails(without))) {
          current = without;
          chunks = Math.max(chunks - 1, 2);
          reduced = true;
          break;
        }
      }
      if (!reduced) {
        if (chunks >= current.length) break;
        chunks = Math.min(chunks * 2, current.length);
      }
    }
    return current;
  });
