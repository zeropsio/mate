import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import type { ScriptedStep } from "../../../../../server/integration/scriptedProviderDriver.ts";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import * as Schema from "effect/Schema";
import {
  CommandId,
  ConversationId,
  MATE_ENGINE_PROTOCOLS,
  RuntimeItemId,
  RuntimeTaskId,
  type EngineConversationFrame,
  OrchestrationThread,
} from "@t3tools/contracts";
import {
  reportAttention,
  reportConversation,
  stageService,
  startStageBuild,
} from "../b-menu/fake.ts";
import { installArea } from "./fake.ts";
import { mateChat } from "./dsl.ts";

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

// OpenCode's external tool result; canonical readers derive the failed dev-server card.
const resultTool = (
  id: string,
  toolName: string,
  input: Record<string, unknown>,
  result: string,
  failed = false,
): ScriptedStep => ({
  kind: "event",
  event: {
    type: "item.completed",
    itemId: RuntimeItemId.make(id),
    payload: {
      itemType:
        toolName === "Bash"
          ? "command_execution"
          : ["Write", "Edit"].includes(toolName)
            ? "file_change"
            : "mcp_tool_call",
      status: failed ? "failed" : "completed",
      ...(result ? { detail: result } : {}),
      data: {
        tool: toolName.startsWith("mcp__zerops__")
          ? `zerops_${toolName.slice("mcp__zerops__".length)}`
          : toolName.startsWith("mcp__inspector__")
            ? `inspector_${toolName.slice("mcp__inspector__".length)}`
            : toolName,
        state: {
          status: failed ? "error" : "completed",
          input,
          ...(failed ? { error: result } : { output: result }),
        },
        toolName,
        input,
        result,
      },
    },
  },
});

// These are reported provider facts; the fake never executes commands or git.
describe("C: calls, results and crew actions", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // J06 · Z12/Z13/Z16–Z19/Z21/Z25/Z29/Z33: distinct calls retain their recorded outputs.
    it.effect("J06: concurrent calls stay readable through settlement and reload", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([], { mate: "real" });
        yield* s.given.project("Ada", { mate: true });
        const chat = mateChat(s);
        const { server, provider } = s.drivers.realMates.get("Ada")!;
        const conversationId = ConversationId.make("thread-Ada");
        const protocol = MATE_ENGINE_PROTOCOLS[0]!;
        const caller = { subject: "scenario-person", environmentId: "scenario", epoch: 1 };
        yield* server.engine.assignAgent(conversationId, {
          instanceId: "opencode",
          driver: "opencode",
          model: "gpt-5.4",
          profile: { kind: "mate" },
        });
        const changes = yield* Queue.unbounded<EngineConversationFrame>();
        yield* server.engine.wire.subscribe({ protocol, conversationId }, caller).pipe(
          Stream.runForEach((frame) => Queue.offer(changes, frame)),
          Effect.forkScoped,
        );
        while ((yield* Queue.take(changes)).type !== "synchronized") {}
        const release = yield* Deferred.make<void>();
        yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));
        const started = (id: string, command: string): ScriptedStep => ({
          kind: "event",
          event: {
            type: "item.started",
            itemId: RuntimeItemId.make(id),
            payload: {
              itemType: "command_execution",
              status: "inProgress",
              detail: command,
              data: { tool: "Bash", state: { status: "running", input: { command } } },
            },
          },
        });
        yield* stageService(s.drivers, "Ada");
        yield* startStageBuild(s.drivers, "Ada");
        yield* provider.turn([
          {
            kind: "event",
            event: {
              type: "content.delta",
              itemId: RuntimeItemId.make("thought"),
              payload: {
                streamKind: "reasoning_text",
                delta: "I will inspect both commands independently",
              },
            },
          },
          started("call-a", "printf first-proof"),
          started("call-b", "printf second-proof"),
          { kind: "wait", until: release },
          resultTool(
            "call-b",
            "Bash",
            { command: "printf second-proof" },
            "Second command returned its own result",
          ),
          resultTool(
            "call-a",
            "Bash",
            { command: "printf first-proof" },
            "First command returned its own result",
          ),
          started("call-no-result", "printf unreturned-proof"),
          resultTool(
            "write-one",
            "Write",
            { file_path: "/srv/app/summary.txt", content: "Recorded first write" },
            "",
          ),
          resultTool("empty-call", "Bash", { command: "printf empty-proof" }, ""),
          resultTool(
            "malformed",
            "mcp__inspector__inspect",
            { query: "orders" },
            '{"notice":"The inspector returned a structured observation","count":2}',
          ),
          resultTool(
            "state",
            "mcp__zerops__zerops_status",
            {},
            yield* encodeJson({
              envelope: {
                phase: "develop-active",
                environment: "development",
                project: { id: "Ada", name: "Ada" },
                services: [],
                generated: DateTime.formatIso(yield* DateTime.now),
              },
            }),
          ),
          resultTool(
            "deploy-refused",
            "mcp__zerops__zerops_deploy",
            { targetService: "app" },
            '{"code":"BUILD_FAILED","error":"The first build lacked its configuration","suggestion":"Correct the config and retry"}',
            true,
          ),
          resultTool(
            "deploy-first",
            "mcp__zerops__zerops_deploy",
            { targetService: "app" },
            '{"status":"BUILD_TRIGGERED","targetService":"app","message":"Build triggered.","appVersionId":"building-Ada"}',
          ),
          {
            kind: "event",
            event: {
              type: "item.started",
              itemId: RuntimeItemId.make("helper-launch"),
              payload: {
                itemType: "dynamic_tool_call",
                status: "inProgress",
                data: {
                  tool: "Agent",
                  state: {
                    status: "running",
                    input: {
                      description: "Schema helper",
                      prompt: "Inspect the key",
                      subagent_type: "explorer",
                    },
                  },
                },
              },
            },
          },
          {
            kind: "event",
            event: {
              type: "task.started",
              payload: {
                taskId: RuntimeTaskId.make("schema-helper"),
                toolUseId: "helper-launch",
                taskType: "local_agent",
                description: "Schema helper",
              },
            },
          },
          {
            kind: "event",
            event: {
              type: "task.completed",
              payload: {
                taskId: RuntimeTaskId.make("schema-helper"),
                toolUseId: "helper-launch",
                taskType: "local_agent",
                status: "completed",
                summary: "The helper checked the key independently",
              },
            },
          },
          resultTool(
            "helper-launch",
            "Agent",
            { description: "Schema helper", prompt: "Inspect the key", subagent_type: "explorer" },
            "The helper checked the key independently",
          ),
          resultTool(
            "write-two",
            "Edit",
            {
              file_path: "/srv/app/summary.txt",
              old_string: "Recorded first write",
              new_string: "Recorded later write",
            },
            "",
          ),
          { kind: "say", text: "Both completed commands were inspected" },
        ]);
        expect(
          (yield* server.engine.wire.send(
            {
              protocol,
              conversationId,
              commandId: CommandId.make("run-one"),
              text: "Inspect the two commands",
            },
            caller,
          ))._tag,
        ).toBe("Accepted");
        expect((yield* provider.received).input.input).toBe("Inspect the two commands");
        yield* s.given.signedIn;
        yield* chat.step(
          "concurrent work keeps the composer usable",
          chat.when.openReadOnly("Ada"),
        );
        yield* chat.then.text("Inspect the two commands");
        yield* chat.then.control("Stop generation");
        yield* chat.when.type("I can type while work arrives");
        yield* Deferred.succeed(release, undefined);
        yield* chat.then.text("Both completed commands were inspected");
        yield* chat.then.control("Stop generation", "button", false);
        yield* chat.then.noButton("Approve");
        yield* chat.when.activate("Show work");
        yield* chat.then.control("Hide work");
        yield* chat.when.press("Started a helper. Show them");
        yield* chat.then.text("Schema helper");
        yield* chat.when.press("printf first-proof. Show what it returned");
        yield* chat.then.once("First command returned its own result");
        yield* chat.when.press("printf second-proof. Show what it returned");
        yield* chat.then.once("Second command returned its own result");
        yield* chat.then.text("No result");
        yield* chat.step(
          "an old write keeps its own recorded content",
          Effect.gen(function* () {
            yield* chat.when.press("Wrote summary.txt. Show what it wrote");
            yield* chat.then.text("Recorded first write");
            yield* chat.then.noText("Recorded later write");
            yield* chat.when.press("Wrote summary.txt. Hide what it wrote");
            yield* chat.then.noText("Recorded first write");
          }),
        );
        yield* chat.when.copy("First command returned its own result");
        yield* chat.then.text("Deploying app");
        yield* chat.then.text("Deploy to app failed");
        yield* chat.then.noText("Deployed app");
        yield* chat.when.press("Used inspect. Show what it returned");
        yield* chat.then.text("The inspector returned a structured observation");
        yield* chat.when.press("Used inspect. Hide what it returned");
        yield* chat.then.noText("The inspector returned a structured observation");
        yield* chat.then.draft("I can type while work arrives");
        yield* chat.when.press("printf first-proof. Hide what it returned");
        yield* chat.then.noText("First command returned its own result");
        yield* chat.when.reload("Ada", "Inspect the two commands");
        yield* chat.then.once("Both completed commands were inspected");
        yield* chat.when.activate("Show work");
        yield* chat.then.control("Hide work");
        yield* chat.when.press("printf first-proof. Show what it returned");
        yield* chat.then.once("First command returned its own result");
        yield* chat.then.text("No result");
        const picture =
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7e8AAAAASUVORK5CYII=";
        yield* chat.when.press("Toggle right panel");
        yield* chat.when.click("Browser");
        const browserResults =
          yield* Queue.unbounded<import("@t3tools/contracts").ZeropsBrowserCallResult>();
        const browser = yield* server.browser.subscribe;
        yield* browser.pipe(
          Stream.runForEach((event) =>
            event.type === "call-result" ? Queue.offer(browserResults, event) : Effect.void,
          ),
          Effect.forkScoped,
        );
        const browserTool = (
          id: string,
          path: string,
          attachments?: ReadonlyArray<{ url: string }>,
        ): ScriptedStep => ({
          kind: "event",
          event: {
            type: "item.completed",
            itemId: RuntimeItemId.make(id),
            payload: {
              itemType: "mcp_tool_call",
              status: "completed",
              data: {
                tool: "zerops_zerops_browser",
                state: {
                  status: "completed",
                  input: { commands: [["open", `https://store.example/${path}`]] },
                  output: `{"url":"https://store.example/${path}","steps":[]}`,
                  ...(attachments === undefined ? {} : { attachments }),
                },
              },
            },
          },
        });
        const browserRelease = yield* Deferred.make<void>();
        yield* Effect.addFinalizer(() => Deferred.succeed(browserRelease, undefined));
        const browserStarted = (id: string, path: string): ScriptedStep => ({
          kind: "event",
          event: {
            type: "item.started",
            itemId: RuntimeItemId.make(id),
            payload: {
              itemType: "mcp_tool_call",
              status: "inProgress",
              data: {
                tool: "zerops_zerops_browser",
                state: {
                  status: "pending",
                  input: { commands: [["open", `https://store.example/${path}`]] },
                },
              },
            },
          },
        });
        yield* provider.turn([
          browserStarted("browser-order", "orders"),
          browserStarted("browser-checkout", "checkout"),
          browserStarted("browser-empty", "empty"),
          { kind: "wait", until: browserRelease },
          browserTool("browser-order", "orders", [{ url: `data:image/png;base64,${picture}` }]),
          browserTool("browser-checkout", "checkout"),
          browserTool("browser-empty", "empty", []),
          { kind: "say", text: "The page checks returned" },
        ]);
        yield* chat.when.send("Check the order and checkout pages");
        const native = yield* provider.received;
        expect(native.input.input).toBe("Check the order and checkout pages");
        yield* chat.then.text("Check the order and checkout pages");
        yield* chat.then.control("Stop generation");
        yield* Deferred.succeed(browserRelease, undefined);
        const complete = yield* Queue.take(browserResults);
        const partial = yield* Queue.take(browserResults);
        const absent = yield* Queue.take(browserResults);
        expect(complete).toMatchObject({
          callId: "browser-order",
          threadId: native.threadId,
          turnId: native.turnId,
          completeness: "complete",
          frame: { data: picture },
        });
        expect(partial).toMatchObject({ callId: "browser-checkout", completeness: "partial" });
        expect(partial.frame).toBeUndefined();
        expect(absent).toMatchObject({
          callId: "browser-empty",
          completeness: "complete",
          frame: null,
        });
        while (true) {
          const frame = yield* Queue.take(changes);
          if (
            frame.type === "changes" &&
            frame.runs.some((run) => run.ordinal === 2 && run.state === "ended")
          ) {
            const run = frame.runs.find((run) => run.ordinal === 2)!;
            expect(
              run.summary.answerItemId,
              "ASSERTION: the browser turn retains its settled answer",
            ).not.toBeNull();
            expect(frame.items).toContainEqual(
              expect.objectContaining({
                id: run.summary.answerItemId,
                kind: "note",
                text: "The page checks returned",
              }),
            );
            break;
          }
        }
        yield* chat.then.once("The page checks returned");
        yield* chat.then.control("Stop generation", "button", false);
        yield* chat.then.noText("Ada stopped after");
        yield* chat.when.activate("Show work");
        yield* chat.when.pressEnding(". Show the checks");
        yield* chat.when.press("View of /orders on phone");
        const displayed = yield* Effect.promise(async () => {
          const selector = '[role="dialog"][aria-label="Expanded image preview"] img';
          await s.page.waitForFunction(
            (selector) => {
              const image = document.querySelector<HTMLImageElement>(selector);
              return (
                image !== null &&
                image.getBoundingClientRect().height > 0 &&
                image.complete &&
                image.naturalWidth > 0
              );
            },
            { timeout: 8000 },
            selector,
          );
          return s.page.$eval(selector, async (node) => {
            const image = node as HTMLImageElement;
            const response = await fetch(image.src);
            const bytes = new Uint8Array(await response.arrayBuffer());
            return {
              data: btoa(String.fromCharCode(...bytes)),
              width: image.naturalWidth,
              height: image.naturalHeight,
            };
          });
        });
        expect(displayed).toEqual({ data: picture, width: 1, height: 1 });
        yield* chat.when.key("Escape");
        yield* chat.when.pressEnding(". Hide the checks");
        yield* chat.then.control("/orders. Open the screenshot");
        yield* chat.then.control("/checkout. Open the screenshot", "button", false);
        yield* chat.then.control("/empty. Open the screenshot", "button", false);
        yield* chat.when.press("Toggle right panel");
        yield* s.then.noExternalNetwork;
      }),
    );

    // J07 · Z14/Z18/Z22/Z27/Z28: partial work survives failure and Stop has its own meaning.
    it.effect("J07: failure preserves partial work and the next prompt can recover", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([], { mate: "real" });
        yield* s.given.project("Ada", { mate: true });
        const chat = mateChat(s);
        const { server, provider, gate } = s.drivers.realMates.get("Ada")!;
        const conversationId = ConversationId.make("thread-Ada");
        const protocol = MATE_ENGINE_PROTOCOLS[0]!;
        const caller = { subject: "scenario-person", environmentId: "scenario", epoch: 1 };
        yield* server.engine.assignAgent(conversationId, {
          instanceId: "opencode",
          driver: "opencode",
          model: "gpt-5.4",
          profile: { kind: "mate" },
        });
        const changes = yield* Queue.unbounded<EngineConversationFrame>();
        yield* server.engine.wire.subscribe({ protocol, conversationId }, caller).pipe(
          Stream.runForEach((frame) => Queue.offer(changes, frame)),
          Effect.forkScoped,
        );
        while ((yield* Queue.take(changes)).type !== "synchronized") {}
        yield* provider.turn([
          resultTool(
            "kept",
            "Bash",
            { command: "printf partial-proof" },
            "The successful partial result remains",
          ),
          resultTool(
            "state",
            "mcp__zerops__zerops_status",
            {},
            yield* encodeJson({
              envelope: {
                phase: "develop-active",
                environment: "development",
                project: { id: "Ada", name: "Ada" },
                services: [],
                generated: DateTime.formatIso(yield* DateTime.now),
              },
            }),
          ),
          resultTool(
            "broken-dev",
            "mcp__zerops__zerops_dev_server",
            { action: "start", hostname: "appdev" },
            '{"action":"start","hostname":"appdev","running":false,"reason":"The dev server could not start","logTail":"Missing start script"}',
            true,
          ),
          { kind: "fail", message: "The agent process failed" },
        ]);
        expect(
          (yield* server.engine.wire.send(
            {
              protocol,
              conversationId,
              commandId: CommandId.make("run-one"),
              text: "Inspect the failing command",
            },
            caller,
          ))._tag,
        ).toBe("Accepted");
        while (true) {
          const frame = yield* Queue.take(changes);
          if (
            frame.type === "changes" &&
            frame.runs.some((run) => run.ordinal === 1 && run.state === "ended")
          )
            break;
        }
        yield* s.given.signedIn;
        yield* s.when.menu.opensMate("Ada");
        yield* s.then.conversation.showsMessage("Inspect the failing command");
        yield* chat.step(
          "one failure retains the successful partial work",
          chat.then.once("The agent process failed"),
        );
        yield* chat.step(
          "the eligible fix fills this Mate's draft without sending",
          Effect.gen(function* () {
            yield* chat.when.activate("Show work");
            yield* chat.then.control("Hide work");
            yield* chat.then.once("The agent process failed");
            yield* chat.when.press("Dev server on appdev failed. Show it");
            yield* chat.when.press("Ask Ada to fix it");
            yield* chat.then.composerText("appdev");
            yield* chat.then.composerText("Missing start script");
            expect(provider.sends).toHaveLength(1);
          }),
        );
        yield* chat.when.press("printf partial-proof. Show what it returned");
        yield* chat.then.text("The successful partial result remains");
        yield* provider.turn([{ kind: "say", text: "The follow-up check succeeded" }]);
        yield* chat.when.send("Continue from the successful check");
        yield* chat.then.sent("Continue from the successful check");
        const initial = yield* provider.received;
        expect(initial.input.input).toBe("Inspect the failing command");
        expect((yield* provider.received).input.input).toBe("Continue from the successful check");
        yield* chat.then.once("The follow-up check succeeded");
        const running = yield* Deferred.make<void>();
        yield* provider.turn([{ kind: "wait", until: running }]);
        yield* chat.when.send("Stop this inspection");
        expect((yield* provider.received).input.input).toBe("Stop this inspection");
        yield* chat.then.control("Stop generation");
        const stopReceipt = gate.answered((tag) => tag === "engine.stop");
        yield* chat.step(
          "Stop has a stopped outcome, separate from a crash",
          chat.when.press("Stop generation"),
        );
        const stopped = yield* Effect.promise(() => stopReceipt);
        expect(stopped).toMatchObject({ exit: { _tag: "Success", value: { _tag: "Accepted" } } });
        while (true) {
          const frame = yield* Queue.take(changes);
          const run =
            frame.type === "changes"
              ? frame.runs.find((run) => run.ordinal === 3 && run.state === "ended")
              : undefined;
          if (run) {
            expect(provider.sends.at(-1)?.threadId).toBe(initial.threadId);
            expect(run.end?.kind).toBe("stopped");
            break;
          }
        }
        yield* chat.then.text("Ada stopped");
        yield* chat.then.noButton("Create worktree");
        yield* chat.then.noButton("Pair");
        yield* s.then.noExternalNetwork;
      }),
    );
    // Retains the fake until crew task/review/refusal facts have an external source arrangement.
    // J10 · Z10/Z11/Z28/Z30/Z31: crew actions address the chosen crewmate, ordinary chat stays reachable.
    it.effect("J10: a crewmate keeps its own conversation, routing and runs-on identity", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installArea]);
        yield* s.given.project("Ada", { mate: true });
        const chat = mateChat(s);
        const wire = chat.fixture();
        wire.history();
        wire.seedCrew();
        yield* s.given.signedIn;
        yield* chat.when.open();
        wire.run("busy-main", "running");
        yield* chat.step(
          "a busy main cannot be archived",
          Effect.gen(function* () {
            yield* chat.when.press("More header actions");
            yield* chat.when.press("Archive and start fresh", "menuitem");
            yield* chat.then.text("Stop the agent before starting fresh");
            yield* chat.then.path("/env-Ada/thread-Ada");
            expect(wire.engine.applied.filter(({ op }) => op === "set-archived")).toEqual([]);
          }),
        );
        wire.run("busy-main", "completed");
        yield* chat.when.press("Toggle right panel");
        yield* chat.when.click("Crew");
        yield* chat.then.text("Inspect safely");
        yield* chat.step(
          "the reported landed task opens its own review",
          Effect.gen(function* () {
            yield* chat.when.click("Inspect the order schema");
            yield* chat.then.text("The order IDs are documented.");
            yield* chat.then.text("Check the order IDs.");
            yield* chat.when.key("Escape");
            yield* chat.then.reviewClosed;
          }),
        );
        yield* chat.step(
          "tell routes the selected handle to Scout",
          Effect.gen(function* () {
            yield* chat.when.fill(
              "Give the crew something to do…",
              "@scout Inspect the order keys",
            );
            yield* chat.when.press("Scout");
            yield* chat.when.press("Send to the crew");
            const tell = yield* Effect.promise(() => wire.waitForCrewCommand("tell"));
            expect(tell).toMatchObject({
              _tag: "tell",
              mentions: [{ handle: "scout" }],
              text: expect.stringContaining("Inspect the order keys"),
            });
          }),
        );
        yield* chat.when.press("Open Scout's conversation");
        yield* chat.then.path("/env-Ada/crew-scout");
        yield* chat.then.once("Scout has its own conversation");
        yield* chat.then.once("Scout's job changed — from its next message");
        yield* chat.then.text("Runs on");
        yield* chat.then.text("Codex");
        yield* chat.then.text("high");
        yield* chat.then.noButton("Create worktree");
        yield* chat.when.send("Read the orders schema");
        const message = yield* Effect.promise(() => wire.waitForCrewMessage());
        expect(message).toMatchObject({
          _tag: "message",
          handle: "scout",
          text: "Read the orders schema",
        });
        wire.crewRefusal = "Scout cannot change the code with this read-only login.";
        yield* chat.step(
          "a reported read-only denial keeps the unsent instruction",
          chat.when.send("Change the schema"),
        );
        yield* chat.then.text("Scout cannot change the code with this read-only login.");
        yield* chat.then.draft("Change the schema");
        yield* chat.then.noButton("Approve");
        yield* chat.when.open();
        yield* chat.then.path("/env-Ada/thread-Ada");
        yield* chat.then.once("The existing conversation is still here");
        yield* chat.when.type("/mcp");
        yield* chat.when.key("Enter");
        yield* chat.then.text("MCP servers");
        yield* chat.then.text("inspector");
        yield* chat.when.click("inspector");
        yield* chat.when.press("Turn off");
        yield* chat.then.control("Turn on");
        expect(wire.mcpActions).toEqual([
          expect.objectContaining({ name: "inspector", enabled: false, threadId: "thread-Ada" }),
        ]);
        yield* chat.when.press("Close MCP");
        yield* chat.when.press("Open Scout's conversation");
        yield* chat.then.once("Scout has its own conversation");
        yield* chat.when.open();
        yield* chat.step(
          "ordinary chats keep their order and a new main stays reachable",
          Effect.gen(function* () {
            const main = yield* Schema.decodeEffect(OrchestrationThread)({
              ...wire.mate.thread,
              pinnedAt: wire.at(),
            });
            const legacy = yield* Schema.decodeUnknownEffect(OrchestrationThread)({
              ...main,
              id: "legacy-Ada",
              title: "Earlier inspection",
              pinnedAt: null,
              pinOrderKey: null,
              createdAt: "2026-10-03T12:00:00.000Z",
              latestTurn: null,
              session: null,
              messages: [],
              activities: [],
            });
            const recent = yield* Schema.decodeUnknownEffect(OrchestrationThread)({
              ...legacy,
              id: "recent-Ada",
              title: "Later inspection",
              createdAt: "2026-10-06T12:00:00.000Z",
            });
            const scout = wire.otherThreads.get("crew-scout")!;
            wire.threadCollection(main, [recent, legacy, scout]);
            yield* chat.when.press("Ada's chats");
            yield* chat.then.chatChoices([
              "Ada conversation main",
              "Earlier inspection",
              "Later inspection",
            ]);
            wire.threadCollection(main, [{ ...legacy, updatedAt: wire.at() }, recent, scout]);
            yield* chat.then.chatChoices([
              "Ada conversation main",
              "Earlier inspection",
              "Later inspection",
            ]);
            yield* chat.when.key("Escape");
            const replacement = yield* Schema.decodeUnknownEffect(OrchestrationThread)({
              ...main,
              id: "replacement-Ada",
              title: "Replacement conversation",
              createdAt: wire.at(),
              messages: [],
              activities: [],
              latestTurn: null,
              session: null,
            });
            wire.threadCollection(replacement, [legacy, recent, scout]);
            wire.engine.conversation(replacement.id).personTurn("The replacement main is readable");
            yield* reportConversation(s.drivers, "Ada", {
              id: replacement.id,
              title: replacement.title,
            });
            yield* reportAttention(s.drivers, "Ada", {
              mainThreadId: replacement.id,
              lastThreadId: replacement.id,
              results: [],
            });
            yield* chat.when.openReadOnly();
            yield* chat.then.path("/env-Ada/replacement-Ada");
            yield* chat.then.once("The replacement main is readable");
            yield* chat.then.control("Ada, Unseen reply", "button", false);
          }),
        );
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
