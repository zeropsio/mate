import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { untilHealth, type Call } from "./runningCore.ts";

it.live.each(["ECONNRESET", "ECONNREFUSED"])(
  "health readiness recovers from %s within its existing deadline",
  (code) =>
    Effect.gen(function* () {
      let calls = 0;
      const call: Call = () =>
        Effect.promise(async () => {
          calls++;
          if (calls === 1) throw Object.assign(new Error(code), { code });
          return {
            status: 200,
            body: { state: "active" },
            bytes: new Uint8Array(),
            headers: new Headers(),
          };
        });
      const result = yield* Effect.exit(untilHealth(call, "active"));
      expect(result._tag, "ASSERTION: a connection error must not kill health readiness").toBe(
        "Success",
      );
      expect(calls).toBe(2);
    }),
);

it.live.each(["EACCES", "ENOTFOUND"])("health readiness preserves unexpected %s defects", (code) =>
  Effect.gen(function* () {
    let calls = 0;
    const call: Call = () =>
      Effect.promise(async () => {
        calls++;
        throw Object.assign(new Error(code), { code });
      });
    const result = yield* Effect.exit(untilHealth(call, "active"));
    expect(result._tag).toBe("Failure");
    expect(String(result)).toContain(code);
    expect(calls).toBe(1);
  }),
);
