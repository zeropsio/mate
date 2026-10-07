import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import * as Schema from "effect/Schema";
import { OrchestrationThread, ZeropsLifecycle } from "@t3tools/contracts";
import { reportAttention, reportConversation, startStageBuild } from "../b-menu/fake.ts";
import { installArea } from "./fake.ts";
import { mateChat } from "./dsl.ts";

// These are reported provider facts; the fake never executes commands or git.
describe("C: calls, results and crew actions", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // J06 · Z12/Z13/Z16–Z19/Z21/Z25/Z29/Z33: distinct calls retain their recorded outputs.
    it.effect("J06: concurrent calls stay readable through settlement and reload", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installArea]);
        yield* s.given.project("Ada", { mate: true });
        const chat = mateChat(s);
        const wire = chat.fixture();
        wire.history("Inspect the two commands", "run-one");
        wire.run("run-one", "running");
        wire.message(
          "thought",
          "reasoning",
          "I will inspect both commands independently",
          "run-one",
        );
        wire.tool("call-a", "tool.started", { toolName: "Bash", command: "printf first-proof" });
        wire.tool("call-b", "tool.started", { toolName: "Bash", command: "printf second-proof" });
        yield* s.given.signedIn;
        yield* chat.step(
          "concurrent work keeps the composer usable",
          chat.when.open("Ada", "Inspect the two commands"),
        );
        yield* chat.then.control("Stop generation");
        yield* chat.when.type("I can type while work arrives");
        wire.tool("call-b", "tool.completed", {
          toolName: "Bash",
          command: "printf second-proof",
          rawOutput: { content: "Second command returned its own result" },
        });
        wire.tool("call-a", "tool.completed", {
          toolName: "Bash",
          command: "printf first-proof",
          rawOutput: { content: "First command returned its own result" },
        });
        wire.tool("call-no-result", "tool.updated", {
          toolName: "Bash",
          command: "printf unreturned-proof",
        });
        wire.tool(
          "write-one",
          "tool.completed",
          {
            toolName: "Write",
            wrote: true,
            input: { file_path: "/srv/app/summary.txt", content: "Recorded first write" },
            result: "Written",
          },
          "run-one",
          { itemType: "file_change", wroteFile: true },
        );
        wire.writes.set("write-one", [
          {
            path: "/srv/app/summary.txt",
            kind: "write",
            changes: [{ text: "Recorded first write", removedLines: 0 }],
            truncated: false,
          },
        ]);
        wire.tool("empty-call", "tool.completed", {
          toolName: "Bash",
          command: "printf empty-proof",
          rawOutput: { content: "" },
        });
        wire.tool(
          "malformed",
          "tool.completed",
          {
            toolName: "mcp__inspector__inspect",
            input: { query: "orders" },
            result: {
              content: '{"notice":"The inspector returned a structured observation","count":2}',
            },
          },
          "run-one",
          {
            itemType: "mcp_tool_call",
            detail: '{"notice":"The inspector returned a structured observation","count":2}',
          },
        );
        yield* startStageBuild(s.drivers, "Ada");
        wire.lifecycle = yield* Schema.decodeEffect(ZeropsLifecycle)({
          threadId: "thread-Ada",
          envelope: {
            phase: "develop-active",
            environment: "development",
            project: { id: "Ada", name: "Ada" },
            services: [],
            generated: wire.at(),
          },
          recentTools: [],
        });
        wire.publishLifecycle();
        wire.tool(
          "deploy-refused",
          "tool.completed",
          {
            toolName: "mcp__zerops__zerops_deploy",
            input: { targetService: "app" },
            zerops: {
              toolName: "zerops_deploy",
              resultText:
                '{"code":"BUILD_FAILED","error":"The first build lacked its configuration","suggestion":"Correct the config and retry"}',
            },
          },
          "run-one",
          { itemType: "mcp_tool_call", status: "failed" },
        );
        wire.tool(
          "deploy-first",
          "tool.completed",
          {
            toolName: "mcp__zerops__zerops_deploy",
            input: { targetService: "app" },
            result: {
              status: "BUILD_TRIGGERED",
              targetService: "app",
              message: "Build triggered.",
              appVersionId: "building-Ada",
            },
            zerops: {
              toolName: "zerops_deploy",
              resultText:
                '{"status":"BUILD_TRIGGERED","targetService":"app","message":"Build triggered.","appVersionId":"building-Ada"}',
            },
          },
          "run-one",
          { itemType: "mcp_tool_call" },
        );
        wire.tool(
          "helper-launch",
          "tool.updated",
          {
            toolName: "Agent",
            input: {
              description: "Schema helper",
              prompt: "Inspect the key",
              subagent_type: "explorer",
            },
          },
          "run-one",
          { itemType: "collab_agent_tool_call" },
        );
        wire.activity(
          "task.started",
          "Helper began",
          {
            taskId: "schema-helper",
            agentKind: "agent",
            toolUseId: "helper-launch",
            taskType: "local_agent",
            title: "Schema helper",
            role: "explorer",
          },
          "run-one",
        );
        wire.activity(
          "task.completed",
          "Helper completed",
          {
            taskId: "schema-helper",
            agentKind: "agent",
            toolUseId: "helper-launch",
            status: "completed",
            summary: "The helper checked the key independently",
            role: "explorer",
          },
          "run-one",
        );
        wire.tool(
          "write-two",
          "tool.completed",
          {
            toolName: "Edit",
            wrote: true,
            input: {
              file_path: "/srv/app/summary.txt",
              old_string: "Recorded first write",
              new_string: "Recorded later write",
            },
            result: "Edited",
          },
          "run-one",
          { itemType: "file_change" },
        );
        wire.writes.set("write-two", [
          {
            path: "/srv/app/summary.txt",
            kind: "write",
            changes: [{ text: "Recorded later write", removedLines: 1 }],
            truncated: false,
          },
        ]);
        wire.message(
          "answer-one",
          "assistant",
          "Both completed commands were inspected",
          "run-one",
        );
        wire.run("run-one", "completed", null, "answer-one");
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
        yield* chat.step(
          "identified browser evidence belongs to its check, even when frames arrive out of order",
          Effect.gen(function* () {
            const picture =
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7e8AAAAASUVORK5CYII=";
            wire.message(
              "browser-ask",
              "user",
              "Check the order and checkout pages",
              "browser-run",
            );
            wire.run("browser-run", "running");
            for (const [callId, path] of [
              ["browser-order", "orders"],
              ["browser-checkout", "checkout"],
            ]) {
              wire.tool(
                callId!,
                "tool.completed",
                {
                  toolName: "mcp__zerops__zerops_browser",
                  input: { commands: [["open", `https://store.example/${path}`]] },
                  zerops: {
                    toolName: "zerops_browser",
                    resultText: `{"url":"https://store.example/${path}","steps":[]}`,
                  },
                },
                "browser-run",
                { itemType: "mcp_tool_call" },
              );
            }
            wire.browser({
              type: "call-result",
              callId: "browser-order",
              threadId: "thread-Ada",
              turnId: "browser-run",
              revision: 2,
              completeness: "complete",
              frame: { type: "frame", mimeType: "image/png", data: picture, width: 1, height: 1 },
            });
            wire.browser({
              type: "call-result",
              callId: "browser-checkout",
              threadId: "thread-Ada",
              turnId: "older-run",
              revision: 9,
              completeness: "complete",
              frame: { type: "frame", mimeType: "image/png", data: picture, width: 1, height: 1 },
            });
            wire.message("browser-answer", "assistant", "The page checks returned", "browser-run");
            wire.run("browser-run", "completed", null, "browser-answer");
            yield* chat.then.once("The page checks returned");
            yield* chat.when.activate("Show work");
            yield* chat.when.press(
              "Checked /orders and /checkout in the browser, 2 checks passed. Show the checks",
            );
            yield* chat.when.press("/orders. Open the screenshot");
            yield* chat.then.picture(picture);
            yield* chat.when.key("Escape");
            yield* chat.then.control("/checkout. Open the screenshot", "button", false);
            wire.browser({
              type: "call-result",
              callId: "browser-order",
              threadId: "thread-Ada",
              turnId: "browser-run",
              revision: 3,
              completeness: "partial",
            });
            yield* chat.then.control("/orders. Open the screenshot");
            wire.browser({
              type: "call-result",
              callId: "browser-order",
              threadId: "thread-Ada",
              turnId: "browser-run",
              revision: 4,
              completeness: "complete",
              frame: null,
            });
            yield* chat.then.control("/orders. Open the screenshot", "button", false);
          }),
        );
        yield* s.then.noExternalNetwork;
      }),
    );

    // J07 · Z14/Z18/Z22/Z27/Z28: partial work survives failure and Stop has its own meaning.
    it.effect("J07: failure preserves partial work and the next prompt can recover", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installArea]);
        yield* s.given.project("Ada", { mate: true });
        const chat = mateChat(s);
        const wire = chat.fixture();
        wire.history("Inspect the failing command", "run-one");
        wire.lifecycle = yield* Schema.decodeEffect(ZeropsLifecycle)({
          threadId: "thread-Ada",
          envelope: {
            phase: "develop-active",
            environment: "development",
            project: { id: "Ada", name: "Ada" },
            services: [],
            generated: wire.at(),
          },
          recentTools: [],
        });
        wire.run("run-one", "running");
        wire.tool("kept", "tool.completed", {
          toolName: "Bash",
          command: "printf partial-proof",
          rawOutput: { content: "The successful partial result remains" },
        });
        wire.tool(
          "broken-dev",
          "tool.completed",
          {
            toolName: "mcp__zerops__zerops_dev_server",
            input: { action: "start", hostname: "appdev" },
            zerops: {
              toolName: "zerops_dev_server",
              resultText:
                '{"action":"start","hostname":"appdev","running":false,"reason":"The dev server could not start","logTail":"Missing start script"}',
            },
          },
          "run-one",
          { itemType: "mcp_tool_call", status: "failed" },
        );
        wire.activity(
          "runtime.error",
          "The agent process failed",
          { message: "The agent process failed", turnEnd: "crash" },
          "run-one",
        );
        wire.run("run-one", "error", "The agent process failed");
        yield* reportConversation(
          s.drivers,
          "Ada",
          {
            latestTurn: wire.mate.thread.latestTurn,
            session: { status: "error", lastError: "The agent process failed" },
          },
          "failed",
        );
        yield* s.given.signedIn;
        yield* chat.when.open("Ada", "Inspect the failing command");
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
            expect(wire.sentTurnCount()).toBe(0);
          }),
        );
        wire.checkpoint("run-one");
        yield* chat.when.press("Toggle right panel");
        yield* chat.when.click("Diff");
        yield* chat.when.press("Diff scope: Working tree");
        yield* chat.when.press("Latest turn", "menuitemradio");
        yield* chat.then.text("appdev");
        yield* chat.then.text("apidev");
        yield* chat.then.text("Recorded order total");
        yield* chat.then.text("apidev could not be captured; retry that repository");
        expect(wire.diffs).toContainEqual(
          expect.objectContaining({ threadId: "thread-Ada", runId: "run-one", rootId: "app-root" }),
        );
        yield* chat.when.press("Toggle right panel");
        yield* chat.when.press("printf partial-proof. Show what it returned");
        yield* chat.then.text("The successful partial result remains");
        yield* chat.step(
          "a refused rewind retains the captured work and names the retry",
          Effect.gen(function* () {
            wire.revertRefusal =
              "appdev changes are retained; apidev is unavailable. Reconnect apidev and retry.";
            yield* chat.when.press("Revert to this message");
            yield* chat.then.text("Workspace files stay as they are");
            yield* chat.when.press("Revert and keep changes");
            const refused = yield* Effect.promise(() =>
              wire.waitForCommand("thread.checkpoint.revert"),
            );
            expect(refused).toMatchObject({
              threadId: "thread-Ada",
              turnCount: 0,
              restoreFiles: false,
            });
            yield* chat.then.text("Reconnect apidev and retry.");
            yield* chat.then.text("The successful partial result remains");
            wire.revertRefusal = null;
          }),
        );
        yield* chat.when.send("Continue from the successful check");
        yield* chat.then.sent("Continue from the successful check");
        const sent = yield* Effect.promise(() => wire.waitForCommand("thread.turn.start"));
        expect(sent).toMatchObject({
          threadId: "thread-Ada",
          message: { text: "Continue from the successful check" },
        });
        wire.run("recovery", "running");
        wire.message("recovered", "assistant", "The follow-up check succeeded", "recovery");
        wire.run("recovery", "completed");
        yield* chat.then.once("The follow-up check succeeded");
        wire.message("stop-ask", "user", "Stop this inspection", "stop-run");
        wire.run("stop-run", "running");
        yield* chat.step(
          "Stop has a stopped outcome, separate from a crash",
          chat.when.press("Stop generation"),
        );
        const stopped = yield* Effect.promise(() => wire.waitForCommand("thread.turn.interrupt"));
        expect(stopped).toMatchObject({ threadId: "thread-Ada" });
        wire.run("stop-run", "interrupted");
        yield* chat.then.text("Ada stopped");
        yield* chat.then.noButton("Create worktree");
        yield* chat.then.noButton("Pair");
        yield* s.then.noExternalNetwork;
      }),
    );
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
            expect(wire.commands.filter((command) => command.type === "thread.archive")).toEqual(
              [],
            );
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
              messages: [
                {
                  ...main.messages[0]!,
                  id: "replacement-history",
                  text: "The replacement main is readable",
                },
              ],
              activities: [],
              latestTurn: null,
              session: null,
            });
            wire.threadCollection(replacement, [legacy, recent, scout]);
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
