import * as Schema from "effect/Schema";
import {
  OrchestrationThreadDetailSnapshot,
  OrchestrationThreadDetailPage,
  OrchestrationLatestTurn,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import {
  reportConversation,
  reportAttention,
  restartMate,
  relayAttention,
  speakFromRunBefore,
} from "../b-menu/fake.ts";
import { installArea } from "./fake.ts";
import { mateChat } from "./dsl.ts";

// J04 · Z12/Z24/Z25/Z26/Z34: HTTP history, replay and a parked draft are one readable conversation.
describe("C: reading, replay and attention", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("J04: HTTP history remains usable during catchup and duplicate replay", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installArea]);
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.project("Bea", { mate: true, app: "Shop" });
        s.given.person("dev", {
          role: "Developer",
          grants: { Ada: "BASIC_USER", Bea: "BASIC_USER" },
        });
        const chat = mateChat(s);
        const wire = chat.fixture();
        wire.history("Read this older deployment decision");
        chat.fixture("Bea").history("Bea's conversation history");
        wire.page = yield* Schema.decodeUnknownEffect(OrchestrationThreadDetailPage)({
          beforeCursor: "before-decision",
          hasMore: true,
          snapshotSequence: wire.mate.sequence,
        });
        const older = yield* Schema.decodeUnknownEffect(OrchestrationThreadDetailSnapshot)({
          snapshotSequence: wire.mate.sequence,
          thread: {
            ...wire.mate.thread,
            messages: [
              {
                id: "removed-page",
                role: "assistant",
                text: "The superseded approval must not come back",
                turnId: null,
                streaming: false,
                createdAt: "2026-10-04T12:00:00.000Z",
                updatedAt: "2026-10-04T12:00:00.000Z",
              },
            ],
          },
          page: { beforeCursor: null, hasMore: false, snapshotSequence: wire.mate.sequence },
        });
        const latePage = wire.holdPage("before-decision", older);
        wire.holdReplay = true;
        yield* s.given.signedIn;
        yield* chat.when.open("Ada", "Read this older deployment decision");
        expect(
          wire.http.find((request) => request.includes("/api/orchestration/threads/")),
        ).toContain("turnLimit=1");
        yield* Effect.promise(() => wire.replaySubscribed());
        yield* chat.then.control("Syncing messages...", "");
        yield* chat.then.once("Read this older deployment decision");
        yield* chat.when.type("Keep my reading draft");
        wire.message("reply-one", "assistant", "The deployment was checked once");
        wire.replayEvents();
        wire.replayEvents();
        yield* chat.then.once("The deployment was checked once");
        yield* chat.then.control("Syncing messages...", "");
        wire.ready();
        yield* chat.then.control("Syncing messages...", "", false);
        yield* chat.then.draft("Keep my reading draft");
        yield* chat.step(
          "a rewrite supersedes an older page already in flight",
          Effect.gen(function* () {
            yield* chat.when.press("Load earlier turns");
            yield* Effect.promise(() => latePage.requested());
            wire.event("thread.reverted", { threadId: wire.mate.thread.id, turnCount: 0 });
            wire.page = undefined;
            wire.snapshot({ messages: [], activities: [], latestTurn: null });
            wire.message("rewritten", "assistant", "The rewritten conversation is authoritative");
            yield* chat.then.once("The rewritten conversation is authoritative");
            const response = s.page.waitForResponse(
              (response) =>
                response.request().method() === "GET" &&
                response.url().includes("beforeCursor=before-decision"),
            );
            latePage.release();
            yield* Effect.promise(async () => {
              await (await response).json();
            });
            yield* chat.then.control("Load earlier turns", "button", false);
            yield* chat.then.noText("The superseded approval must not come back");
            yield* chat.then.noText("Read this older deployment decision");
          }),
        );
        wire.message("reading", "assistant", "This is the older message I am reading");
        yield* chat.when.read("This is the older message I am reading");
        for (const label of [
          "Inspect catalog",
          "Inspect schema",
          "Inspect grants",
          "Inspect routes",
          "Inspect assets",
          "Inspect deploy",
        ]) {
          wire.message(
            `trace-${label}`,
            "assistant",
            `${label}: a distinct streamed result`,
            null,
            { streaming: true },
          );
        }
        yield* chat.then.reading("This is the older message I am reading");
        yield* chat.then.draft("Keep my reading draft");
        yield* chat.step(
          "the dropped transport catches up before it claims readiness",
          Effect.gen(function* () {
            wire.holdReplay = true;
            wire.disconnect();
            yield* Effect.promise(() => wire.replaySubscribed());
            yield* chat.then.control("Syncing messages...", "");
            wire.replayEvents();
            wire.ready();
            yield* chat.then.control("Syncing messages...", "", false);
            yield* chat.then.draft("Keep my reading draft");
            yield* chat.then.once("The rewritten conversation is authoritative");
          }),
        );
        yield* chat.when.open("Bea", "Bea's conversation history");
        wire.message("parked-answer", "assistant", "Ada continued while you read Bea");
        yield* chat.when.open("Ada", "The rewritten conversation is authoritative");
        yield* chat.then.once("Ada continued while you read Bea");
        yield* chat.then.draft("Keep my reading draft");
        yield* chat.when.key("Enter");
        yield* chat.then.sent("Keep my reading draft");
        yield* chat.then.once("This is the older message I am reading");
        yield* chat.when.reload("Ada", "Keep my reading draft");
        yield* chat.then.once("The rewritten conversation is authoritative");
        yield* chat.then.noText("The superseded approval must not come back");
        yield* chat.then.once("Ada continued while you read Bea");
        yield* s.then.noExternalNetwork;
      }),
    );

    // J08 · Z15/Z23/Z26/Z35: a source pause and a person's resume choice survive reload.
    it.effect("J08: usage pause holds work and both resume choices survive source replay", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installArea]);
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.project("Bea", { mate: true, app: "Shop" });
        s.given.person("dev", {
          role: "Developer",
          grants: { Ada: "BASIC_USER", Bea: "BASIC_USER" },
        });
        const chat = mateChat(s);
        const wire = chat.fixture();
        wire.history();
        chat.fixture("Bea").history("Bea is the conversation I parked on");
        yield* s.given.signedIn;
        yield* chat.when.open();
        wire.run("pause-run", "running");
        wire.activity(
          "runtime.error",
          "Usage limit reached",
          {
            message: "You've hit your limit · resets later",
            turnEnd: "usage-limit",
            usageLimit: { resetsAt: "2099-10-07T14:00:00.000Z", window: "5-hour" },
          },
          "pause-run",
        );
        wire.run("pause-run", "error");
        wire.usagePause = {
          resetsAt: "2099-10-07T14:00:00.000Z",
          window: "5-hour",
          held: 2,
          pausedAt: "2026-10-07T12:00:00.000Z",
          autoResume: true,
        };
        wire.event("thread.usage-pause-set", {
          threadId: wire.mate.thread.id,
          usagePause: wire.usagePause,
        });
        wire.shell();
        yield* reportConversation(s.drivers, "Ada", { usagePause: wire.usagePause });
        yield* chat.then.text("Ada hit the coding agent's limit.");
        yield* Effect.promise(async () => {
          const marker = await s.page.waitForSelector(
            '[data-zerops-mate-row="Ada"] [role="status"]',
            { visible: true, timeout: 8000 },
          );
          expect(await marker?.evaluate((node) => node.textContent)).toContain("Limit");
          expect(
            await s.page.$eval('[data-zerops-mate-row="Ada"] button', (node) =>
              node.getAttribute("aria-label"),
            ),
          ).toBe("Ada, Provider limit");
        });
        yield* chat.then.control("Continue automatically", "switch");
        yield* chat.step(
          "the person's resume choice is acknowledged by the source",
          chat.when.press("Continue automatically", "switch"),
        );
        const off = yield* Effect.promise(() =>
          wire.waitForCommand("thread.usage-auto-resume.set"),
        );
        expect(off).toMatchObject({ threadId: "thread-Ada", enabled: false });
        yield* chat.then.text("Automatic continuation is off");
        yield* chat.when.reload();
        yield* chat.then.text("Automatic continuation is off");
        yield* chat.when.press("Continue automatically", "switch");
        const on = yield* Effect.promise(() =>
          wire.waitForCommand("thread.usage-auto-resume.set", 2),
        );
        expect(on).toMatchObject({ threadId: "thread-Ada", enabled: true });
        yield* chat.then.text("try again automatically");
        wire.usagePause = null;
        wire.event("thread.usage-pause-set", { threadId: wire.mate.thread.id, usagePause: null });
        wire.shell();
        wire.run("response-run", "running");
        wire.question();
        yield* chat.then.text("Which environment should I inspect?");
        yield* chat.when.click("Staging");
        wire.run("response-run", "completed");
        yield* chat.then.once("Agent received your response");
        expect(wire.receivedStagingAnswer()).toBe(true);
        yield* chat.step(
          "a source epoch and each person's reading evidence keep their own meaning",
          Effect.gen(function* () {
            const colleague = yield* s.given.browserActor({ person: "dev" });
            yield* colleague.given.signedIn;
            const theirs = mateChat({ ...s, ...colleague });
            yield* chat.when.open("Bea", "Bea is the conversation I parked on");
            yield* theirs.when.open("Bea", "Bea is the conversation I parked on");
            wire.run("attention-result", "running");
            wire.message(
              "attention-reply",
              "assistant",
              "Ada finished the newer inspection",
              "attention-result",
            );
            wire.run("attention-result", "completed", null, "attention-reply");
            const completedAt = wire.mate.thread.latestTurn!.completedAt!;
            const latestTurn = yield* Schema.decodeUnknownEffect(OrchestrationLatestTurn)({
              turnId: "attention-result",
              state: "completed",
              requestedAt: completedAt,
              startedAt: completedAt,
              completedAt,
              assistantMessageId: null,
            });
            const results = [
              {
                threadId: ThreadId.make("thread-Ada"),
                turnId: TurnId.make("attention-result"),
                completedAt,
              },
            ];
            yield* reportConversation(s.drivers, "Ada", {
              latestTurn,
              session: { status: "ready", lastError: null },
            });
            yield* reportAttention(s.drivers, "Ada", { results });
            yield* chat.then.control("Ada, Unseen reply");
            yield* theirs.then.control("Ada, Unseen reply");
            yield* chat.when.open();
            yield* chat.when.read("Ada finished the newer inspection");
            yield* chat.then.control("Ada, Unseen reply", "button", false);
            yield* theirs.then.control("Ada, Unseen reply");
            yield* restartMate(s.drivers, "Ada");
            yield* relayAttention(s.drivers, "Ada", { results });
            yield* theirs.then.control("Ada, Unseen reply");
            yield* speakFromRunBefore(s.drivers, "Ada", {
              working: 1,
              waiting: 0,
              results: [],
              questions: [],
            });
            yield* relayAttention(s.drivers, "Ada", { results });
            yield* theirs.then.control("Ada, Unseen reply");
            yield* chat.when.press("Account: owner");
            yield* chat.when.press("Sign out", "menuitem");
            yield* chat.then.control("Continue with your Zerops account");
            wire.message(
              "late-account",
              "assistant",
              "This late reply belongs to the closed account",
            );
            wire.browser({ type: "state", status: "live", title: "Old account's browser" });
            yield* chat.then.noText("This late reply belongs to the closed account");
            yield* chat.then.noText("Old account's browser");
            yield* chat.then.noText("The existing conversation is still here");
          }),
        );
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
