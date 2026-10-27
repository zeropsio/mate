import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { createScenario } from "../../harness/scenario.ts";
import { mateChat } from "./dsl.ts";
import { installArea, vaultWrites } from "./fake.ts";

const KEY = "STRIPE_SECRET_KEY";
const LABEL = "Stripe secret key";
const WHY = "for checkout";
/** A value shaped like a live Stripe key, made from parts. */
const SECRET = ["sk", "_live_", "Zq".repeat(12)].join("");
const FIELD = `Your ${LABEL}`;

/** Whether any string anywhere in a value holds the secret. */
const holdsSecret = (value: unknown): boolean =>
  typeof value === "string"
    ? value.includes(SECRET)
    : typeof value === "object" && value !== null
      ? Object.values(value).some(holdsSecret)
      : false;

describe("C: a secret the Mate asks the person for", () => {
  scenarioSuite((it) => {
    it.effect("a secret the person gives never reaches the Mate's records or its agent", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installArea]);
        yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
        yield* s.given.project("Ada", { mate: true });
        const chat = mateChat(s);
        const fixture = chat.fixture();
        const engine = fixture.wire.engine;
        const vault = vaultWrites(s.drivers);
        const run = engine.personRun("Take card payments");
        yield* s.given.signedIn;
        yield* chat.when.open("Ada", "Take card payments");
        // The agent asks through zcp, which answers at once; the engine records the ask on the
        // call and the turn goes on to its end.
        const asked = { action: "request", key: KEY, project: true, label: LABEL, why: WHY };
        engine.item(run, {
          kind: "call",
          step: "mcp",
          words: "MCP tool call",
          state: "done",
          endedAt: 1791201600000,
          tool: { name: "zerops_env", server: "zerops" },
          shows: { toolName: "mcp__zerops__zerops_env", input: asked },
          result: {
            toolName: "zerops_env",
            resultText: `{"requested":{"key":"${KEY}","label":"${LABEL}","why":"${WHY}","scope":"shared","sensitive":true}}`,
          },
        });
        engine.ask(
          {
            kind: "vault",
            key: KEY,
            label: LABEL,
            scope: { kind: "shared" },
            sensitive: true,
            reason: WHY,
          },
          { runId: run },
        );
        engine.note(run, "I asked for your Stripe key on a private card.", { kind: "completed" });
        // The ask waits at the composer's top, never as a card in the conversation.
        yield* chat.then.text(`needs your ${LABEL}, ${WHY}`);
        yield* chat.then.text("Goes to this project's vault for every app, never into this chat.");
        yield* chat.then.noText("Put in vault");
        yield* chat.when.fill(FIELD, SECRET);
        yield* chat.when.press("Save to vault");
        // Answered, it is a result of the run that asked.
        yield* chat.then.text("added for every app · hidden");
        yield* chat.then.noText("has been told");
        expect(vault.writes, "ASSERTION: the value went to the vault, as the person").toEqual([
          { key: KEY, content: SECRET },
        ]);
        const answers = engine.applied.filter((command) => command.op === "answer");
        expect(answers.map((command) => command.payload.answer)).toEqual([
          { kind: "secret", outcome: "saved" },
        ]);
        expect(
          holdsSecret(engine.applied),
          "ASSERTION: nothing the engine was told holds the value",
        ).toBe(false);
        expect(
          holdsSecret([...engine.requests.values()]),
          "ASSERTION: the ask's record holds no value",
        ).toBe(false);
        const stored = yield* Effect.promise(() =>
          s.page.evaluate(() => [
            ...Object.values({ ...localStorage }),
            ...Object.values({ ...sessionStorage }),
          ]),
        );
        expect(holdsSecret(stored), "ASSERTION: the browser keeps no copy").toBe(false);
        yield* chat.then.noText(SECRET);
      }),
    );
  });
});
