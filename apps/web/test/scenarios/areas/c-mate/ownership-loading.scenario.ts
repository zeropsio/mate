import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { ProviderDriverKind } from "@t3tools/contracts";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { CLAUDE_SCENARIO_CODE } from "../../../../../server/integration/scriptedClaudeSignIn.ts";
import { createScenario } from "../../harness/scenario.ts";
import { transportGate } from "../../harness/transportGate.ts";
import { mateChat } from "./dsl.ts";

interface OwnershipPaints {
  controls: number;
  history: number;
}

describe("owner-reported layout regressions", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "a colleague's conversation never paints writable controls while HQ ownership arrives after history",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([], { mate: "real" });
          yield* s.given.project("Ada", {
            mate: true,
            provider: { driverKind: ProviderDriverKind.make("claudeAgent") },
            claudeSignIn: true,
          });
          const chat = mateChat(s);
          yield* s.given.signedIn;
          yield* chat.when.openReadOnly();
          yield* Effect.promise(async () => {
            await s.page.locator('button[data-agent-id="claude-code"]').setTimeout(8000).click();
            await s.page.waitForSelector(
              '[data-sign-in-open="claude-code"][href^="https://claude.scenario.invalid/oauth/authorize"]',
              { visible: true, timeout: 8000 },
            );
            await s.page.waitForSelector("[data-sign-in-code]", { visible: true, timeout: 8000 });
            await s.page.type("[data-sign-in-code]", CLAUDE_SCENARIO_CODE);
            await s.page.keyboard.press("Enter");
            await s.page.waitForSelector(
              '[data-slot="composer-shell"] [role="textbox"]:not([inert] *)',
              { visible: true, timeout: 8000 },
            );
            await s.page.waitForFunction(
              () => document.querySelector("[data-sign-in-code]") === null,
              { timeout: 8000, polling: "raf" },
            );
          });
          const mate = s.drivers.realMates.get("Ada")!;
          const answer = "The owner's answer is ready before HQ names its owner.";
          yield* mate.provider.turn([{ kind: "say", text: answer }]);
          yield* chat.when.send("Give me an answer");
          yield* chat.then.text(answer);
          yield* Effect.promise(() =>
            s.page.waitForFunction(() => !location.pathname.startsWith("/draft/"), {
              timeout: 8000,
              polling: "raf",
            }),
          );
          const url = s.page.url();
          s.given.person("dev", { role: "Developer", grants: { Ada: "BASIC_USER" } });
          const colleague = yield* s.given.browserActor({ person: "dev" });
          yield* colleague.given.signedIn;
          yield* Effect.promise(() => colleague.page.setViewport({ width: 1786, height: 1000 }));
          yield* Effect.promise(() => colleague.page.goto(url));
          yield* Effect.promise(() =>
            colleague.page
              .waitForFunction(() => document.body.textContent?.includes("you can read along"), {
                timeout: 8000,
                polling: "raf",
              })
              .catch(async (cause) => {
                throw new Error(
                  `Read-along did not arrive at ${url}: ${await colleague.page.evaluate(() => document.body.innerText)}`,
                  { cause },
                );
              }),
          );
          // Hold the real HQ ticket unchanged, after a cold reload forgets account memory.
          const gate = yield* Effect.acquireRelease(
            Effect.promise(() => transportGate(() => s.drivers.hq.origin, "")),
            (gate) => Effect.promise(gate.close),
          );
          s.drivers.routes["https://hqzone.prg1-zerops.zone"] = gate.origin;
          yield* Effect.promise(() => s.web.setRoutes());
          const held = gate.holdHttp((path) => path.startsWith("/api/stream-ticket"));
          yield* Effect.addFinalizer(() => Effect.sync(held.release));
          yield* Effect.promise(async () => {
            await colleague.page.evaluateOnNewDocument((answer) => {
              const paints = { controls: 0, history: 0 };
              (window as unknown as { ownershipPaints: OwnershipPaints }).ownershipPaints = paints;
              const painted = (selector: string) =>
                [...document.querySelectorAll(selector)].some((node) => {
                  const box = node.getBoundingClientRect();
                  return box.width > 0 && box.height > 0 && !node.closest("[inert]");
                });
              const frame = () => {
                if (
                  painted(
                    '[data-slot="composer-shell"] [role="textbox"], [data-chat-provider-model-picker], button[aria-label="Send message"]',
                  )
                )
                  paints.controls++;
                if (document.body?.textContent?.includes(answer)) paints.history++;
                requestAnimationFrame(frame);
              };
              requestAnimationFrame(frame);
            }, answer);
            await colleague.page.reload({ waitUntil: "domcontentloaded" });
            await held.held;
            await colleague.page.waitForFunction(
              (answer) =>
                document.body.textContent?.includes(answer) &&
                document.querySelector('[data-slot="composer-shell"]'),
              { timeout: 10_000, polling: "raf" },
              answer,
            );
            await colleague.page.evaluate(
              () =>
                new Promise<void>((resolve) => {
                  let frames = 0;
                  const frame = () => (++frames === 60 ? resolve() : requestAnimationFrame(frame));
                  requestAnimationFrame(frame);
                }),
            );
            held.release();
            await colleague.page.waitForFunction(
              () => document.body.textContent?.includes("you can read along"),
              { timeout: 10_000, polling: "raf" },
            );
            const paints = await colleague.page.evaluate(
              () => (window as unknown as { ownershipPaints: OwnershipPaints }).ownershipPaints,
            );
            expect(
              paints.history,
              "ASSERTION: history paints while HQ ownership waits",
            ).toBeGreaterThanOrEqual(60);
            expect(
              paints.controls,
              "ASSERTION: zero painted frames offer a colleague's editor, model or send controls",
            ).toBe(0);
          });
          yield* s.then.noExternalNetwork;
        }),
    );
  });
});
