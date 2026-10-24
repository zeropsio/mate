// @effect-diagnostics preferSchemaOverJson:off -- refusal bodies in failure messages.
import * as Effect from "effect/Effect";
import { expect } from "@effect/vitest";
import type { gitClient } from "../../../../hq/test/harness/gitClient.ts";
import { remoteOf } from "../../../../hq/test/harness/mates.ts";
import { sessionFor } from "../../../../hq/test/harness/runningCore.ts";
import type { ScenarioCore } from "./hqCore.ts";

type Git = Effect.Success<typeof gitClient>;

/**
 * A person's HQ session, through the door the scenario's Core serves: the real Core takes the
 * person's Zerops access token (`definePerson` keeps it as `personal-<name>`), the embedded one
 * a hand-over token the fixture minted (`door-<name>`).
 */
export const personDoor = (core: ScenarioCore, person: string) =>
  core.kind === "external"
    ? core
        .call("POST", "/api/door", {
          body: {
            accessToken: person === "owner" ? "personal" : `personal-${person}`,
            orgId: "ORG",
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
