import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import { mateOverviewOf } from "../../../../../server/src/zerops/zeropsHqOverview.ts";
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
        "a fresh Codex session on the same Mate can send while Claude's refusal remains in history",
        () =>
          Effect.gen(function* () {
            const s = yield* createScenario([installArea]);
            const settled = completedHttp(s.page);
            yield* s.given.project("Ada", { mate: true, app: "Shop" });
            const chat = mateChat(s);
            const wire = chat.fixture();
            wire.history();
            claudeAtItsLimit(wire, "2099-10-10T00:00:00.000Z");
            yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
            yield* Effect.promise(() =>
              s.page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]),
            );
            yield* s.given.signedIn;
            yield* chat.when.open();
            yield* chat.then.text("Ada hit Claude's weekly limit.");
            yield* chat.when.press("More header actions");
            yield* chat.when.press("Archive and start fresh", "menuitem");
            yield* Effect.promise(() => wire.waitForOp("set-archived"));
            // The fresh conversation starts on the agent the person picks: Codex, while Claude waits.
            yield* chat.when.press("Sonnet");
            yield* chat.when.agent("Codex");
            yield* Effect.promise(() =>
              s.page
                .locator('[role="option"]')
                .filter((option) => option.textContent?.includes("GPT-5.4") ?? false)
                .setTimeout(8000)
                .click(),
            );
            yield* chat.when.send("Use Codex while Claude waits");
            const sent = yield* Effect.promise(() => wire.waitForOp("send"));
            const fresh = String(sent.payload.conversationId);
            expect(fresh).not.toBe(wire.engine.conversationId);
            expect(
              wire.engine.applied.find(
                ({ op, payload }) => op === "assign-agent" && payload.conversationId === fresh,
              )?.payload,
            ).toMatchObject({ instanceId: "codex", model: "gpt-5.4" });
            expect(wire.engine.runs.get(wire.runOf("refused"))?.end).toMatchObject({
              kind: "usage-limit",
              driver: "claudeAgent",
            });
            yield* chat.then.once("Use Codex while Claude waits");
            const codex = wire.engine.conversation(fresh);
            const codexRun = [...codex.runs.keys()].at(-1)!;
            codex.note(codexRun, "Codex is ready to work while Claude waits for its reset.", {
              kind: "completed",
            });
            yield* reportConversation(s.drivers, "Ada");
            yield* chat.then.once("Codex is ready to work while Claude waits for its reset.");
            yield* chat.then.noText("Thinking");
            yield* Effect.promise(() => settled());
            yield* Effect.promise(() =>
              s.page.waitForSelector("pierce/[data-conversation-opening]", {
                hidden: true,
                timeout: 8000,
              }),
            );
            yield* chat.then.once("Codex is ready to work while Claude waits for its reset.");
            expect(
              yield* Effect.promise(() => s.page.$$('pierce/[data-mate-status="limit"]')),
            ).toHaveLength(0);
            const output = process.env.MATE_LIMIT_EVIDENCE;
            if (output)
              yield* Effect.promise(() => s.page.screenshot({ path: `${output}/codex.png` }));
            yield* s.then.noExternalNetwork;
          }),
      );

      it.effect("a parked refusal cannot queue Continue behind an unanswered question", () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          const chat = mateChat(s);
          const wire = chat.fixture();
          wire.history();
          claudeAtItsLimit(wire, "2020-01-01T00:00:00.000Z", true);
          yield* s.given.signedIn;
          yield* chat.when.open();
          yield* chat.then.text("Which environment should I inspect?");
          // The card the limit cut waits with its question (B5): its head asks for the answer first.
          yield* chat.then.text("Answer the pending question to continue.");
          const before = wire.engine.applied.length;
          expect(
            yield* Effect.promise(() => s.page.$('::-p-aria([name="Continue"][role="button"])')),
          ).toBeNull();
          expect(wire.engine.applied.length).toBe(before);
          yield* chat.when.click("Staging");
          yield* Effect.promise(() => wire.waitForAnswer("question-target"));
          yield* chat.then.noText("Answer the pending question to continue.");
          yield* chat.when.press("Continue");
          yield* Effect.promise(() => wire.waitForOp("continue"));
          expect(wire.engine.applied.filter(({ op }) => op === "continue")).toHaveLength(1);
          yield* s.then.noExternalNetwork;
        }),
      );

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
          claudeAtItsLimit(wire, "2099-10-10T00:00:00.000Z");
          const overview = mateOverviewOf({
            identity: {
              environmentId: wire.mate.descriptor.environmentId,
              serverVersion: "0.14.62",
              update: null,
            },
            threads: [wire.mate.shellThread()],
            auth: { available: true, agents: [] },
            crew: undefined,
            conversations: [wire.engine.row()],
          });
          yield* reportConversation(
            s.drivers,
            "Ada",
            overview.main!,
            "failed",
            overview.conversations,
          );
          yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
          yield* Effect.promise(() =>
            s.page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]),
          );
          yield* s.given.signedIn;
          yield* chat.when.open();
          yield* chat.then.text("Ada hit Claude's weekly limit.");
          yield* chat.then.text("Limit · until Oct 10, 2099");
          unavailable = true;
          yield* s.drivers.links.get("Ada")!.close;
          wire.disconnect();
          yield* chat.then.text("Last known");
          const cold = yield* s.given.browserActor({ person: "owner" });
          yield* Effect.promise(() => cold.page.setViewport({ width: 1786, height: 1000 }));
          yield* Effect.promise(() =>
            cold.page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]),
          );
          const coldChat = mateChat({ ...s, ...cold });
          yield* cold.given.signedIn;
          yield* coldChat.when.openReadOnly();
          yield* coldChat.then.text("Last known");
          yield* coldChat.then.text("Ada hit the Claude limit");
          yield* coldChat.then.text("Oct 10, 2099");
          yield* coldChat.then.noText("coding agent's limit");
          const output = process.env.MATE_LIMIT_EVIDENCE;
          if (output) {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            yield* fs.makeDirectory(output, { recursive: true });
            yield* Effect.promise(() =>
              cold.page.screenshot({ path: path.join(output, "unreachable.png") }),
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
              const markers = await s.page.$$('[data-mate-status="limit"]');
              expect(markers.length).toBeGreaterThanOrEqual(1);
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
                timeout: 8000,
              }),
            );
            yield* Effect.promise(() =>
              s.page.waitForFunction(
                () => {
                  const stage = document.querySelector("[data-conversation-opening]");
                  return stage === null || getComputedStyle(stage).visibility === "hidden";
                },
                { timeout: 8000, polling: "raf" },
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
            expect(
              yield* Effect.promise(() =>
                s.page.$$('[data-mate-status="limit"]').then((nodes) => nodes.length),
              ),
            ).toBeGreaterThanOrEqual(1);
            expect(yield* Effect.promise(adaRow)).toContain("At its usage limit");
            yield* Effect.promise(() => s.clock.advanceStepped(1));
            yield* Effect.promise(() =>
              s.page.waitForFunction(
                () =>
                  document.querySelectorAll('[data-mate-status="limit"]').length === 0 &&
                  !document
                    .querySelector('[data-zerops-mate-row="Ada"]')
                    ?.textContent?.includes("At its usage limit"),
                { timeout: 8000, polling: "raf" },
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
                { timeout: 8000, polling: "raf" },
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
