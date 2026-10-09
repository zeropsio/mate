import { describe, expect, it } from "@effect/vitest";
import { ConversationRow, TurnId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { menuScenario } from "./dsl.ts";
import { reportConversation } from "./fake.ts";

const ROW = '[data-zerops-surface="sidebar-mate"]';
const ASK = "Keep the running row steady";
type Witness = {
  failures: string[];
  initialClock: string | null | undefined;
  observer: MutationObserver;
};

describe("B: running row refresh", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "a running row keeps known content and height through identical and advancing refreshes",
      () =>
        Effect.gen(function* () {
          const s = yield* menuScenario();
          yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
          yield* s.given.project("Ada", { mate: true });
          yield* s.given.signedIn;
          yield* s.then.menu.row("Ada").appears();
          const mate = s.drivers.mates.get("Ada")!;
          const since = DateTime.formatIso(
            DateTime.makeUnsafe((yield* Clock.currentTimeMillis) - 12_000),
          );
          const patch = {
            session: { status: "running" as const, lastError: null },
            latestUserMessagePreview: { text: ASK },
            liveStep: { kind: "thinking" as const, since },
            latestTurn: {
              turnId: TurnId.make("run-refresh"),
              state: "running" as const,
              requestedAt: since,
              startedAt: since,
              completedAt: null,
            },
          };
          const row = yield* Schema.decodeUnknownEffect(ConversationRow)({
            conversationId: mate.shellThread().id,
            agent: null,
            revision: { environmentId: mate.descriptor.environmentId, epoch: 1, seq: 1 },
            state: { kind: "working", since: Date.parse(since), waitsOnHelpers: false },
            activeRunId: "run-refresh",
            latestRun: null,
            subject: ASK,
            snippet: null,
            at: Date.parse(since),
            askedAt: Date.parse(since),
          });
          yield* reportConversation(s.drivers, "Ada", patch, "working");
          yield* s.menu.text("Ada", "Thinking", "sidebar-mate-live-step");
          // Observe transient DOM states between deliveries as well as timer ticks.
          yield* Effect.promise(() =>
            s.page.evaluate(
              (selector, ask) => {
                const row = document.querySelector<HTMLElement>(selector)!;
                const initialHeight = row.getBoundingClientRect().height;
                const initialClock = row.querySelector(".menu-clock")?.textContent;
                const failures: string[] = [];
                const sample = () => {
                  if (!row.isConnected) failures.push("row remounted");
                  if (row.querySelector('[data-zerops-surface="sidebar-mate-pending"]'))
                    failures.push("placeholder");
                  if (
                    !row
                      .querySelector('[data-zerops-surface="sidebar-mate-subject"]')
                      ?.textContent?.includes(ask)
                  )
                    failures.push("subject lost");
                  if (!row.querySelector(".menu-clock")) failures.push("clock lost");
                  if (row.getBoundingClientRect().height !== initialHeight)
                    failures.push("height changed");
                };
                const observer = new MutationObserver(sample);
                observer.observe(row.parentElement!, {
                  subtree: true,
                  childList: true,
                  attributes: true,
                  characterData: true,
                });
                Object.assign(window, { runningRowWitness: { failures, initialClock, observer } });
                sample();
              },
              ROW,
              ASK,
            ),
          );
          for (const seq of [1, 1, 2, 3]) {
            yield* reportConversation(s.drivers, "Ada", patch, "working", [
              { ...row, revision: { ...row.revision, seq } },
            ]);
            yield* Effect.promise(() =>
              s.page.evaluate(
                () =>
                  new Promise<void>((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
                  ),
              ),
            );
          }
          yield* reportConversation(
            s.drivers,
            "Ada",
            {
              ...patch,
              liveStep: { kind: "writing", since },
            },
            "working",
            [{ ...row, revision: { ...row.revision, seq: 4 } }],
          );
          yield* s.menu.text("Ada", "Writing", "sidebar-mate-live-step");
          yield* Effect.promise(() =>
            s.page.waitForFunction(
              (selector) => {
                const witness = (window as unknown as { runningRowWitness: Witness })
                  .runningRowWitness;
                return (
                  document.querySelector(selector)?.querySelector(".menu-clock")?.textContent !==
                  witness.initialClock
                );
              },
              { timeout: 5_000 },
              ROW,
            ),
          );
          const failures = yield* Effect.promise(() =>
            s.page.evaluate(() => {
              const witness = (window as unknown as { runningRowWitness: Witness })
                .runningRowWitness;
              witness.observer.disconnect();
              return witness.failures;
            }),
          );
          expect(failures).toEqual([]);
          yield* Effect.promise(async () => {
            const element = await s.page.$(ROW);
            await element!.screenshot({ path: "/tmp/sidebar-running-flicker.png" });
          });
          yield* s.then.noReload;
        }),
    );
  });
});
