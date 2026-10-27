/** A recipe proposal's state in the running Core, as a person reads it. */
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

import type { Call } from "./httpCall.ts";

/** The recipe change `number`'s state, once it is `state`. */
export const stateBecomes = (
  call: Call,
  session: string,
  appId: string,
  number: number,
  state: string,
) =>
  call("GET", `/api/apps/${appId}/changes`, { session }).pipe(
    Effect.map(
      (answer) =>
        (answer.body as { readonly changes: ReadonlyArray<Record<string, unknown>> }).changes.find(
          (change) => change["repo"] === RECIPE_REPO && change["number"] === number,
        ) ?? {},
    ),
    Effect.filterOrFail((change) => change["state"] === state),
    Effect.retry(Schedule.spaced(Duration.millis(50))),
    Effect.timeout(Duration.seconds(10)),
  );
