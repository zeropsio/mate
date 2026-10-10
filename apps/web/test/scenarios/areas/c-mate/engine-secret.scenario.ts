import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { mateChat } from "./dsl.ts";
import { EngineChatWire } from "./engine.ts";
import { installArea, vaultWrites } from "./fake.ts";

const KEY = "STRIPE_SECRET_KEY";
const REASON = "Stripe charges cards: Dashboard, Developers, API keys.";
/** A value shaped like a live Stripe key, made from parts. */
const SECRET = ["sk", "_live_", "Zq".repeat(12)].join("");
const FIELD = "Paste it here — it goes to the vault, not the chat";

/** Whether any string anywhere in a value holds the secret. */
const holdsSecret = (value: unknown): boolean =>
  typeof value === "string"
    ? value.includes(SECRET)
    : typeof value === "object" && value !== null
      ? Object.values(value).some(holdsSecret)
      : false;

describe("C: a secret the Mate asks the person for", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("a secret the person gives never reaches the Mate's records or its agent", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installArea]);
        yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
        yield* s.given.project("Ada", { mate: true });
        const chat = mateChat(s);
        const fixture = chat.fixture();
        if (!(fixture.wire instanceof EngineChatWire)) throw new Error("The ask is the engine's");
        const engine = fixture.wire.engine;
        const vault = vaultWrites(s.drivers);
        const run = engine.personRun("Take card payments");
        yield* s.given.signedIn;
        yield* chat.when.open("Ada", "Take card payments");
        // The agent asks through zcp, which answers at once; the engine records the ask on the
        // call and the turn goes on to its end.
        const asked = {
          action: "request",
          key: KEY,
          project: true,
          reason: REASON,
        };
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
            resultText: `{"requested":{"key":"${KEY}","reason":"${REASON}","scope":"shared","sensitive":true}}`,
          },
        });
        engine.ask(
          { kind: "vault", key: KEY, scope: { kind: "shared" }, sensitive: true, reason: REASON },
          { runId: run },
        );
        engine.note(run, "I asked for your Stripe key on a private card.", { kind: "completed" });
        yield* chat.then.text(REASON);
        yield* chat.then.text("that service is deployed");
        yield* chat.when.fill(FIELD, SECRET);
        yield* chat.when.press("Save");
        yield* chat.then.text("has been told");
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
