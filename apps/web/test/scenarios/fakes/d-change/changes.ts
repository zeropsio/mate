// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- git fixtures use temporary directories only; refusal bodies in failure messages.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import { expect } from "@effect/vitest";
import { ChangeReceipt, HqChange } from "@t3tools/shared/hqChanges";
import type { RecipeTier } from "@t3tools/shared/hqRecipe";
import * as Schema from "effect/Schema";
import { gitClient } from "../../harness/gitClient.ts";
import { ticketFor } from "../../harness/coreSeed.ts";
import { openScenarioNavigation } from "../../harness/hqCore.ts";
import type { createScenario } from "../../harness/scenario.ts";
import { mateAccess, publishRecipe } from "../../harness/mateAccess.ts";

const decodeChange = Schema.decodeUnknownSync(HqChange);
const encodeReceipt = Schema.encodeSync(ChangeReceipt);

type Scenario = Effect.Success<ReturnType<typeof createScenario>>;
export const TITLE = "Add the order summary";
export const DESCRIPTION = "Shows the order total before checkout.";

export function anotherOrganization(s: Scenario) {
  s.drivers.zerops.world.organizations.set("OTHER", { name: "Second organization" });
  s.given.person("owner", { orgId: "OTHER", role: "OWNER" });
  return { original: s.drivers.zerops.orgName, other: "Second organization" };
}

/** zcp's actual git/HTTP boundary: real commits, change records, descriptions and merge receipts. */
export const changeFixture = Effect.fn(function* (
  s: Scenario,
  content: { title?: string; summary?: string } = {},
) {
  const title = content.title ?? TITLE;
  const credential = yield* s.given.project("Ada", { mate: true, app: "Shop" });
  const appId = s.appIds.get("Shop")!;
  if (credential === undefined) return yield* Effect.die("Ada must be enrolled by its fixture");
  const access = mateAccess(s.drivers.core, s.owner, credential);
  const headers = access.headers;
  yield* access.repo(appId, "appdev");
  const opened = yield* s.drivers.core.call("POST", "/api/mate/changes", {
    headers,
    body: { repo: "appdev", title },
  });
  expect(opened.status).toBe(200);
  const git = yield* gitClient;
  yield* access.clone(git, appId, "appdev", "work");
  const work = NodePath.join(git.dir, "work");
  yield* Effect.sync(() =>
    NodeFS.writeFileSync(
      NodePath.join(work, "summary.txt"),
      content.summary ?? "Order total: 42\n",
    ),
  );
  yield* git.checked(["add", "summary.txt"], work);
  yield* git.checked(["commit", "-m", "Add order summary"], work);
  const head = yield* git.checked(["rev-parse", "HEAD"], work);
  yield* git.checked(["push", "origin", "HEAD:refs/heads/mate/Ada/1"], work);
  // The source baseline or update must name this exact pushed head before consumers open it.
  yield* openScenarioNavigation(
    s.drivers.core.origin,
    yield* ticketFor(s.drivers.core.call, s.owner),
    (message) =>
      (message.type === "scope-reset" || message.type === "scope-values") &&
      message.scope.kind === "app-detail" &&
      message.scope.appId === appId &&
      message.values.some(
        (entry) =>
          entry.key === "changes" &&
          Schema.decodeUnknownSync(Schema.Array(HqChange))(entry.value).some(
            (change) => change.repo === "appdev" && change.number === 1 && change.head === head,
          ),
      ),
    { kind: "app-detail", appId },
  ).pipe(Effect.scoped);
  const edited = yield* s.drivers.core.call("PATCH", "/api/mate/changes/appdev/1", {
    headers,
    body: { body: DESCRIPTION },
  });
  expect(edited.status).toBe(200);
  const path = `/api/apps/${appId}/changes/appdev/1`;
  return {
    title,
    head,
    description: DESCRIPTION,
    /** zcp's receipt of the change's last push, as the Mate reports it. */
    reports: (receipt: ChangeReceipt) =>
      Effect.gen(function* () {
        const reported = yield* s.drivers.core.call("PATCH", "/api/mate/changes/appdev/1", {
          headers,
          body: { receipt: encodeReceipt(receipt) },
        });
        expect(reported.status, JSON.stringify(reported.body)).toBe(200);
      }),
    direct: `/change/${appId}/appdev/1`,
    /** Ada publishes `tier`'s recipe, so the application can add that environment. */
    publishesRecipe: (tier: RecipeTier) =>
      publishRecipe(s.drivers.core, s.owner, credential, appId, tier),
    colleagueMerges: Effect.gen(function* () {
      const response = yield* s.drivers.core.call("POST", `${path}/merge`, {
        session: s.owner,
        body: { expectedHead: head },
      });
      expect(response.status).toBe(200);
      expect(decodeChange(response.body).state).toBe("merged");
    }),
  };
});
