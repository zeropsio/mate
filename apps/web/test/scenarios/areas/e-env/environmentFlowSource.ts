// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- fixture code makes Git records on the local HQ.
import * as Effect from "effect/Effect";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import { expect } from "@effect/vitest";
import { HqChange } from "@t3tools/shared/hqChanges";
import { RECIPE_PROPOSAL_TITLE, RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import { openScenarioNavigation, type ScenarioCore } from "../../harness/hqCore.ts";
import { ticketFor } from "../../harness/coreSeed.ts";
import { mateAccess, personDoor } from "../../harness/mateAccess.ts";
import { environmentSources } from "./environmentSources.ts";
import { sourceGit } from "./sourceGit.ts";

const decodeChanges = Schema.decodeUnknownSync(Schema.Array(HqChange));

const changeReceipt = (
  core: ScenarioCore,
  owner: string,
  appId: string,
  repo: string,
  number: number,
  ready: (change: HqChange) => boolean,
) =>
  Effect.gen(function* () {
    yield* openScenarioNavigation(
      core.origin,
      yield* ticketFor(core.call, owner),
      (message) =>
        (message.type === "scope-reset" || message.type === "scope-values") &&
        message.scope.kind === "app-detail" &&
        message.scope.appId === appId &&
        message.values.some(
          (entry) =>
            entry.key === "changes" &&
            decodeChanges(entry.value).some(
              (change) => change.repo === repo && change.number === number && ready(change),
            ),
        ),
      { kind: "app-detail", appId },
    ).pipe(Effect.scoped);
  });

type SourceInputs = Effect.Success<typeof environmentSources>;
type EnvironmentInputs = Omit<SourceInputs, "given"> & {
  readonly given: {
    readonly person: (...args: Parameters<SourceInputs["given"]["person"]>) => void;
    readonly project: (
      ...args: Parameters<SourceInputs["given"]["project"]>
    ) => Effect.Effect<string | undefined, Schema.SchemaError, Scope.Scope>;
  };
};

export const environmentFlow = <S extends EnvironmentInputs>(
  s: S,
  shape: { readonly stage?: boolean } = {},
) =>
  Effect.gen(function* () {
    s.given.person("colleague", {
      role: "Developer",
      grants: { Ada: "BASIC_USER", "Shop-stage": "BASIC_USER", "Shop-production": "BASIC_USER" },
    });
    const credential = yield* s.given.project("Ada", { mate: true, app: "Shop" });
    if (credential === undefined) return yield* Effect.die("Ada must be enrolled by its fixture");
    const { core, zerops } = s.drivers;
    const colleague = yield* personDoor(core, "colleague");
    const appId = s.appIds.get("Shop")!;
    const tiers =
      shape.stage === false ? (["production"] as const) : (["stage", "production"] as const);
    for (const tier of tiers) {
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
    const access = mateAccess(core, s.owner, credential);
    const auth = access.headers;
    yield* access.repo(appId, "web");
    const git = yield* sourceGit;
    yield* access.repo(appId, RECIPE_REPO);
    const proposal = yield* core.call("POST", "/api/mate/changes", {
      headers: auth,
      body: { repo: RECIPE_REPO, title: RECIPE_PROPOSAL_TITLE },
    });
    expect(proposal.status, JSON.stringify(proposal.body)).toBe(200);
    const recipeNumber = (proposal.body as { change: { number: number } }).change.number;
    yield* access.clone(git, appId, RECIPE_REPO, "recipe");
    const recipeWork = NodePath.join(git.dir, "recipe");
    const recipe = {
      write: (files: Record<string, string>, message: string) =>
        Effect.sync(() => {
          for (const [path, content] of Object.entries(files)) {
            NodeFS.mkdirSync(NodePath.dirname(NodePath.join(recipeWork, path)), {
              recursive: true,
            });
            NodeFS.writeFileSync(NodePath.join(recipeWork, path), content);
          }
        }).pipe(
          Effect.andThen(git.checked(["add", "-A"], recipeWork)),
          Effect.andThen(git.checked(["commit", "-q", "-m", message], recipeWork)),
        ),
      push: (number: number) =>
        git.checked(["push", "-q", "origin", `HEAD:refs/heads/mate/Ada/${number}`], recipeWork),
      main: git
        .checked(["fetch", "-q", "origin"], recipeWork)
        .pipe(Effect.andThen(git.checked(["rev-parse", "origin/main"], recipeWork))),
    };
    const tierYaml = [
      "services:",
      "  - hostname: web",
      "    type: ubuntu/nodejs@22",
      `    buildFromGit: ${access.url(appId, "web")}`,
      "    zeropsSetup: web",
      "",
    ].join("\n");
    yield* recipe.write(
      { "3 — Stage/import.yaml": tierYaml, "4 — Small Production/import.yaml": tierYaml },
      "Declare Shop environments",
    );
    yield* recipe.push(recipeNumber);
    yield* changeReceipt(
      core,
      s.owner,
      appId,
      RECIPE_REPO,
      recipeNumber,
      (change) => change.state === "merged",
    );
    yield* access.clone(git, appId, "web", "web");
    const work = `${git.dir}/web`;
    const change = Effect.fn("e-env.change")(function* (title = "Ship the storefront") {
      const opened = yield* core.call("POST", "/api/mate/changes", {
        headers: auth,
        body: { repo: "web", title },
      });
      expect(opened.status).toBe(200);
      const number = (opened.body as { change: { number: number } }).change.number;
      yield* git.checked(["fetch", "origin"], work);
      // The real Core makes a repository empty: its first change starts the history `main` takes.
      const born =
        (yield* git.run(["rev-parse", "--verify", "-q", "origin/main"], work)).code === 0;
      yield* git.checked(
        born ? ["checkout", "-B", "change", "origin/main"] : ["checkout", "--orphan", "change"],
        work,
      );
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
      yield* changeReceipt(core, s.owner, appId, "web", number, (change) => change.head === head);
      return { number, head };
    });
    const merge = Effect.fn("e-env.merge")(function* (title = "Ship the storefront") {
      const { number, head } = yield* change(title);
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
    const removeService = (tier: "stage" | "production") => {
      const id = `web-${tier}`;
      zerops.remove("service-stack", id);
      const index = zerops.world.services.findIndex((service) => service.id === id);
      if (index !== -1) zerops.world.services.splice(index, 1);
    };
    const unansweredBuilds = () => {
      let held = true;
      zerops.handlers.unshift(async (request) =>
        held &&
        request.method === "PUT" &&
        /\/app-version\/[^/]+\/build-and-deploy$/u.test(request.url.pathname)
          ? { status: 503, body: { message: "Submission did not answer" } }
          : undefined,
      );
      return () => {
        held = false;
      };
    };
    const loseObservation = () => {
      zerops.handlers.unshift(async (request) =>
        request.headers.authorization === "Bearer hq" &&
        request.url.pathname.endsWith("/process/search")
          ? { status: 403, body: { message: "Observation no longer authorized" } }
          : undefined,
      );
      const follow = [...zerops.subscriptions.values()].find(
        (record) => record.apiToken === "hq" && record.kind === "app-version",
      );
      expect(follow).toBeDefined();
      zerops.sockets.get(follow!.receiver)!.close();
    };
    return { s, change, merge, release, appId, removeService, unansweredBuilds, loseObservation };
  });

export const environmentFlowSource = Effect.fn("e-env.source")(function* (
  shape: { readonly stage?: boolean } = {},
) {
  return yield* environmentFlow(yield* environmentSources, shape);
});
