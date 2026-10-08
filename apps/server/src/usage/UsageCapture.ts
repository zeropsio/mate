/** Command admission waits for live usage capture; failed storage attempts own no resources. */
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Sqlite from "../persistence/NodeSqliteClient.ts";
import { makeUsageLink } from "./UsageLink.ts";
import { retryUsageStorage } from "./UsageStorage.ts";

export const makeUsageCapture = (filename: string) =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const attempt = yield* Scope.make();
      const result = yield* Effect.exit(
        restore(
          Effect.gen(function* () {
            const database = yield* Layer.build(Sqlite.layer({ filename }));
            return yield* makeUsageLink.pipe(Effect.provide(database));
          }).pipe(Effect.provideService(Scope.Scope, attempt)),
        ),
      );
      if (Exit.isFailure(result)) {
        yield* Scope.close(attempt, result);
        return yield* result;
      }
      yield* Effect.addFinalizer((exit) => Scope.close(attempt, exit));
      return result.value;
    }),
  ).pipe(retryUsageStorage);
