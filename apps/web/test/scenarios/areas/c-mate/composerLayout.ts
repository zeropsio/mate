import {
  CommandId,
  ConversationId,
  MATE_ENGINE_PROTOCOLS,
  ProviderDriverKind,
  type EngineConversationFrame,
} from "@t3tools/contracts";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import { CLAUDE_SCENARIO_CODE } from "../../../../../server/integration/scriptedClaudeSignIn.ts";
import { changeFixture } from "../../fakes/d-change/changes.ts";
import { createScenario } from "../../harness/scenario.ts";
import { mateChat } from "./dsl.ts";

// "notice": an older session's compaction is offered — a row at the conversation's end since S6.
export const composerStates = ["plain", "notice", "review"] as const;

/** How long the notice's session stands idle before it is offered compaction. */
const NOTICE_IDLE_MS = 71 * 60_000;
/**
 * The idle hour passes in steps inside the Mate's fifteen-minute hold on HQ's access list (with
 * room for the time the case took before it), each one followed by a fresh view from HQ.
 */
const NOTICE_STEP_MS = 10 * 60_000;
/** Past every Core wait the steps move through, so the view refresh is the only one that ends. */
const NOTICE_CORE_PERIOD_MS = 3 * 60 * 60_000;

// Shared real-client input for geometry and the separate transparency compatibility check.
export const composerLayout = Effect.fn("composerLayout")(function* (
  state: (typeof composerStates)[number] | "before-notice",
) {
  const claude = state === "notice" || state === "before-notice";
  const s = yield* createScenario([], {
    mate: "real",
    ...(state === "notice"
      ? {
          hq: {
            pingEvery: NOTICE_CORE_PERIOD_MS,
            reconcileEvery: NOTICE_CORE_PERIOD_MS,
            streamRecheck: NOTICE_CORE_PERIOD_MS,
          },
        }
      : {}),
  });
  yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
  if (state === "review") yield* changeFixture(s);
  else
    yield* s.given.project("Ada", {
      mate: true,
      ...(claude
        ? { provider: { driverKind: ProviderDriverKind.make("claudeAgent") }, claudeSignIn: true }
        : {}),
    });
  const chat = mateChat(s);
  const exchanges = [
    ...Array.from(
      { length: 25 },
      (_, i) =>
        [
          `Earlier question ${i}`,
          "> Important: keep this conversation readable.\n\n".repeat(8),
        ] as const,
    ),
    ["Finish here", "The last answer is above the composer."] as const,
  ];
  const mate = s.drivers.realMates.get("Ada")!;
  yield* s.given.signedIn;
  yield* chat.when.openReadOnly();
  if (claude)
    yield* Effect.promise(async () => {
      await s.page.locator('button[data-agent-id="claude-code"]').click();
      await s.page.waitForSelector(
        '[data-sign-in-open="claude-code"][href^="https://claude.scenario.invalid/oauth/authorize"]',
        { visible: true },
      );
      await s.page.waitForSelector("[data-sign-in-code]", { visible: true });
      await s.page.type("[data-sign-in-code]", CLAUDE_SCENARIO_CODE);
      await s.page.keyboard.press("Enter");
      await s.page.waitForSelector('[role="textbox"]:not([inert] *)', {
        visible: true,
      });
    });
  yield* mate.provider.turn([{ kind: "say", text: exchanges[0]![1] }]);
  yield* chat.when.send(exchanges[0]![0]);
  yield* mate.provider.received;
  yield* Effect.promise(() =>
    s.page.waitForFunction(() => !location.pathname.startsWith("/draft/"), {
      polling: "raf",
    }),
  );
  const conversationId = ConversationId.make(new URL(s.page.url()).pathname.split("/").at(-1)!);
  const protocol = MATE_ENGINE_PROTOCOLS[0]!;
  const caller = {
    subject: claude ? "zerops-user:owner" : "scenario-person",
    environmentId: "scenario",
    epoch: 1,
  };
  const frames = yield* Queue.unbounded<EngineConversationFrame>();
  yield* mate.server.engine.wire.subscribe({ protocol, conversationId }, caller).pipe(
    Stream.runForEach((frame) => Queue.offer(frames, frame)),
    Effect.forkScoped,
  );
  const ended = (ordinal: number) =>
    Effect.gen(function* () {
      while (true) {
        const frame = yield* Queue.take(frames);
        if (
          (frame.type === "snapshot" || frame.type === "changes") &&
          frame.runs.some((run) => run.ordinal === ordinal && run.state === "ended")
        )
          return;
      }
    }).pipe(Effect.timeout("8 seconds"));
  yield* ended(1);
  for (const [index, [question, answer]] of exchanges.entries()) {
    if (index === 0) continue;
    yield* mate.provider.turn([{ kind: "say", text: answer }]);
    const receipt = yield* mate.server.engine.wire.send(
      {
        protocol,
        conversationId,
        commandId: CommandId.make(`composer-history-${index}`),
        text: question,
      },
      caller,
    );
    expect(receipt._tag).toBe("Accepted");
    expect((yield* mate.provider.received).input.input).toBe(question);
    yield* ended(index + 1);
  }
  if (claude) yield* Effect.promise(() => s.clock.install());
  yield* Effect.promise(() => s.page.reload());
  yield* chat.then.text("The last answer is above the composer.");
  // Reload measurement uses positive-delay callbacks; settle them before reading the baseline.
  if (state === "before-notice") yield* Effect.promise(() => s.clock.advanceStepped(1000));
  const noticeArrives = Effect.gen(function* () {
    const mate = s.drivers.realMates.get("Ada")!;
    yield* mate.provider.event(mate.provider.sends.at(-1)!.threadId, {
      type: "thread.token-usage.updated",
      payload: { usage: { usedTokens: 180_000 } },
    });
    const core = s.drivers.core;
    // The embedded Core sends the Mate no list to renew (an older access frame): one jump.
    if (core.kind === "in-process") {
      yield* Effect.promise(() => s.clock.advance(NOTICE_IDLE_MS, true));
      return;
    }
    for (let left = NOTICE_IDLE_MS; left > 0; left -= NOTICE_STEP_MS) {
      yield* Effect.promise(() => s.clock.advance(Math.min(left, NOTICE_STEP_MS), true));
      const at = s.drivers.zerops.clock.currentTimeMillis();
      yield* core.clock.advance(core.periods.viewRefresh);
      // Held state, not a receipt: an unchanged list fires no change on the Mate.
      yield* mate.server.accessList.pipe(
        Effect.repeat({
          until: (list) => Option.isSome(list) && list.value.heardAtMs >= at,
          schedule: Schedule.spaced("10 millis"),
        }),
      );
    }
  });
  if (state === "notice") yield* noticeArrives;
  yield* Effect.promise(() =>
    s.page.waitForFunction(
      () => {
        const list = document.querySelector<HTMLElement>(".timeline-legend-list");
        return (
          list &&
          !document.querySelector(
            '[data-conversation-opening]:not([data-conversation-opening="complete"])',
          ) &&
          !document.querySelector("[data-timeline-placing]") &&
          Math.abs(list.scrollHeight - list.clientHeight - list.scrollTop) <= 2
        );
      },
      { polling: "raf" },
    ),
  );
  if (state === "notice") yield* chat.then.text("Resume with less context");
  // What waits for review stands in the conversation's header (2026-10-13), not on the composer.
  if (state === "review")
    yield* Effect.promise(() =>
      s.page.waitForSelector('.chat-header-review [data-zerops-surface="sidebar-project-review"]', {
        visible: true,
      }),
    );

  return { s, chat, noticeArrives };
});
