import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { reportConversation } from "../b-menu/fake.ts";
import { installArea } from "./fake.ts";
import { mateChat } from "./dsl.ts";

// A deadline changes the reading, even when the provider and HQ send nothing more.
describe("C: provider refusal and its real deadline", () => {
  it.layer(Layer.merge(tempPostgresLayer, NodeServices.layer), { excludeTestServices: true })(
    (it) => {
      it.effect("an unreachable Mate keeps the provider and reset as HQ last-known evidence", () =>
        Effect.gen(function* () {
          let unavailable = false;
          const s = yield* createScenario([
            installArea,
            (drivers) => {
              drivers.onMate.push((mate) => {
                const handle = mate.handle;
                const socket = mate.socket;
                mate.handle = (request) =>
                  unavailable
                    ? { status: 503, body: { error: "Mate unavailable" } }
                    : handle(request);
                mate.socket = (connection) => {
                  if (unavailable) connection.close(1012, "Mate unavailable");
                  else socket(connection);
                };
              });
            },
          ]);
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          const chat = mateChat(s);
          const wire = chat.fixture();
          wire.history();
          wire.claudeLoginFacts("ready");
          const resetsAt = "2099-10-10T00:00:00.000Z";
          wire.run("refused", "error", "Claude usage limit reached.");
          wire.snapshot({
            session: {
              ...wire.mate.thread.session!,
              providerName: "claudeAgent",
              providerInstanceId: ProviderInstanceId.make("claudeAgent"),
              usageLimitResetAt: resetsAt,
            },
          });
          wire.activity(
            "runtime.error",
            "Claude usage limit reached",
            {
              message: "You've hit your weekly limit",
              turnEnd: "usage-limit",
              usageLimit: { resetsAt, window: "7-day" },
            },
            "refused",
          );
          wire.usagePause = {
            resetsAt,
            window: "7-day",
            held: 0,
            pausedAt: "2026-10-08T10:00:00.000Z",
            autoResume: false,
          };
          wire.shell();
          yield* reportConversation(
            s.drivers,
            "Ada",
            { session: wire.mate.thread.session, usagePause: wire.usagePause },
            "failed",
          );
          yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
          yield* Effect.promise(() =>
            s.page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]),
          );
          yield* s.given.signedIn;
          yield* chat.when.open();
          yield* chat.then.text("Ada hit the Claude limit.");
          yield* chat.then.text("Limit · until Oct 10, 2099");
          unavailable = true;
          yield* s.drivers.links.get("Ada")!.close;
          wire.disconnect();
          yield* chat.then.text("Last known");
          yield* chat.then.text("Ada hit the Claude limit");
          yield* chat.then.text("Oct 10, 2099");
          const output = process.env.MATE_LIMIT_EVIDENCE;
          if (output) {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            yield* fs.makeDirectory(output, { recursive: true });
            yield* Effect.promise(() =>
              s.page.screenshot({ path: path.join(output, "unreachable.png") }),
            );
          }
          yield* s.then.noExternalNetwork;
        }),
      );

      it.effect(
        "opening retains Claude evidence; early Continue explains the wait; the exact reset clears menu and header",
        () =>
          Effect.gen(function* () {
            const s = yield* createScenario([installArea]);
            yield* s.given.project("Ada", { mate: true, app: "Shop" });
            const chat = mateChat(s);
            const wire = chat.fixture();
            yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
            yield* Effect.promise(() =>
              s.page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]),
            );
            yield* Effect.promise(() => s.clock.install());
            const at = yield* Clock.currentTimeMillis;
            const resetsAt = DateTime.formatIso(DateTime.makeUnsafe(at + 10_000));
            wire.history();
            wire.claudeLoginFacts("ready");
            wire.run(
              "refused",
              "error",
              "Claude usage limit reached. Send the message again once the limit resets.",
            );
            wire.snapshot({
              session: {
                ...wire.mate.thread.session!,
                providerName: "claudeAgent",
                providerInstanceId: ProviderInstanceId.make("claudeAgent"),
                usageLimitResetAt: resetsAt,
              },
            });
            wire.activity(
              "runtime.error",
              "Claude usage limit reached",
              {
                message: "You've hit your weekly limit",
                turnEnd: "usage-limit",
                usageLimit: { resetsAt, window: "7-day" },
              },
              "refused",
            );
            wire.usagePause = {
              resetsAt,
              window: "7-day",
              held: 0,
              pausedAt: DateTime.formatIso(DateTime.makeUnsafe(at)),
              autoResume: false,
            };
            wire.shell();
            yield* reportConversation(
              s.drivers,
              "Ada",
              { session: wire.mate.thread.session, usagePause: wire.usagePause },
              "failed",
            );
            const read = wire.holdPage("", wire.mate.snapshot());
            yield* Effect.addFinalizer(() => Effect.sync(() => read.release()));
            wire.holdReplay = true;
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const capture = (state: string) =>
              Effect.gen(function* () {
                const output = process.env.MATE_LIMIT_EVIDENCE;
                if (!output) return;
                yield* fs.makeDirectory(output, { recursive: true });
                yield* Effect.promise(() =>
                  s.page.screenshot({ path: path.join(output, `${state}.png`) }),
                );
              });
            yield* s.given.signedIn;
            yield* chat.when.openReadOnly();
            yield* Effect.promise(() => read.requested());
            yield* chat.then.text("Ada is opening the conversation.");
            yield* chat.then.text("Ada hit the Claude limit");
            yield* capture("opening");
            read.release();
            yield* Effect.promise(() => wire.replaySubscribed());
            wire.ready();
            yield* chat.then.ready("Ada");
            yield* chat.then.text("Ada hit the Claude limit.");
            yield* Effect.promise(async () => {
              const markers = await s.page.$$('[data-mate-status="limit"]');
              expect(markers.length).toBeGreaterThanOrEqual(2);
              for (const marker of markers)
                expect(await marker.evaluate((node) => node.getAttribute("aria-label"))).toContain(
                  "Ada hit the Claude limit",
                );
            });
            yield* capture("refused");
            const before = wire.commands.length;
            yield* chat.when.press("Continue");
            yield* chat.then.text("Ada can't continue with Claude before");
            expect(wire.commands.length).toBe(before);
            yield* capture("before-reset");
            const remaining =
              Date.parse(resetsAt) -
              (yield* Effect.promise(() => s.page.evaluate(() => Date.now())));
            yield* Effect.promise(() => s.clock.advanceStepped(remaining - 1));
            expect(
              yield* Effect.promise(() =>
                s.page.$$('[data-mate-status="limit"]').then((nodes) => nodes.length),
              ),
            ).toBeGreaterThanOrEqual(2);
            yield* Effect.promise(() => s.clock.advanceStepped(1));
            yield* Effect.promise(() =>
              s.page.waitForFunction(
                () => document.querySelectorAll('[data-mate-status="limit"]').length === 0,
                { timeout: 8000, polling: "raf" },
              ),
            );
            yield* chat.then.text("Ada hit the Claude limit on");
            yield* chat.then.control("Continue");
            yield* capture("after-reset");
            yield* chat.when.press("Continue");
            expect(
              yield* Effect.promise(() => wire.waitForCommand("thread.turn.start")),
            ).toMatchObject({ threadId: "thread-Ada" });
            yield* s.then.noExternalNetwork;
          }),
      );
    },
  );
});
