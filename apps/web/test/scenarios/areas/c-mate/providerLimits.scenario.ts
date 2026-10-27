import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { completedHttp } from "../../harness/completedHttp.ts";
import { reportConversation } from "../b-menu/fake.ts";
import { installArea, type ChatDriver } from "./fake.ts";
import { mateChat } from "./dsl.ts";

/**
 * Ada's conversation runs on Claude, and its last run hit Claude's weekly limit, until `resetsAt`;
 * `asking`, it waits on the person's answer as it hit it.
 */
const claudeAtItsLimit = (wire: ChatDriver, resetsAt: string, asking = false) => {
  wire.claudeLoginFacts("ready");
  wire.engine.assign({ instanceId: "claudeAgent", model: "sonnet", driver: "claudeAgent" });
  wire.run("refused", "running");
  if (asking) wire.question("question-target", "refused");
  wire.engine.limit(wire.runOf("refused"), Date.parse(resetsAt), "7-day");
};

// A deadline changes the reading, even when the provider and HQ send nothing more.
describe("C: provider refusal and its real deadline", () => {
  it.layer(Layer.merge(tempPostgresLayer, NodeServices.layer), { excludeTestServices: true })(
    (it) => {
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
            claudeAtItsLimit(wire, resetsAt);
            yield* reportConversation(
              s.drivers,
              "Ada",
              { refusal: { turnId: null, provider: "Claude", resetsAt }, usagePause: { resetsAt } },
              "failed",
              [wire.engine.row()],
            );
            const read = wire.engine.holdOpen({ rows: false });
            yield* Effect.addFinalizer(() => Effect.sync(() => read.release()));
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const headerLimitMarker =
              '[class~="@container/header-actions"] [data-mate-status="limit"]';
            /** What the menu's row for Ada says. */
            const adaRow = () =>
              s.page.evaluate(
                () => document.querySelector('[data-zerops-mate-row="Ada"]')?.textContent ?? "",
              );
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
            yield* chat.then.ready("Ada");
            yield* chat.then.text("Ada hit Claude's weekly limit.");
            yield* Effect.promise(async () => {
              // The header's marker names the limit; the menu's row says it in its line.
              const markers = await s.page.$$(headerLimitMarker);
              expect(markers).toHaveLength(1);
              expect(await adaRow()).toContain("At its usage limit");
              for (const marker of markers)
                expect(await marker.evaluate((node) => node.getAttribute("aria-label"))).toContain(
                  "Ada hit the Claude limit",
                );
            });
            yield* Effect.promise(() => completedHttp(s.page)());
            yield* Effect.promise(() =>
              s.page.waitForSelector("pierce/[data-timeline-placing]", {
                hidden: true,
              }),
            );
            yield* Effect.promise(() =>
              s.page.waitForFunction(
                () => {
                  const stage = document.querySelector("[data-conversation-opening]");
                  return stage === null || getComputedStyle(stage).visibility === "hidden";
                },
                { polling: "raf" },
              ),
            );
            yield* capture("refused");
            // On the engine, an early Continue asks the Mate to try (owner, 2026-10-10: a limit may be
            // gone early); the provider still refuses, so the pause and its words stand.
            wire.engine.onContinue.push(() => {});
            yield* chat.when.press("Continue");
            yield* Effect.promise(() => wire.waitForOp("continue"));
            yield* chat.then.text("Ada hit Claude's weekly limit.");
            expect(yield* Effect.promise(adaRow)).toContain("At its usage limit");
            yield* capture("before-reset");
            const remaining =
              Date.parse(resetsAt) -
              (yield* Effect.promise(() => s.page.evaluate(() => Date.now())));
            yield* Effect.promise(() => s.clock.advanceStepped(remaining - 1));
            expect(yield* Effect.promise(() => s.page.$$(headerLimitMarker))).toHaveLength(1);
            expect(yield* Effect.promise(adaRow)).toContain("At its usage limit");
            yield* Effect.promise(() => s.clock.advanceStepped(1));
            yield* Effect.promise(() =>
              s.page.waitForFunction(
                () =>
                  document.querySelectorAll('[data-mate-status="limit"]').length === 0 &&
                  !document
                    .querySelector('[data-zerops-mate-row="Ada"]')
                    ?.textContent?.includes("At its usage limit"),
                { polling: "raf" },
              ),
            );
            yield* chat.then.text("Ada hit Claude's weekly limit on");
            yield* chat.then.noText("Ada paused at the limit");
            yield* chat.then.noText("Ada thought");
            yield* chat.then.control("Continue");
            yield* Effect.promise(() =>
              s.page.waitForFunction(
                () =>
                  !document
                    .querySelector('[data-zerops-mate-row="Ada"]')
                    ?.textContent?.includes("Needs attention"),
                { polling: "raf" },
              ),
            );
            yield* capture("after-reset");
            yield* chat.when.press("Continue");
            expect((yield* Effect.promise(() => wire.waitForOp("continue"))).payload).toMatchObject(
              { conversationId: "thread-Ada" },
            );
            yield* s.then.noExternalNetwork;
          }),
      );
    },
  );
});
