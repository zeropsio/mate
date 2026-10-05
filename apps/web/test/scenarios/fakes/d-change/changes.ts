// @effect-diagnostics nodeBuiltinImport:off -- git fixtures use temporary directories only.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import { expect } from "@effect/vitest";
import { MateLinkUp } from "@t3tools/shared/mateLink";
import { overviewOf, digest } from "../../../../../hq/test/harness/overviews.ts";
import { changeRoutePath, HqChange } from "@t3tools/shared/hqChanges";
import * as Schema from "effect/Schema";
import { enrollMate } from "../../../../../hq/test/harness/runningCore.ts";
import { gitClient } from "../../../../../hq/test/harness/gitClient.ts";
import { remoteOf } from "../../../../../hq/test/harness/mates.ts";
import type { createScenario } from "../../harness/scenario.ts";

const decodeChange = Schema.decodeUnknownSync(HqChange);
const encodeLink = Schema.encodeSync(MateLinkUp);

type Scenario = Effect.Success<ReturnType<typeof createScenario>>;
export const TITLE = "Add the order summary";
export const DESCRIPTION = "Shows the order total before checkout.";

/** zcp's actual git/HTTP boundary: real commits, change records, descriptions and merge receipts. */
export const changeFixture = Effect.fn(function* (s: Scenario) {
  yield* s.given.project("Ada", { mate: true, app: "Shop" });
  const appId = s.appIds.get("Shop")!;
  const credential = yield* enrollMate(s.drivers.core.call, s.drivers.core.fake, "Ada");
  const headers = { authorization: `Mate ${credential}` };
  const ticketResponse = yield* s.drivers.core.call("POST", "/api/mate/link-ticket", { headers });
  expect(ticketResponse.status).toBe(200);
  const link = yield* s.drivers.core.socket(
    `/api/mate/link?ticket=${(ticketResponse.body as { ticket: string }).ticket}`,
  );
  s.drivers.links.set("Ada", link);
  yield* link.next("state");
  const mate = s.drivers.mates.get("Ada")!;
  yield* link.send(
    encodeLink({
      type: "overview",
      full: true,
      overview: overviewOf({
        identity: {
          environmentId: mate.descriptor.environmentId,
          serverVersion: "0.14.11",
          update: null,
          runsWithoutSignIn: true,
        },
        threads: { list: [{ ...digest(mate.thread.id), title: mate.thread.title }], omitted: 0 },
      }),
    }),
  );
  const created = yield* s.drivers.core.call("POST", "/api/mate/repos", {
    headers,
    body: { name: "appdev" },
  });
  expect(created.status).toBe(200);
  const opened = yield* s.drivers.core.call("POST", "/api/mate/changes", {
    headers,
    body: { repo: "appdev", title: TITLE },
  });
  expect(opened.status).toBe(200);
  const git = yield* gitClient;
  yield* git.checked([
    "clone",
    remoteOf(s.drivers.core.origin, credential, appId, "appdev"),
    "work",
  ]);
  const work = NodePath.join(git.dir, "work");
  yield* Effect.sync(() =>
    NodeFS.writeFileSync(NodePath.join(work, "summary.txt"), "Order total: 42\n"),
  );
  yield* git.checked(["add", "summary.txt"], work);
  yield* git.checked(["commit", "-m", "Add order summary"], work);
  const head = yield* git.checked(["rev-parse", "HEAD"], work);
  // Subscribe before pushing; the real link receipt confirms HQ has consumed the git update.
  yield* git.checked(["push", "origin", "HEAD:refs/heads/mate/Ada/1"], work);
  yield* s.drivers.links.get("Ada")!.takeWhere("HQ recorded the change head", (frame) => {
    if (frame.type !== "state") return false;
    return JSON.stringify(frame).includes(head);
  });
  const edited = yield* s.drivers.core.call("PATCH", "/api/mate/changes/appdev/1", {
    headers,
    body: { body: DESCRIPTION },
  });
  expect(edited.status).toBe(200);
  const path = `/api/apps/${appId}/changes/appdev/1`;
  return {
    title: TITLE,
    description: DESCRIPTION,
    direct: changeRoutePath(appId, "appdev", 1),
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
