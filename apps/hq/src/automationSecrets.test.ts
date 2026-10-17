import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";

import {
  GITHUB_TOKEN,
  attention,
  connectedRepo,
  deliver,
  intakeOn,
  issueEvent,
  mateLinked,
} from "../test/harness/automated.ts";
import { githubFake } from "../test/harness/githubFake.ts";
import { addProject } from "../test/harness/mates.ts";
import { sessionFor, startCore, untilHealth } from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";

/** A fake Nebius key, built from parts so no scanner takes it for one. */
const KEY = ["v1", "fake", "nebius", "key", "secrets"].join(".");

/** Everything HQ writes to its log while `effect` runs. */
const logged = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const lines: Array<string> = [];
    const keep = (...args: ReadonlyArray<unknown>) => {
      lines.push(
        args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "),
      );
    };
    const spies = (["log", "info", "warn", "error", "debug", "trace"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(keep),
    );
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    const value = yield* effect.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          for (const spy of spies) spy.mockRestore();
          stdout.mockRestore();
        }),
      ),
    );
    return { value, text: lines.join("\n") };
  });

describe("automated Mates' secrets", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "no API key, repository token or webhook secret reaches HQ's log, whatever fails",
      () =>
        Effect.gen(function* () {
          const { value: secret, text } = yield* logged(
            Effect.gen(function* () {
              const github = yield* githubFake;
              const core = yield* startCore(true, { githubApi: github.url });
              yield* untilHealth(core.call, "active");
              const owner = yield* sessionFor(core.call, "door-owner");
              yield* core.call("PUT", "/api/org/ai-keys/nebius", {
                session: owner,
                body: { value: KEY },
              });
              const app = yield* core.call("POST", "/api/apps", {
                session: owner,
                body: { name: "Tea Shop" },
              });
              const appId = (app.body as { readonly id: string }).id;
              yield* connectedRepo(core, appId, "web", "acme/tea-shop");
              // The webhook refused, then made; every comment refused.
              github.state.hookStatus = 403;
              yield* core.call("PUT", `/api/apps/${appId}/intake`, {
                session: owner,
                body: { repo: "acme/tea-shop", label: "mate" },
              });
              github.state.hookStatus = 201;
              github.state.commentStatuses = [500, 500, 500, 500];
              const hook = yield* intakeOn(core, github, owner, appId);
              addProject(core.fake, "P_ROBOT");
              const robot = yield* mateLinked(core, owner, "P_ROBOT", { appId });
              yield* robot.link.send(attention(0));
              const opened = issueEvent("opened", { number: 1, labels: ["mate"] });
              yield* deliver(core, hook, "issues", opened, { signature: "sha256=00" });
              yield* deliver(core, { ...hook, secret: "forged" }, "issues", opened);
              yield* deliver(core, hook, "issues", opened);
              const task = yield* robot.link.takeWhere(
                "its task",
                (frame) => frame.type === "task",
              );
              yield* robot.link.send({
                type: "task-state",
                report: { taskId: (task["task"] as { id: string }).id, state: "accepted" },
              });
              yield* github.seenWhere(
                "the comment tried twice",
                (seen) => seen.filter((request) => request.path.endsWith("/comments")).length === 2,
              );
              yield* core.stop;
              return hook.secret;
            }),
          );
          // What failed was logged, so the log was read.
          assert.include(text, "intake webhook not made");
          assert.include(text, "a task's comment not posted");
          for (const value of [KEY, GITHUB_TOKEN, secret]) assert.notInclude(text, value);
        }),
    );
  });
});
