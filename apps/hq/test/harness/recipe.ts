// @effect-diagnostics nodeBuiltinImport:off -- the tests reach Core as zcp does: over HTTP and git.
/**
 * An application's recipe in the running Core (`runningCore.ts`) as the tests propose it: a Mate's
 * proposal in the recipe repository, its checkout, and the proposal's state as a person reads it.
 *
 * @module test/harness/recipe
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert } from "@effect/vitest";
import { RECIPE_PROPOSAL_TITLE, RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

import type { gitClient } from "./gitClient.ts";
import { remoteOf } from "./mates.ts";
import type { Call } from "./runningCore.ts";

type Git = Effect.Success<typeof gitClient>;

/** The Mate opens a recipe proposal in its application's recipe repository; its number. */
export const propose = (call: Call, auth: Record<string, string>) =>
  Effect.gen(function* () {
    const made = yield* call("POST", "/api/mate/repos", {
      headers: auth,
      body: { name: RECIPE_REPO },
    });
    assert.strictEqual(made.status, 200);
    const opened = yield* call("POST", "/api/mate/changes", {
      headers: auth,
      body: { repo: RECIPE_REPO, title: RECIPE_PROPOSAL_TITLE },
    });
    return (opened.body as { readonly change: { readonly number: number } }).change.number;
  });

/** A Mate's checkout of the recipe repository in `dir`. */
export const groupCheckout = (
  git: Git,
  origin: string,
  credential: string,
  appId: string,
  dir: string,
) =>
  Effect.gen(function* () {
    yield* git.checked(["clone", remoteOf(origin, credential, appId, RECIPE_REPO), dir]);
    const work = NodePath.join(git.dir, dir);
    return {
      work,
      write: (files: Record<string, string>, message: string) =>
        Effect.andThen(
          Effect.sync(() => {
            for (const [path, content] of Object.entries(files)) {
              NodeFS.mkdirSync(NodePath.dirname(NodePath.join(work, path)), { recursive: true });
              NodeFS.writeFileSync(NodePath.join(work, path), content);
            }
          }),
          Effect.andThen(
            git.checked(["add", "-A"], work),
            git.checked(["commit", "-q", "-m", message], work),
          ),
        ),
      push: (mateId: string, number: number, rev = "HEAD") =>
        git.checked(
          ["push", "-q", "origin", `${rev}:refs/heads/mate/${mateId}/${String(number)}`],
          work,
        ),
      main: Effect.andThen(
        git.checked(["fetch", "-q", "origin"], work),
        git.checked(["rev-parse", "origin/main"], work),
      ),
    };
  });

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
