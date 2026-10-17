import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { connectedRepo, deliver, intakeOn, issueEvent } from "../test/harness/automated.ts";
import { githubFake } from "../test/harness/githubFake.ts";
import { rowsWhere } from "../test/harness/mates.ts";
import { sessionFor, startCore, untilHealth } from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";

/** A Core whose application `Tea Shop` takes `acme/tea-shop`'s issues labelled `mate`. */
const withIntake = Effect.gen(function* () {
  const github = yield* githubFake;
  const core = yield* startCore(true, { githubApi: github.url });
  yield* untilHealth(core.call, "active");
  const owner = yield* sessionFor(core.call, "door-owner");
  const app = yield* core.call("POST", "/api/apps", { session: owner, body: { name: "Tea Shop" } });
  const appId = (app.body as { readonly id: string }).id;
  yield* connectedRepo(core, appId, "web", "acme/tea-shop");
  const hook = yield* intakeOn(core, github, owner, appId);
  /** The tasks HQ holds, oldest first, once `matches` holds of them. */
  const tasks = (matches: (rows: ReadonlyArray<Record<string, unknown>>) => boolean) =>
    rowsWhere(
      core.url,
      "SELECT number, title, body, url, author, state, delivery_id FROM hq_task ORDER BY seq",
      matches,
    );
  return { ...core, owner, appId, hook, tasks };
});

describe("GitHub's webhook of an intake", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("a delivery whose signature does not hold is refused and takes nothing in", () =>
      Effect.gen(function* () {
        const core = yield* withIntake;
        const opened = issueEvent("opened", { number: 1, labels: ["mate"] });
        for (const signature of [null, "sha256=00", `sha256=${"ab".repeat(32)}`]) {
          const refused = yield* deliver(core, core.hook, "issues", opened, { signature });
          assert.deepStrictEqual([refused.status, refused.body], [401, { code: "unauthorized" }]);
        }
        const forged = yield* deliver(
          core,
          { ...core.hook, secret: "not-the-secret" },
          "issues",
          opened,
        );
        assert.strictEqual(forged.status, 401);
        const elsewhere = yield* deliver(
          core,
          { ...core.hook, path: "/api/intake/github/no-such-intake" },
          "issues",
          opened,
        );
        assert.strictEqual(elsewhere.status, 404);
        yield* core.tasks((rows) => rows.length === 0);
      }),
    );

    it.effect("GitHub's ping is answered", () =>
      Effect.gen(function* () {
        const core = yield* withIntake;
        const pinged = yield* deliver(core, core.hook, "ping", {
          zen: "Keep it logically awesome.",
        });
        assert.strictEqual(pinged.status, 200);
      }),
    );

    it.effect(
      "an issue opened, labelled or reopened with the intake's label, in any case, waits as a task; one without it does not",
      () =>
        Effect.gen(function* () {
          const core = yield* withIntake;
          const answers = [
            yield* deliver(
              core,
              core.hook,
              "issues",
              issueEvent("opened", { number: 1, labels: ["bug"] }),
            ),
            yield* deliver(
              core,
              core.hook,
              "issues",
              issueEvent("opened", { number: 2, title: "Hotter tea", labels: ["bug", "Mate"] }),
            ),
            yield* deliver(
              core,
              core.hook,
              "issues",
              issueEvent("labeled", { number: 3, labels: ["MATE"] }, "MATE"),
            ),
            yield* deliver(
              core,
              core.hook,
              "issues",
              issueEvent("labeled", { number: 4, labels: ["mate", "bug"] }, "bug"),
            ),
            yield* deliver(
              core,
              core.hook,
              "issues",
              issueEvent("reopened", { number: 5, labels: ["mate"], body: null }),
            ),
          ];
          assert.deepStrictEqual(
            answers.map((answer) => answer.status),
            [202, 202, 202, 202, 202],
          );
          const rows = yield* core.tasks((found) => found.length === 3);
          assert.deepStrictEqual(
            rows.map((row) => [row["number"], row["state"]]),
            [
              [2, "queued"],
              [3, "queued"],
              [5, "queued"],
            ],
          );
          assert.deepInclude(rows[0], {
            title: "Hotter tea",
            body: "Make the tea hotter.",
            url: "https://github.com/acme/tea-shop/issues/2",
            author: "nova",
          });
          assert.strictEqual(rows[2]!["body"], "");
        }),
    );

    it.effect("the same delivery twice, or another event of an issue that waits, is one task", () =>
      Effect.gen(function* () {
        const core = yield* withIntake;
        const opened = issueEvent("opened", { number: 1, labels: ["mate"] });
        yield* deliver(core, core.hook, "issues", opened, { delivery: "d-1" });
        yield* deliver(core, core.hook, "issues", opened, { delivery: "d-1" });
        yield* deliver(
          core,
          core.hook,
          "issues",
          issueEvent("labeled", { number: 1, labels: ["mate"] }, "mate"),
          { delivery: "d-2" },
        );
        const rows = yield* core.tasks((found) => found.length > 0);
        assert.deepStrictEqual(
          rows.map((row) => row["delivery_id"]),
          ["d-1"],
        );
      }),
    );

    it.effect("an issue closed or unlabelled while it waits is dropped", () =>
      Effect.gen(function* () {
        const core = yield* withIntake;
        for (const number of [1, 2])
          yield* deliver(
            core,
            core.hook,
            "issues",
            issueEvent("opened", { number, labels: ["mate"] }),
          );
        yield* deliver(
          core,
          core.hook,
          "issues",
          issueEvent("closed", { number: 1, labels: ["mate"] }),
        );
        yield* deliver(
          core,
          core.hook,
          "issues",
          issueEvent("unlabeled", { number: 2, labels: [] }, "Mate"),
        );
        const rows = yield* core.tasks(
          (found) => found.length === 2 && found.every((row) => row["state"] === "dropped"),
        );
        assert.strictEqual(rows.length, 2);
      }),
    );

    it.effect("a delivery past 1 MiB is refused unread", () =>
      Effect.gen(function* () {
        const core = yield* withIntake;
        const huge = issueEvent("opened", {
          number: 1,
          labels: ["mate"],
          body: "x".repeat(1_100_000),
        });
        const refused = yield* deliver(core, core.hook, "issues", huge);
        assert.strictEqual(refused.status, 413);
      }),
    );
  });
});
