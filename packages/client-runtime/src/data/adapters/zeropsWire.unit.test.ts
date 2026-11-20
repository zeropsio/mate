import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { ZeropsApiError } from "../../zerops/errors.ts";
import { makeZeropsWire, type ZeropsWireClient } from "./zeropsWire.ts";

/** The read of a wire whose every request is refused with the given status and code. */
const refusing = (status: number, code: string) => {
  const client: ZeropsWireClient = {
    baseUrl: "https://v1.test",
    exchangeWebSocketToken: async () => ({ webSocketToken: "v2" }),
    requestData: async () => {
      throw new ZeropsApiError("v3", "not-found", status, code);
    },
    renewHeldSession: async () => undefined,
  };
  const { read } = makeZeropsWire({ client });
  if (read === undefined) throw new Error("the Zerops wire reads");
  return read;
};

// witness: packages/client-runtime/src/data/adapters/zeropsWire.ts | notFoundCodeOf(path) === cause.code) return 404; → cause.code.endsWith("NotFound")) return 404;
it.effect(
  "AD71: A Zerops read answers gone only when the not-found code is that entity's own, a project's projectNotFound at 400 included; any other 400 or 404 fails the read",
  () =>
    Effect.gen(function* () {
      expect(yield* refusing(400, "projectNotFound")("/project/v1")).toEqual({
        status: 404,
        body: null,
      });
      expect(yield* refusing(404, "serviceStackNotFound")("/service-stack/v1")).toEqual({
        status: 404,
        body: null,
      });

      for (const [status, code, path] of [
        [400, "serviceStackNotFound", "/project/v1"],
        [404, "projectNotFound", "/service-stack/v1"],
        [400, "v4", "/project/v1"],
        [404, "v4", "/project/v1"],
      ] as const) {
        const exit = yield* Effect.exit(refusing(status, code)(path));
        expect(Exit.isFailure(exit), `${status} ${code} ${path}`).toBe(true);
      }
    }),
);
