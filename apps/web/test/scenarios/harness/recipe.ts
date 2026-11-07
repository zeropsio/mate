/** A recipe proposal's state in the running Core, as a person reads it. */
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

import type { Call } from "./httpCall.ts";

/** The change `number` of `repo`, once HQ's record of it is `ready`. */
export const changeBecomes = (
  call: Call,
  session: string,
  appId: string,
  repo: string,
  number: number,
  ready: (change: Readonly<Record<string, unknown>>) => boolean,
) =>
  call("GET", `/api/apps/${appId}/changes`, { session }).pipe(
    Effect.map(
      (answer) =>
        (answer.body as { readonly changes: ReadonlyArray<Record<string, unknown>> }).changes.find(
          (change) => change["repo"] === repo && change["number"] === number,
        ) ?? {},
    ),
    Effect.filterOrFail(ready),
    Effect.retry(Schedule.spaced(Duration.millis(50))),
    Effect.timeout(Duration.seconds(10)),
  );

/** The recipe change `number`'s state, once it is `state`. */
export const stateBecomes = (
  call: Call,
  session: string,
  appId: string,
  number: number,
  state: string,
) =>
  changeBecomes(call, session, appId, RECIPE_REPO, number, (change) => change["state"] === state);
