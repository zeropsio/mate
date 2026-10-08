import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import {
  ProviderInstanceId,
  TurnId,
  OrchestrationThread,
  ClientOrchestrationCommand,
  ORCHESTRATION_WS_METHODS,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { makeClaudeTurnUsage } from "../../../../../server/src/spi/responseUsage.ts";
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
import { installArea } from "./fake.ts";
import { mateChat } from "./dsl.ts";

const decodeThread = Schema.decodeUnknownSync(OrchestrationThread);
const decodeCommand = Schema.decodeUnknownSync(ClientOrchestrationCommand);

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
            wire.claudeLoginFacts("ready");
            wire.run("refused", "running", "You've hit your weekly limit");
            const resetsAt = "2099-10-10T00:00:00.000Z";
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
            const refused = wire.mate.thread;
            wire.mate.rpcHandlers.unshift((request) => {
              if (request.tag !== ORCHESTRATION_WS_METHODS.dispatchCommand) return false;
              const command = decodeCommand(request.payload);
              if (command.type === "thread.archive") {
                wire.usagePause = null;
                wire.snapshot({ archivedAt: "2026-10-08T10:01:00.000Z" });
              }
              if (command.type === "thread.turn.start" && command.threadId !== refused.id) {
                const fresh = decodeThread({
                  ...refused,
                  id: command.threadId,
                  messages: [],
                  activities: [],
                  session: null,
                  latestTurn: null,
                  archivedAt: null,
                  modelSelection: { instanceId: "codex", model: "gpt-5.4" },
                });
                wire.threadCollection(fresh, [
                  { ...refused, archivedAt: "2026-10-08T10:01:00.000Z" },
                ]);
              }
              return false;
            });
            yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
            yield* Effect.promise(() =>
              s.page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]),
            );
            yield* s.given.signedIn;
            yield* chat.when.open();
            yield* chat.then.text("Ada hit the Claude limit.");
            yield* chat.when.press("More header actions");
            yield* chat.when.press("Archive and start fresh", "menuitem");
            yield* Effect.promise(() => wire.waitForCommand("thread.archive"));
            yield* chat.when.send("Use Codex while Claude waits");
            const sent = yield* Effect.promise(() => wire.waitForCommand("thread.turn.start"));
            if (sent.type !== "thread.turn.start")
              throw new Error("Expected the Codex turn request");
            expect(sent).toMatchObject({
              modelSelection: { instanceId: "codex", model: "gpt-5.4" },
            });
            expect(sent.threadId).not.toBe(refused.id);
            expect(wire.otherThreads.get(String(refused.id))?.session?.lastError).toBe(
              "You've hit your weekly limit",
            );
            yield* chat.then.once("Use Codex while Claude waits");
            wire.run("codex-reply", "running");
            wire.message(
              "codex-answer",
              "assistant",
              "Codex is ready to work while Claude waits for its reset.",
              "codex-reply",
            );
            wire.run("codex-reply", "completed", null, "codex-answer");
            yield* reportConversation(s.drivers, "Ada", {
              session: wire.mate.thread.session ?? null,
              latestTurn: wire.mate.thread.latestTurn ?? null,
              latestMessagePreview: wire.mate.shellThread().latestMessagePreview ?? null,
            });
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
          wire.claudeLoginFacts("ready");
          wire.run("refused", "running", "You've hit your weekly limit");
          const resetsAt = "2020-01-01T00:00:00.000Z";
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
            pausedAt: wire.mate.thread.latestTurn?.startedAt ?? "2026-10-08T10:00:00.000Z",
            autoResume: false,
          };
          wire.question("question-target", "refused");
          wire.shell();
          yield* s.given.signedIn;
          yield* chat.when.open();
          yield* chat.then.text("Which environment should I inspect?");
          yield* chat.then.text("Respond to Ada's pending request before continuing.");
          const before = wire.commands.length;
          yield* Effect.promise(async () => {
            const button = await s.page.$('::-p-aria([name="Continue"][role="button"])');
            expect(button).not.toBeNull();
            expect(await button!.evaluate((node) => (node as HTMLButtonElement).disabled)).toBe(
              true,
            );
            await button!.evaluate((node) => {
              (node as HTMLButtonElement).click();
              (node as HTMLButtonElement).click();
            });
          });
          expect(wire.commands.length).toBe(before);
          yield* chat.then.noText("Continue the work that was paused.");
          yield* chat.when.click("Staging");
          yield* Effect.promise(() => wire.waitForCommand("thread.user-input.respond"));
          yield* chat.then.noText("Respond to Ada's pending request before continuing.");
          yield* chat.when.press("Continue");
          expect(
            yield* Effect.promise(() => wire.waitForCommand("thread.turn.start")),
          ).toMatchObject({ message: { text: "Continue the work that was paused." } });
          expect(
            wire.commands.filter((command) => command.type === "thread.turn.start"),
          ).toHaveLength(1);
          yield* s.then.noExternalNetwork;
        }),
      );

      it.effect(
        "connected Usage shows zero records, sessions and cost for a refused Claude transcript",
        () =>
          Effect.gen(function* () {
            const read = makeClaudeTurnUsage({ session: { model_usage: {}, total_cost_usd: 0 } });
            // A refused native result has no consumption; transcript history is never an input.
            expect(
              read({
                type: "result",
                session_id: "refused-session",
                uuid: "refused",
                modelUsage: {},
                total_cost_usd: 0,
              }),
            ).toEqual([]);
            const s = yield* createScenario([installArea]);
            yield* s.given.project("Ada", { mate: true, app: "Shop" });
            const chat = mateChat(s);
            const wire = chat.fixture();
            wire.history();
            const rows = yield* s.drivers.core
              .sql`SELECT count(*)::text AS records FROM hq_usage_fact`;
            expect(rows[0]?.records).toBe("0");
            yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
            yield* Effect.promise(() =>
              s.page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]),
            );
            yield* s.given.signedIn;
            yield* chat.when.open();
            yield* Effect.promise(() => s.page.goto(`${s.web.origin}/usage`));
            yield* chat.when.press("Cost");
            yield* chat.when.press("30 days");
            yield* chat.then.text("No recorded Mate usage yet.");
            yield* chat.then.noText("$0.00");
            yield* chat.then.noText("Not connected, so not counted: Ada");
            const output = process.env.MATE_LIMIT_EVIDENCE;
            if (output)
              yield* Effect.promise(() => s.page.screenshot({ path: `${output}/usage.png` }));
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
          wire.claudeLoginFacts("ready");
          const resetsAt = "2099-10-10T00:00:00.000Z";
          wire.run("refused", "running", "You've hit your weekly limit");
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
          const overview = mateOverviewOf({
            identity: {
              environmentId: wire.mate.descriptor.environmentId,
              serverVersion: "0.14.62",
              update: null,
            },
            threads: [wire.mate.shellThread()],
            auth: { available: true, agents: [] },
            crew: undefined,
          });
          yield* reportConversation(s.drivers, "Ada", overview.main!, "failed");
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
            wire.claudeLoginFacts("ready");
            wire.run(
              "refused",
              "running",
              "Claude usage limit reached. Send the message again once the limit resets.",
            );
            wire.snapshot({
              session: {
                ...wire.mate.thread.session!,
                status: "running",
                activeTurnId: TurnId.make("refused"),
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
            expect(
              yield* Effect.promise(() => wire.waitForCommand("thread.turn.start")),
            ).toMatchObject({ threadId: "thread-Ada" });
            yield* s.then.noExternalNetwork;
          }),
      );
    },
  );
});
