import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installArea } from "./fake.ts";
import { mateChat } from "./dsl.ts";

type Frame = {
  fold: string | null;
  height: number;
  top: number;
  end: number;
  follows: boolean;
  innerEnd: number | null;
  overlap: boolean;
};
type Trace = { active: boolean; frames: Frame[]; sample: () => void };

// Real list, RunChat and foldWork; include intermediate frames starting before settlement.
describe("Decision: one owner per concern as the report's table assigns; no new state model.", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    for (const mode of [
      "following",
      "wheel",
      "keyboard",
      "focus/find",
      "opened command",
    ] as const) {
      it.effect(`settlement preserves the assembled outer and inner reader (${mode})`, () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
          yield* s.given.project("Ada", { mate: true });
          const chat = mateChat(s);
          const wire = chat.fixture();
          wire.history("Watch this work settle");
          const historyLength = mode === "following" ? 200 : 10;
          for (let i = 0; i < historyLength; i++)
            wire.exchange(`Earlier ask ${i}`, "Earlier conversation stays readable.\n\n".repeat(8));
          wire.message("fold-ask", "user", "Fold this run", "fold-run");
          wire.run("fold-run", "running");
          wire.message(
            "fold-thought",
            "assistant",
            Array.from({ length: 24 }, (_, i) => `Inspecting line ${i}.`).join("\n\n"),
            "fold-run",
          );
          const command = {
            toolName: "Bash",
            command: "printf build-log",
            input: { command: "printf build-log", description: "Read the build log" },
            rawOutput: {
              content: Array.from({ length: 40 }, (_, i) => `Build log line ${i}`).join("\n"),
            },
          };
          wire.tool("read-command", "tool.completed", command, "fold-run");
          const landing = {
            toolName: "Bash",
            command: "echo landing",
            input: { command: "echo landing", description: "Check the build" },
          };
          wire.tool("landing-command", "tool.started", landing, "fold-run");
          const helper = (i: number) => ({
            taskId: `fold-helper-${i}`,
            agentKind: "agent",
            title: `Helper ${i}`,
            role: "explorer",
          });
          for (let i = 0; i < 6; i++)
            wire.activity("task.started", `Helper ${i}`, helper(i), "fold-run");
          yield* s.given.signedIn;
          yield* chat.when.open("Ada", "Fold this run");
          yield* Effect.promise(() =>
            s.page.waitForFunction(
              () => {
                const outer = document.querySelector<HTMLElement>(".timeline-legend-list");
                const inner = document.querySelector<HTMLElement>(
                  "[data-run-chat][data-run-live] [data-run-scroll]",
                );
                return (
                  outer &&
                  inner &&
                  inner.scrollHeight > inner.clientHeight &&
                  Math.abs(outer.scrollHeight - outer.clientHeight - outer.scrollTop) <= 2
                );
              },
              { polling: "raf", timeout: 8000 },
            ),
          );
          if (mode === "following")
            expect(
              yield* Effect.promise(() =>
                s.page.$$eval(".timeline-legend-list [data-timeline-root]", (rows) => rows.length),
              ),
              "ASSERTION: long conversation folding runs with history rows unmounted",
            ).toBeLessThan(historyLength);
          if (mode === "opened command") {
            yield* Effect.promise(async () => {
              await s.page
                .locator(
                  "[data-run-chat][data-run-live] [data-run-scroll] button ::-p-text(Read the build log)",
                )
                .setTimeout(8000)
                .click();
              const inner = await s.page.$("[data-run-chat][data-run-live] [data-run-scroll]");
              const box = (await inner!.boundingBox())!;
              await s.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
              await s.page.mouse.wheel({ deltaY: -120 });
              await s.page.waitForFunction(() => {
                const inner = document.querySelector<HTMLElement>(
                  "[data-run-chat][data-run-live] [data-run-scroll]",
                )!;
                return inner.scrollHeight - inner.clientHeight - inner.scrollTop > 40;
              });
            });
          } else if (mode !== "following") {
            yield* Effect.promise(async () => {
              const outer = await s.page.$(".timeline-legend-list");
              const box = (await outer!.boundingBox())!;
              if (mode === "wheel") {
                await s.page.mouse.move(box.x + box.width - 8, box.y + box.height / 2);
                await s.page.mouse.wheel({ deltaY: -300 });
              } else if (mode === "keyboard") {
                await outer!.evaluate((node) => {
                  node.setAttribute("tabindex", "0");
                  (node as HTMLElement).focus();
                });
                await s.page.keyboard.press("PageUp");
              } else
                await outer!.evaluate((node) => {
                  node.scrollTop -= 300;
                });
              await s.page.waitForFunction(
                () => !document.querySelector("[data-timeline-follows-end]"),
              );
            });
          }
          yield* Effect.promise(() =>
            s.page.evaluate(() => {
              const sample = () => {
                const outer = document.querySelector<HTMLElement>(".timeline-legend-list");
                const card = [...document.querySelectorAll<HTMLElement>("[data-run-chat]")].at(-1);
                const inner = card?.querySelector<HTMLElement>("[data-run-scroll]");
                const above = card?.querySelector<HTMLElement>(".run-above");
                const box = card
                  ?.querySelector<HTMLElement>(":scope > .run-now .run-now-words")
                  ?.getBoundingClientRect();
                // Mounted containers are pooled; DOM sibling order is not timeline order.
                const next = outer
                  ?.querySelector('[data-timeline-row-kind="outcome"] .run-band')
                  ?.getBoundingClientRect();
                if (outer && card)
                  trace.frames.push({
                    fold: card.dataset.runFold ?? null,
                    height: above?.getBoundingClientRect().height ?? 0,
                    top: outer.scrollTop,
                    end: outer.scrollHeight - outer.clientHeight - outer.scrollTop,
                    follows: !!document.querySelector("[data-timeline-follows-end]"),
                    innerEnd: inner
                      ? inner.scrollHeight - inner.clientHeight - inner.scrollTop
                      : null,
                    overlap: !!(box && next && next.height > 0 && next.top < box.bottom - 2),
                  });
                if (trace.active) requestAnimationFrame(sample);
              };
              const trace: Trace = { active: true, frames: [], sample };
              (window as unknown as { foldTrace: Trace }).foldTrace = trace;
              sample();
            }),
          );
          // Slot landing and panel/report shrink share this settlement; native clamps are sampled.
          wire.tool(
            "landing-command",
            "tool.completed",
            { ...landing, output: "landing" },
            "fold-run",
          );
          wire.tool(
            "checked-page",
            "tool.completed",
            {
              toolName: "mcp__zerops__zerops_browser",
              input: { commands: [["open", "https://store.example/orders"]] },
              zerops: {
                toolName: "zerops_browser",
                resultText: '{"url":"https://store.example/orders","steps":[]}',
              },
            },
            "fold-run",
            { itemType: "mcp_tool_call" },
          );
          for (let i = 0; i < 6; i++)
            wire.activity(
              "task.completed",
              `Helper ${i} finished`,
              { ...helper(i), status: "completed" },
              "fold-run",
            );
          wire.message("fold-answer", "assistant", "The fold is complete", "fold-run");
          wire.run("fold-run", "completed", null, "fold-answer");
          yield* chat.then.text("The fold is complete");
          yield* Effect.promise(() =>
            s.page.waitForFunction(
              (mode) => {
                const card = [...document.querySelectorAll<HTMLElement>("[data-run-chat]")].at(-1);
                const report = document.querySelector<HTMLElement>(
                  '[data-timeline-row-kind="outcome"] .run-band',
                );
                const holder = card?.closest("[data-timeline-root]")?.parentElement;
                const placed =
                  holder?.parentElement &&
                  [...holder.parentElement.children].every(
                    (row) => !(row instanceof HTMLElement) || row.style.translate === "",
                  );
                const outer = document.querySelector<HTMLElement>(".timeline-legend-list");
                const atEnd =
                  outer && Math.abs(outer.scrollHeight - outer.clientHeight - outer.scrollTop) <= 2;
                return (
                  placed &&
                  (mode !== "following" || atEnd) &&
                  card?.dataset.runFold === (mode === "opened command" ? "watched" : "folded") &&
                  report &&
                  report.parentElement!.style.height === ""
                );
              },
              { polling: "raf", timeout: 8000 },
              mode,
            ),
          );
          const frames = yield* Effect.promise(() =>
            s.page.evaluate(() => {
              const trace = (window as unknown as { foldTrace: Trace }).foldTrace;
              trace.active = false;
              trace.sample();
              return trace.frames;
            }),
          );
          expect(
            frames.length,
            "ASSERTION: settlement was sampled before and during the handoff",
          ).toBeGreaterThan(2);
          const startHeight = frames.find((frame) => frame.fold === "folding")?.height ?? 0;
          const shrinking = frames.filter(
            (frame) => frame.fold === "folding" && frame.height < startHeight - 1,
          );
          expect(
            shrinking.some((frame) => frame.overlap),
            "ASSERTION: measured folding keeps following content below the status line",
          ).toBe(false);
          expect(
            frames.at(-1)!.overlap,
            "ASSERTION: the assembled handoff leaves the status and report in separate rooms",
          ).toBe(false);
          if (mode === "opened command") {
            expect(
              frames.some((f) => f.fold === "folding"),
              "ASSERTION: an opened command keeps its inner reader and whole run open",
            ).toBe(false);
            expect(frames.at(-1)!.innerEnd).toBeGreaterThan(40);
            expect(
              frames.some((frame) => frame.follows),
              "ASSERTION: settlement does not resume the outer reader held by an opened command",
            ).toBe(false);
            yield* Effect.promise(async () => {
              const inner = await s.page.$(
                "[data-run-chat][data-run-fold=watched] [data-run-scroll]",
              );
              await inner!.evaluate((node) => {
                node.scrollTop = 0;
              });
              const outerTop = await s.page.$eval(
                ".timeline-legend-list",
                (node) => node.scrollTop,
              );
              const box = (await inner!.boundingBox())!;
              await s.page.mouse.move(box.x + box.width / 2, box.y + 12);
              await s.page.mouse.wheel({ deltaY: -160 });
              await s.page.waitForFunction(
                (top) =>
                  document.querySelector<HTMLElement>(".timeline-legend-list")!.scrollTop <
                  top - 20,
                { polling: "raf", timeout: 8000 },
                outerTop,
              );
              expect(
                await inner!.evaluate((node) => node.scrollTop),
                "ASSERTION: a wheel at the inner head hands movement to the outer list",
              ).toBe(0);
            });
          } else {
            expect(
              frames.some((f) => f.fold === "folding" && f.height > 0),
              "ASSERTION: the real measured work fold ran",
            ).toBe(true);
            expect(
              frames.every((f) => f.follows === (mode === "following")),
              "ASSERTION: folding never invents outer follow permission",
            ).toBe(true);
            if (mode === "following")
              expect(
                frames.at(-1)!.end,
                "ASSERTION: the followed list reaches its measured end after the clamp and fold",
              ).toBeLessThanOrEqual(2);
          }
          yield* s.then.noExternalNetwork;
        }),
      );
    }
  });
});
