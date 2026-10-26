// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- git fixtures use temporary directories only; refusal bodies in failure messages.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import { expect } from "@effect/vitest";
import {
  RECIPE_PROPOSAL_TITLE,
  RECIPE_REPO,
  RECIPE_TIER_PATHS,
  type RecipeTier,
} from "@t3tools/shared/hqRecipe";
import { gitClient } from "../../../../hq/test/harness/gitClient.ts";
import { mateInApp, remoteOf } from "../../../../hq/test/harness/mates.ts";
import { stateBecomes } from "../../../../hq/test/harness/recipe.ts";
import { sessionFor } from "../../../../hq/test/harness/runningCore.ts";
import type { ScenarioCore } from "./hqCore.ts";

type Git = Effect.Success<typeof gitClient>;

/**
 * A person's HQ session, through the door the scenario's Core serves: the real Core takes the
 * person's Zerops access token (`definePerson` keeps it as `personal-<name>`), the embedded one
 * a hand-over token the fixture minted (`door-<name>`).
 */
export const personDoor = (core: ScenarioCore, person: string, orgKey?: string) =>
  core.kind === "external"
    ? core
        .call("POST", "/api/door", {
          body: {
            accessToken: person === "owner" ? "personal" : `personal-${person}`,
            orgId: "ORG",
            ...(orgKey === undefined ? {} : { orgKey }),
          },
        })
        .pipe(
          Effect.map((response) => {
            expect(response.status, JSON.stringify(response.body)).toBe(200);
            return (response.body as { session: string }).session;
          }),
        )
    : sessionFor(core.call, `door-${person}`);

/**
 * How a Mate reaches HQ over HTTP and Git, from what `given.project` returned for it: the real
 * Core takes the project key (`Project <key>`, also as Git's `http.extraHeader`) and serves Git
 * under the organisation; the embedded Core takes its enrolled credential.
 */
export function mateAccess(core: ScenarioCore, owner: string, credential: string) {
  const external = core.kind === "external";
  const headers = { authorization: external ? `Project ${credential}` : `Mate ${credential}` };
  /** The repository's address as HQ hands it out (`url`), which a recipe's `buildFromGit` names. */
  const url = (appId: string, repo: string) =>
    `${core.origin}/git/${external ? "ORG/" : ""}${appId}/${repo}.git`;
  const remote = (appId: string, repo: string) =>
    external ? url(appId, repo) : remoteOf(core.origin, credential, appId, repo);
  return {
    headers,
    url,
    /** The application's repository `name`, made if new; the real Core makes it for a person. */
    repo: Effect.fn("scenarios.mateAccess.repo")(function* (appId: string, name: string) {
      const made = external
        ? yield* core.call("POST", `/api/apps/${appId}/repos`, { session: owner, body: { name } })
        : yield* core.call("POST", "/api/mate/repos", { headers, body: { name } });
      expect([200, 201], JSON.stringify(made.body)).toContain(made.status);
    }),
    /** `git clone` of the repository into `dir` (under the client's directory), as the Mate. */
    clone: (git: Git, appId: string, repo: string, dir: string, options: string[] = []) =>
      git.checked([
        "clone",
        ...(external ? ["-c", `http.extraHeader=Authorization: ${headers.authorization}`] : []),
        ...options,
        remote(appId, repo),
        dir,
      ]),
  };
}

/**
 * The owner places `projectId` as a Mate in the application `appName`, made once per name in
 * `appIds`; the embedded Core also enrolls it. The real Core links a Mate by its project key.
 */
export const placeMate = Effect.fn("scenarios.placeMate")(function* (
  core: ScenarioCore,
  owner: string,
  projectId: string,
  appName: string,
  appIds: Map<string, string>,
) {
  if (core.kind !== "external")
    return (yield* mateInApp(core.call, core.fake, owner, projectId, appName, appIds)).appId;
  let appId = appIds.get(appName);
  if (appId === undefined) {
    const app = yield* core.call("POST", "/api/apps", { session: owner, body: { name: appName } });
    expect(app.status, JSON.stringify(app.body)).toBe(201);
    appId = (app.body as { id: string }).id;
    appIds.set(appName, appId);
  }
  const attached = yield* core.call("POST", `/api/apps/${appId}/projects`, {
    session: owner,
    body: { projectId, kind: "mate", mate: { face: "face-1" } },
  });
  expect(attached.status, JSON.stringify(attached.body)).toBe(201);
  return appId;
});

/**
 * The Mate publishes `tier`'s recipe in its application's recipe repository, as zcp does over HQ's
 * HTTP and Git: a proposal, its push, and HQ merging it onto `main`.
 */
export const publishRecipe = Effect.fn("scenarios.publishRecipe")(function* (
  core: ScenarioCore,
  owner: string,
  credential: string,
  appId: string,
  tier: RecipeTier,
) {
  const access = mateAccess(core, owner, credential);
  yield* access.repo(appId, RECIPE_REPO);
  const opened = yield* core.call("POST", "/api/mate/changes", {
    headers: access.headers,
    body: { repo: RECIPE_REPO, title: RECIPE_PROPOSAL_TITLE },
  });
  expect(opened.status, JSON.stringify(opened.body)).toBe(200);
  const number = (opened.body as { readonly change: { readonly number: number } }).change.number;
  const git = yield* gitClient;
  yield* access.clone(git, appId, RECIPE_REPO, "recipe");
  const work = NodePath.join(git.dir, "recipe");
  const path = NodePath.join(work, RECIPE_TIER_PATHS[tier]);
  yield* Effect.sync(() => {
    NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
    NodeFS.writeFileSync(path, "services:\n  - hostname: api\n    type: nodejs@22\n");
  });
  yield* git.checked(["add", "-A"], work);
  yield* git.checked(["commit", "-q", "-m", `Add the ${tier} recipe`], work);
  yield* git.checked(["push", "-q", "origin", `HEAD:refs/heads/mate/Ada/${String(number)}`], work);
  yield* stateBecomes(core.call, owner, appId, number, "merged");
});
