import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { VcsStatusResult, WS_METHODS } from "@t3tools/contracts";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installArea, reportContainer, projectGrant, deleteProjectEvidence } from "./fake.ts";
import { mateChat } from "./dsl.ts";

const setup = (freezeClock = true) =>
  Effect.gen(function* () {
    const s = yield* createScenario([installArea]);
    yield* s.given.project("Wren", { mate: true });
    const chat = mateChat(s);
    const wire = chat.fixture("Wren");
    wire.history();
    if (freezeClock) yield* Effect.promise(() => s.clock.install());
    yield* s.given.signedIn;
    yield* chat.when.open("Wren");
    return { s, chat, wire };
  });

describe("C: source failures keep the conversation", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // A proved restart failure must name both the Mate and startup cause, not an intentional stop.
    it.effect("a failed restart has its cause and a direct restart action", () =>
      Effect.gen(function* () {
        const { s, chat, wire } = yield* setup();
        reportContainer(s.drivers, "Wren", "ACTION_FAILED", true);
        wire.disconnect();
        yield* chat.then.text("Wren couldn't restart.");
        yield* chat.then.text("Its startup command failed.");
        yield* chat.then.control("Try again");
        yield* chat.then.text("Open in Zerops");
        yield* chat.then.noText("I'm stopped.");
        yield* chat.then.once("The existing conversation is still here");
        yield* s.then.noExternalNetwork;
      }),
    );
    // An intentional stop must offer the platform start operation directly beside the conversation.
    it.effect("a stopped container offers Start beside retained history", () =>
      Effect.gen(function* () {
        const { s, chat, wire } = yield* setup();
        reportContainer(s.drivers, "Wren", "STOPPED");
        wire.disconnect();
        yield* chat.then.text("Wren's container is stopped.");
        yield* chat.then.text("Start Wren to reconnect.");
        yield* chat.then.control("Start");
        yield* chat.when.press("Start");
        yield* Effect.promise(() =>
          s.drivers.zerops.waitForRequest("PUT /service-stack/service-Wren/start"),
        );
        yield* chat.then.once("The existing conversation is still here");
        yield* s.then.noExternalNetwork;
      }),
    );
    it.effect("recovery keeps its owner result in the shell after opening another Mate", () =>
      Effect.gen(function* () {
        const { s, chat, wire } = yield* setup();
        yield* s.given.project("Sage", { mate: true });
        chat.fixture("Sage").history();
        // Foregrounding refreshes the open checkout as well as the recovery presentation clock.
        for (const mate of s.drivers.mates.values()) {
          mate.rpcHandlers.push((request, socket) => {
            if (request.tag !== WS_METHODS.vcsRefreshStatus) return false;
            mate.reply(
              socket,
              request.id,
              Schema.encodeSync(VcsStatusResult)({
                isRepo: false,
                hasPrimaryRemote: false,
                isDefaultRef: true,
                refName: null,
                hasWorkingTreeChanges: false,
                workingTree: { files: [], insertions: 0, deletions: 0 },
                hasUpstream: false,
                aheadCount: 0,
                behindCount: 0,
                pr: null,
              }),
            );
            return true;
          });
        }
        s.drivers.zerops.writes.autoComplete = false;
        let processId: string | undefined;
        s.drivers.zerops.handlers.unshift(async (request) => {
          if (
            request.method !== "PUT" ||
            !request.url.pathname.endsWith("/service-stack/service-Wren/start")
          )
            return undefined;
          processId = s.drivers.zerops.writes.start("Wren", "stack.start", ["service-Wren"]);
          return { body: { id: processId } };
        });
        reportContainer(s.drivers, "Wren", "STOPPED");
        wire.disconnect();
        yield* chat.then.control("Start");
        yield* chat.when.press("Start");
        yield* chat.then.text("Zerops accepted the start. Its outcome is not confirmed yet.");
        yield* chat.when.open("Sage");
        // The shell shows the result as a toast floating over the page.
        const shell = '[data-slot="toast-viewport"]';
        yield* Effect.promise(() =>
          s.page.waitForFunction(
            (selector) =>
              document
                .querySelector(selector)
                ?.textContent?.includes("Wren: Zerops accepted the start."),
            {},
            shell,
          ),
        );
        expect(processId).toBeDefined();
        s.drivers.zerops.writes.transition(
          processId!,
          "FAILED",
          "The start was refused by the container.",
        );
        yield* Effect.promise(() =>
          s.page.waitForFunction(
            (selector) => document.querySelector(selector)?.textContent?.includes("Start failed."),
            {},
            shell,
          ),
        );
        yield* chat.then.text("The start ended FAILED.");
        const bounds = yield* Effect.promise(() =>
          s.page.evaluate((selector) => {
            const status = document.querySelector(selector)!.getBoundingClientRect();
            return {
              bottom: status.bottom,
              right: status.right,
              width: innerWidth,
              height: innerHeight,
            };
          }, shell),
        );
        const readable = yield* Effect.promise(() =>
          s.page.evaluate((selector) => {
            const item = document
              .querySelector(selector)!
              .querySelector<HTMLElement>("[data-recovery-request]")!;
            const rect = item.getBoundingClientRect();
            const top = document.elementFromPoint(rect.left + 2, rect.top + 2);
            return {
              visible: top?.closest("[data-recovery-request]") === item,
              hit: top?.outerHTML.slice(0, 400),
            };
          }, shell),
        );
        expect(readable.visible, readable.hit).toBe(true);
        expect(bounds.bottom).toBeLessThanOrEqual(bounds.height + 2);
        expect(bounds.right).toBeLessThanOrEqual(bounds.width + 2);
        const output = process.env.MATE_RECOVERY_EVIDENCE;
        if (output) yield* Effect.promise(() => s.page.screenshot({ path: `${output}-shell.png` }));
        yield* Effect.promise(() => s.page.setViewport({ width: 435, height: 900 }));
        yield* Effect.promise(() =>
          s.page.waitForFunction(
            (selector) => {
              const status = document.querySelector(selector)!;
              const rect = status.getBoundingClientRect();
              return (
                rect.width > 0 && rect.right <= innerWidth + 2 && rect.bottom <= innerHeight + 2
              );
            },
            {},
            shell,
          ),
        );
        if (output)
          yield* Effect.promise(() => s.page.screenshot({ path: `${output}-narrow.png` }));
        yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
        yield* chat.when.open("Wren");
        yield* chat.when.press("Try again");
        yield* chat.then.text("Zerops accepted the start. Its outcome is not confirmed yet.");
        s.drivers.zerops.writes.transition(processId!, "FINISHED");
        yield* chat.then.text("Start completed.");
        yield* Effect.promise(() => s.clock.advanceStepped(2_000));
        yield* Effect.promise(() =>
          s.page.evaluate(() =>
            document
              .querySelector<HTMLButtonElement>(
                '[data-recovery-request] button[aria-label^="Dismiss"]',
              )!
              .focus(),
          ),
        );
        yield* Effect.promise(() => s.clock.advanceStepped(10_000));
        yield* chat.then.text("Start completed.");
        yield* Effect.promise(() =>
          s.page.evaluate(() => {
            Object.defineProperty(document, "visibilityState", {
              configurable: true,
              value: "hidden",
            });
            document.dispatchEvent(new Event("visibilitychange"));
            (document.activeElement as HTMLElement).blur();
          }),
        );
        yield* Effect.promise(() => s.clock.advanceStepped(10_000));
        yield* chat.then.text("Start completed.");
        yield* Effect.promise(() =>
          s.page.evaluate(() => {
            Object.defineProperty(document, "visibilityState", {
              configurable: true,
              value: "visible",
            });
            document.dispatchEvent(new Event("visibilitychange"));
          }),
        );
        yield* Effect.promise(() => s.clock.advanceStepped(2_999));
        yield* chat.then.text("Start completed.");
        yield* Effect.promise(() => s.clock.advanceStepped(1));
        yield* chat.then.noText("Start completed.");
        yield* s.then.noExternalNetwork;
      }),
    );
    // A 403 and projectNotFound are different owner facts; restoration must release the retained gate.
    it.effect(
      "revoked project access is named and an authoritative regrant reopens its route",
      () =>
        Effect.gen(function* () {
          const { s, chat } = yield* setup();
          projectGrant(s.drivers, "Wren", false);
          yield* chat.then.text("You no longer have access to Wren's project");
          yield* chat.then.noText("The existing conversation is still here");
          yield* chat.then.noText("was deleted");
          projectGrant(s.drivers, "Wren", true);
          yield* Effect.promise(() => s.clock.advanceStepped(30_000));
          yield* chat.then.once("The existing conversation is still here");
          yield* chat.then.noText("You no longer have access");
          yield* s.then.noExternalNetwork;
        }),
    );
    // Confirmed deletion must remove the dead platform link on both chat and project routes.
    it.effect("project deletion is named and leaves no dead Open in Zerops link", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup();
        deleteProjectEvidence(s.drivers, "Wren");
        yield* chat.then.text("Wren's project was deleted");
        yield* chat.then.noText("The existing conversation is still here");
        yield* chat.then.noText("Open in Zerops");
        yield* Effect.promise(() => s.page.goto(`${s.page.url().split("/env-")[0]}/mate/Wren`));
        // A cold URL holds only its id; it must not invent a name from that id.
        yield* chat.then.text("The Mate's project was deleted");
        yield* chat.then.noText("Open in Zerops");
        yield* s.then.noExternalNetwork;
      }),
    );
    // A lost socket cannot decide that an active turn completed, failed or vanished.
    it.effect(
      "an active run interrupted during transport loss returns with history and draft",
      () =>
        Effect.gen(function* () {
          const { s, chat, wire } = yield* setup(false);
          wire.run("active-run", "running");
          yield* chat.then.control("Stop generation", "button");
          yield* chat.when.type("Keep this draft through the interruption");
          wire.disconnect();
          wire.run("active-run", "interrupted");
          yield* chat.then.once("The existing conversation is still here");
          yield* chat.then.draft("Keep this draft through the interruption");
          yield* chat.then.control("Stop generation", "button", false);
          expect(wire.sentTurnCount()).toBe(0);
          yield* s.then.noExternalNetwork;
        }),
    );
    // Elapsed time alone must never end a provider's reported running turn.
    it.effect("a long run stays working until the provider reports its result", () =>
      Effect.gen(function* () {
        const { s, chat, wire } = yield* setup();
        wire.run("long-run", "running");
        yield* chat.then.control("Stop generation", "button");
        yield* Effect.promise(() => s.clock.advance(4 * 60 * 60 * 1000, true));
        yield* chat.then.control("Stop generation", "button");
        yield* chat.then.once("The existing conversation is still here");
        yield* chat.then.noText("couldn't restart");
        wire.message("long-result", "assistant", "The long inspection finished", "long-run");
        wire.run("long-run", "completed", null, "long-result");
        yield* chat.then.once("The long inspection finished");
        yield* chat.then.control("Stop generation", "button", false);
        yield* s.then.noExternalNetwork;
      }),
    );
    // Expiry of a recorded provider login must offer sign-in without hiding history.
    it.effect("an expired Codex login blocks sending and preserves the conversation", () =>
      Effect.gen(function* () {
        const { s, chat, wire } = yield* setup();
        wire.expireLogin();
        yield* chat.then.once("The existing conversation is still here");
        yield* chat.then.text("Sign in");
        yield* chat.then.text("Codex");
        yield* chat.when.type("Keep my unsent request");
        yield* chat.when.key("Enter");
        yield* chat.then.draft("Keep my unsent request");
        expect(wire.sentTurnCount()).toBe(0);
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
