// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- localhost fixture content and wire diagnostics.
import { effectReceipt } from "../../harness/waits.ts";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import { expect } from "@effect/vitest";
import { enrollMate, sessionFor } from "../../../../../hq/test/harness/runningCore.ts";
import { gitClient } from "../../../../../hq/test/harness/gitClient.ts";
import { groupCheckout, propose, stateBecomes } from "../../../../../hq/test/harness/recipe.ts";
import { remoteOf } from "../../../../../hq/test/harness/mates.ts";
import type { ScenarioExtension, ScenarioOptions } from "../../harness/scenario.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installBuildProtocol } from "../../fakes/e-env/builds.ts";

export const installArea: ScenarioExtension = ({ zerops }) => installBuildProtocol(zerops);

export const environmentFixtureWith = Effect.fn("e-env.fixture")(function* (
  options: ScenarioOptions = {},
) {
  const s = yield* createScenario([installArea], options);
  s.given.person("colleague", {
    role: "Developer",
    grants: { Ada: "BASIC_USER", "Shop-stage": "BASIC_USER", "Shop-production": "BASIC_USER" },
  });
  yield* s.given.project("Ada", { mate: true, app: "Shop" });
  const { core, zerops } = s.drivers;
  // Core's person door takes a scoped hand-over token, as the browser creates from its account.
  zerops.world.tokens.set("door-colleague", {
    ...zerops.world.tokens.get("door-owner")!,
    id: "door-colleague",
    createdByUser: "colleague",
  });
  const colleague = yield* sessionFor(core.call, "door-colleague");
  const appId = s.appIds.get("Shop")!;
  for (const tier of ["stage", "production"] as const) {
    const projectId = `Shop-${tier}`;
    yield* s.given.project(projectId, { app: "Shop", kind: tier, environmentName: tier });
    zerops.put("service-stack", {
      id: `web-${tier}`,
      projectId,
      clientId: "ORG",
      name: "web",
      status: "ACTIVE",
      isSystem: false,
      subdomainAccess: false,
      ports: [{ port: 3000, scheme: "http" }],
      serviceStackTypeInfo: {
        serviceStackTypeName: "nodejs",
        serviceStackTypeVersionName: "nodejs@22",
      },
    });
    zerops.world.tokens.set(`key-${tier}`, {
      id: `token-${tier}`,
      name: `deploy-${tier}`,
      orgId: "ORG",
      roleCode: "NO_ACCESS",
      canCreateProjects: false,
      canViewFinances: false,
      canEditFinances: false,
      projects: [{ projectId, roleCode: "BASIC_USER" }],
      createdMs: 0,
      createdByUser: "owner",
    });
    const kept = yield* core.call("PUT", `/api/apps/${appId}/environments/${tier}/deploy-token`, {
      session: s.owner,
      body: { token: `key-${tier}` },
    });
    expect(kept.status).toBe(200);
  }
  const credential = yield* enrollMate(core.call, zerops.world, "Ada");
  const auth = { authorization: `Mate ${credential}` };
  expect(
    (yield* core.call("POST", "/api/mate/repos", { headers: auth, body: { name: "web" } })).status,
  ).toBe(200);
  const git = yield* gitClient;
  const recipeNumber = yield* propose(core.call, auth);
  const recipe = yield* groupCheckout(git, core.origin, credential, appId, "recipe");
  const tierYaml = [
    "services:",
    "  - hostname: web",
    "    type: nodejs@22",
    `    buildFromGit: ${core.origin}/git/${appId}/web.git`,
    "    zeropsSetup: web",
    "",
  ].join("\n");
  yield* recipe.write(
    { "3 — Stage/import.yaml": tierYaml, "4 — Small Production/import.yaml": tierYaml },
    "Declare Shop environments",
  );
  yield* recipe.push("Ada", recipeNumber);
  yield* stateBecomes(core.call, s.owner, appId, recipeNumber, "merged");
  yield* git.checked(["clone", remoteOf(core.origin, credential, appId, "web"), "web"]);
  const work = `${git.dir}/web`;
  const merge = Effect.fn("e-env.merge")(function* (title = "Ship the storefront") {
    const opened = yield* core.call("POST", "/api/mate/changes", {
      headers: auth,
      body: { repo: "web", title },
    });
    expect(opened.status).toBe(200);
    const number = (opened.body as { change: { number: number } }).change.number;
    yield* git.checked(["fetch", "origin"], work);
    yield* git.checked(["checkout", "-B", "change", "origin/main"], work);
    yield* git.checked(["config", "user.name", "Ada"], work);
    // Content goes through ordinary git, never Core's internal GitHost or database.
    yield* Effect.promise(async () => {
      const fs = await import("node:fs/promises");
      await fs.writeFile(
        `${work}/zerops.yaml`,
        "zerops:\n  - setup: web\n    run:\n      start: node index.js\n",
      );
      await fs.writeFile(`${work}/index.js`, `console.log(${JSON.stringify(title)});\n`);
    });
    yield* git.checked(["add", "."], work);
    yield* git.checked(["commit", "-m", title], work);
    const head = yield* git.checked(["rev-parse", "HEAD"], work);
    yield* git.checked(["push", "origin", `HEAD:refs/heads/mate/Ada/${number}`], work);
    yield* core.call("GET", `/api/apps/${appId}/changes`, { session: s.owner }).pipe(
      Effect.filterOrFail((answer) =>
        (answer.body as { changes: { repo: string; number: number; head: string }[] }).changes.some(
          (c) => c.repo === "web" && c.number === number && c.head === head,
        ),
      ),
      Effect.retry(Schedule.spaced("30 millis")),
      effectReceipt(`Core change web/${number} at ${head}`),
    );
    expect(
      (yield* core.call("POST", `/api/apps/${appId}/changes/web/${number}/merge`, {
        session: s.owner,
        body: { expectedHead: head },
      })).status,
    ).toBe(200);
    yield* git.checked(["fetch", "origin"], work);
    return yield* git.checked(["rev-parse", "origin/main"], work);
  });
  const release = Effect.fn("e-env.colleague.release")(function* (tag: string) {
    const sha = yield* git.checked(["rev-parse", "origin/main"], work);
    const answer = yield* core.call("POST", `/api/apps/${appId}/releases`, {
      session: colleague,
      body: { tag, groupHead: yield* recipe.main, entries: [{ service: "web", sha }] },
    });
    expect(answer.status).toBe(201);
  });
  return { s, merge, release, appId };
});

export const environmentFixture = environmentFixtureWith();
