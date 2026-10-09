// @effect-diagnostics globalConsoleInEffect:off - a failing seed prints its minimised tree.
/**
 * The run-card oracle: does an engine Mate's card report precisely what its Mate did — helpers
 * that start background commands, whose ends wake the Mate, which starts more helpers — running
 * and finished, live and after a reload? Each tree plays on the running engine (scripted Claude,
 * SQLite, the test clock) through the client's own wire, adapter and store into the card's logic,
 * and the oracle (`oracle.ts`) reads the card after every op.
 *
 * The table holds each defect the oracle found, as the smallest tree that showed it. The seeds run
 * the generator: the gate's fixed seeds here; `ENGINE_PROOF_RANDOM=n` adds n fresh ones and
 * `ENGINE_PROOF_SEED=s` replays one (a failure prints its tree minimised).
 */
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { gateSeeds } from "../../../server/src/engine/testing/rng.ts";
import { classOf, minimise, playTree } from "./harness.ts";
import { RULES } from "./oracle.ts";
import { generate, type Op } from "./tree.ts";

const send: Op = { op: "send", text: "Start the checks." };

interface Defect {
  readonly title: string;
  readonly tree: ReadonlyArray<Op>;
}

/** Each defect the oracle found, as its smallest tree. */
const DEFECTS: ReadonlyArray<Defect> = [
  {
    title: "a background job that failed says its exit code on its card",
    tree: [
      send,
      { op: "job", id: "J1", helper: null, told: "after" },
      { op: "finish" },
      { op: "end", id: "J1", how: "failed", exit: 3 },
    ],
  },
  {
    title: "a helper's own helper is never counted among the helpers the Mate started",
    tree: [
      send,
      { op: "helper", id: "H1", parent: null },
      { op: "helper", id: "H2", parent: "H1" },
    ],
  },
  {
    title:
      "a helper's own background job is never the Mate's, on its card or in the dock, live or after a reload",
    tree: [
      send,
      { op: "helper", id: "H1", parent: null },
      { op: "job", id: "J2", helper: "H1", told: "after" },
      { op: "finish" },
      { op: "end", id: "J2", how: "completed", exit: 0 },
      { op: "reload" },
    ],
  },
  {
    title: "a closed card's line of background jobs reads the same after a reload",
    tree: [
      send,
      { op: "job", id: "J1", helper: null, told: "after" },
      { op: "finish" },
      { op: "end", id: "J1", how: "completed", exit: 0 },
      { op: "reload" },
    ],
  },
  {
    title: "a helper that failed marks the helpers it was started with while the others still work",
    tree: [
      send,
      { op: "helper", id: "H1", parent: null },
      { op: "end", id: "H1", how: "failed", exit: 0 },
      { op: "helper", id: "H2", parent: null },
    ],
  },
  {
    title:
      "a background job the person's Stop ended reads stopped, never that it didn't report back",
    tree: [send, { op: "job", id: "J1", helper: null, told: "after" }, { op: "stop" }],
  },
  {
    title: "a helper at work reads as its helper on its card, never as its launch's finished step",
    tree: [
      send,
      { op: "helper", id: "H1", parent: null },
      { op: "call", id: "C2", helper: null, fail: false },
    ],
  },
  {
    title: "a card waiting on its helpers never counts their own commands as the Mate's",
    tree: [
      send,
      { op: "helper", id: "H1", parent: null },
      { op: "job", id: "J2", helper: "H1", told: "after" },
      { op: "finish" },
    ],
  },
  {
    title:
      "a helper's own call stays on the card of the run that started it, never the next message's, live or after a reload",
    tree: [
      send,
      { op: "helper", id: "H1", parent: null },
      { op: "finish" },
      { op: "send", text: "Message 2." },
      { op: "call", id: "C2", helper: "H1", fail: false },
      { op: "finish" },
      { op: "reload" },
    ],
  },
  {
    title:
      "helpers and a job a person's Stop ended after the turn read stopped on the card, live and after a reload",
    tree: [
      send,
      { op: "helper", id: "H1", parent: null },
      { op: "helper", id: "H2", parent: null },
      { op: "job", id: "J3", helper: null, told: "after" },
      { op: "finish" },
      { op: "stop" },
      { op: "reload" },
    ],
  },
];

const said = (
  findings: ReadonlyArray<{ readonly rule: keyof typeof RULES; readonly words: string }>,
) => findings.map((finding) => `${RULES[finding.rule]}: ${finding.words}`);

describe("an engine Mate's run card, held against what its Mate did", () => {
  it.effect.each(DEFECTS)("$title", ({ tree }) =>
    Effect.gen(function* () {
      const verdict = yield* playTree(tree);
      assert.deepStrictEqual(said(verdict.findings), []);
    }),
  );

  it.effect("every seeded tree of helpers, background work and wakes reads as it ran", () =>
    Effect.gen(function* () {
      const failures: string[] = [];
      for (const seed of gateSeeds(24)) {
        const tree = generate(seed, 10 + (seed % 40));
        const verdict = yield* playTree(tree);
        if (verdict.findings.length === 0) continue;
        const first = verdict.findings[0]!;
        const smallest = yield* minimise(verdict.played, classOf(first));
        failures.push(
          `seed ${seed}: ${said(verdict.findings).join("\n  ")}\n  smallest tree: ${JSON.stringify(smallest)}`,
        );
      }
      assert.deepStrictEqual(failures, []);
    }),
  );
});
