// @effect-diagnostics nodeBuiltinImport:off -- controls bytes uploaded to the disposable scenario Mate.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { menuMateRow, sendConversationMessage } from "../../harness/browser.ts";
import { describe, expect, it } from "@effect/vitest";
import {
  ConversationId,
  MATE_ENGINE_PROTOCOLS,
  type EngineConversationFrame,
  type Request,
  type RunRecord,
  AssetCreateUrlInput,
  AssetCreateUrlResult,
  WS_METHODS,
  ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { FetchHttpClient, HttpClient } from "effect/http";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario, type ScenarioOptions } from "../../harness/scenario.ts";

import { waitForStillFrames } from "../../harness/stillFrames.ts";
import { ownerViewport } from "./ownerViewport.ts";
import { mateChat } from "./dsl.ts";
import { installArea } from "./fake.ts";

type Scenario = Effect.Success<ReturnType<typeof createScenario>>;
const history = "The existing conversation is still here";
const routes = new WeakMap<Scenario, Map<string, string>>();
const seededDoors = new WeakMap<Scenario, Map<string, number>>();
const openedDoors = (s: Scenario, name: string) => {
  const gate = s.drivers.realMates.get(name)!.gate;
  return s.drivers.core.kind === "external"
    ? gate.openedConnections
    : gate.requests.filter((request) => request.startsWith("POST /mate/api/auth/zerops-throwaway "))
        .length;
};

// Seed through another isolated browser, so the case's browser still crosses a cold door.
const seed = (s: Scenario, name = "Ada", exchanges = [["Earlier question", history]]) =>
  Effect.gen(function* () {
    const context = yield* Effect.promise(() => s.web.newContext());
    const page = yield* Effect.promise(() => s.web.newPage(context));
    const mate = s.drivers.realMates.get(name)!;
    yield* Effect.promise(async () => {
      s.web.setPerson(page, "personal");
      await s.web.gotoWithSession(page, "personal");
      await (await menuMateRow(page, name)).click();
      await page.waitForSelector('[role="textbox"]', { visible: true });
    });
    for (const [question, answer] of exchanges) {
      yield* mate.provider.turn([{ kind: "say", text: answer! }]);
      yield* Effect.promise(() => sendConversationMessage(page, question!, true));
      expect((yield* mate.provider.received).input.input).toBe(question);
      yield* Effect.promise(() =>
        page.waitForFunction(
          (answer) =>
            document.body.innerText.includes(answer) &&
            !location.pathname.startsWith("/draft/") &&
            !document.querySelector('button[aria-label="Stop generation"]'),
          { polling: 100 },
          answer!,
        ),
      );
    }
    const map = routes.get(s) ?? new Map<string, string>();
    map.set(name, new URL(page.url()).pathname);
    routes.set(s, map);
    const doors = seededDoors.get(s) ?? new Map<string, number>();
    doors.set(name, openedDoors(s, name));
    seededDoors.set(s, doors);
    yield* Effect.promise(() => context.close());
  });
const route = (s: Scenario, name = "Ada") => routes.get(s)!.get(name)!;
const doorCount = (s: Scenario, name = "Ada") =>
  openedDoors(s, name) - (seededDoors.get(s)?.get(name) ?? 0);
const archived = (s: Scenario, name = "Ada") =>
  s.drivers.realMates
    .get(name)!
    .server.engine.conversation(ConversationId.make(route(s, name).split("/").at(-1)!))
    .pipe(Effect.map((view) => view!.archived));
const realChat = (s: Scenario) => {
  const ui = mateChat(s);
  const ready = (name = "Ada") =>
    Effect.gen(function* () {
      yield* ui.then.path(route(s, name));
      yield* Effect.promise(() => s.page.waitForSelector('[role="textbox"]', { visible: true }));
    });
  const open = (name = "Ada", text = history) =>
    Effect.gen(function* () {
      yield* s.when.menu.opensMate(name);
      yield* ready(name);
      yield* ui.then.text(text);
    });
  return {
    ...ui,
    when: {
      ...ui.when,
      open,
      returnTo: open,
      reload: (name = "Ada", text = history) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => s.page.reload());
          yield* ready(name);
          yield* ui.then.text(text);
        }),
      send: (message: string) =>
        Effect.gen(function* () {
          const mate = s.drivers.realMates.get("Ada")!;
          yield* mate.provider.turn([]);
          yield* ui.when.send(message);
          expect((yield* mate.provider.received).input.input).toBe(message);
        }),
    },
    // The scenario DSL exposes Effect assertions, never a Promise callback.
    // oxlint-disable-next-line unicorn/no-thenable
    then: { ...ui.then, ready },
  };
};
const openArea = (options: ScenarioOptions) =>
  Effect.gen(function* () {
    const s = yield* createScenario([], { ...options, mate: "real" });
    yield* s.given.project("Ada", { mate: true });
    yield* seed(s);
    return { s, chat: realChat(s) };
  });
const setup = openArea({});

describe("C: opening a Mate and chat", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // Decision: keep fresh-send working; restore the guard's intent; Aleš's archive source is the one source.
    it.effect(
      "a Mate's non-crewmate engine conversation never becomes a generic sidebar thread",
      () =>
        Effect.gen(function* () {
          const { s, chat } = yield* setup;
          yield* s.given.signedIn;
          yield* chat.when.open();
          yield* chat.then.text("The existing conversation is still here");
          yield* Effect.promise(async () => {
            await s.page.setViewport({ width: 1786, height: 1000 });
            expect(
              await s.page.$$("[data-thread-item]"),
              "ASSERTION: a Mate-owned conversation has no generic sidebar duplicate",
            ).toHaveLength(0);
            expect(
              await s.page.$$('[data-zerops-mate-row="Ada"]'),
              "ASSERTION: the Mate has exactly one row in SidebarZeropsTree",
            ).toHaveLength(1);
          });
          yield* s.then.noExternalNetwork;
        }),
    );

    it.effect(
      "archive and start fresh opens a new conversation and Undo restores the old one",
      () =>
        Effect.gen(function* () {
          const { s, chat } = yield* setup;
          yield* s.given.signedIn;
          yield* chat.when.open();
          yield* Effect.promise(async () => {
            await s.page.locator("::-p-aria(More header actions)").click();
            await s.page.locator("[data-zerops-start-fresh]").click();
            await s.page.waitForFunction(() => location.pathname.startsWith("/draft/"));
            expect(
              new URL(s.page.url()).pathname,
              "ASSERTION: archive opens a fresh conversation",
            ).toMatch(/^\/draft\/[^/]+$/);
          });
          expect(
            yield* archived(s),
            "ASSERTION: the owning engine records the archive before starting fresh",
          ).toBe(true);
          yield* Effect.promise(() => s.page.locator("::-p-aria(Undo)").click());
          yield* chat.then.path(route(s));
          yield* chat.then.text("The existing conversation is still here");
          expect(
            yield* archived(s),
            "ASSERTION: Undo restores the conversation in its owning engine",
          ).toBe(false);
          yield* s.then.noExternalNetwork;
        }),
    );

    it.effect("an archived conversation opens read-only from the archive list", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        yield* s.given.signedIn;
        yield* chat.when.open();
        const title = yield* Effect.promise(() =>
          s.page.$eval("[data-conversation-subject]", (node) => node.textContent!.trim()),
        );
        yield* Effect.promise(() => s.page.locator("::-p-aria(More header actions)").click());
        yield* Effect.promise(() => s.page.locator("[data-zerops-start-fresh]").click());
        yield* Effect.promise(() =>
          s.page.waitForFunction(() => location.pathname.startsWith("/draft/")),
        );
        const read = s.drivers.realMates
          .get("Ada")!
          .gate.hold((tag) => tag === WS_METHODS.engineGetArchivedShellSnapshot);
        yield* Effect.addFinalizer(() => Effect.sync(read.release));
        yield* s.given.signedIn;
        yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
        yield* chat.when.visit(route(s));
        yield* chat.then.text("This conversation is archived");
        yield* Effect.promise(() =>
          s.page
            .locator(() => {
              const control = [
                ...document.querySelectorAll('[data-zerops-surface="sidebar-account"]'),
              ].find((element) => {
                const box = element.getBoundingClientRect();
                return (
                  document
                    .elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
                    ?.closest('[data-zerops-surface="sidebar-account"]') === element
                );
              });
              if (control === undefined)
                throw new Error("The account control is not clickable yet");
              return control;
            })
            .click(),
        );
        yield* chat.when.press("Settings", "menuitem");
        yield* chat.then.path("/settings/general");
        yield* chat.when.press("Archive");
        yield* chat.then.text("Loading archived threads");
        yield* Effect.promise(() => read.held);
        read.release();
        yield* chat.then.text(title);
        const row = yield* Effect.promise(() =>
          s.page.evaluate((title) => {
            const link = [...document.querySelectorAll('[data-slot="row-title"] a')].find(
              (link) => link.textContent === title,
            );
            return {
              href: link?.getAttribute("href") ?? null,
              unarchive: link?.closest('[data-slot="row"]')?.textContent?.includes("Unarchive"),
            };
          }, title),
        );
        expect(row.href, "ASSERTION: the archive record opens its scoped conversation route").toBe(
          route(s),
        );
        expect(row.unarchive, "ASSERTION: the archive row keeps Unarchive").toBe(true);
        yield* Effect.promise(() => s.page.locator(`a ::-p-text(${title})`).click());
        yield* chat.then.path(route(s));
        yield* chat.then.text("The existing conversation is still here");
        yield* chat.then.text("This conversation is archived");
        const editable = yield* Effect.promise(() =>
          s.page.evaluate(
            () =>
              [...document.querySelectorAll('[role="textbox"], textarea')].filter(
                (element) =>
                  element.getBoundingClientRect().height > 0 &&
                  !element.closest('[inert], [aria-hidden="true"]') &&
                  !element.matches(':disabled, [aria-disabled="true"]'),
              ).length,
          ),
        );
        expect(editable, "ASSERTION: the archived view has no editable composer").toBe(0);
        expect(
          yield* archived(s),
          "ASSERTION: opening the archive record leaves the conversation archived",
        ).toBe(true);
        yield* chat.when.press("Restore");
        yield* chat.then.noText("This conversation is archived");
        expect(
          yield* archived(s),
          "ASSERTION: Restore restores the archive record's conversation",
        ).toBe(false);
        yield* s.then.noExternalNetwork;
      }),
    );

    // A reported version difference alone must never offer a chat-level restart.
    it.effect("older and newer Mate versions show no version-skew warning or restart action", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([], { mate: "real" });
        const chat = realChat(s);
        for (const [name, version] of [
          ["Ada", "0.16.0"],
          ["Bea", "999.0.0"],
        ] as const) {
          yield* s.given.project(name, {
            mate: true,
            launchEnvironment: { T3CODE_SERVER_VERSION: version },
          });
          yield* seed(s, name);
          const descriptor = yield* HttpClient.get(
            `${s.drivers.realMates.get(name)!.server.origin}/.well-known/t3/environment`,
          ).pipe(
            Effect.flatMap((response) => response.json),
            Effect.provide(FetchHttpClient.layer),
          );
          expect(descriptor).toMatchObject({ serverVersion: version });
        }
        yield* s.given.signedIn;
        for (const name of ["Ada", "Bea"]) {
          yield* chat.when.open(name);
          const shown = yield* Effect.promise(() =>
            s.page.evaluate(() => ({
              words: document.body.textContent,
              actions: [...document.querySelectorAll("button")]
                .filter((button) => button.getBoundingClientRect().height > 0)
                .map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim()),
            })),
          );
          expect(shown.words).not.toContain("Server versions differ");
          expect(shown.actions).not.toContain("Restart Mate");
          expect(shown.actions).not.toContain("Restart server");
        }
        yield* s.then.noExternalNetwork;
      }),
    );

    describe("Decision: catch real breakage only (overlap, overflow, wrong variant/colour role, missing element) — never pixel-exact or 1px nudges; no new expensive visual suites.", () => {
      // Catches a broken identity door/OAuth exchange or a slow first opening that never reaches the chosen chat.
      it.effect("first open crosses the door and OAuth", () =>
        Effect.gen(function* () {
          const { s, chat } = yield* openArea({ signIn: "ui" });
          yield* s.given.signedIn;
          expect(
            s.drivers.zerops.requests.get("GET /authorize-app"),
            "ASSERTION: first sign-in completes the Zerops OAuth redirect",
          ).toBe(1);
          expect(doorCount(s)).toBe(0);
          yield* chat.when.open();
          expect(doorCount(s), "ASSERTION: first open crosses the named Mate's door once").toBe(1);
          yield* chat.then.path(route(s));
          yield* Effect.promise(async () => {
            await s.page.evaluate(() => document.fonts.ready);
            await s.page.setViewport({ width: 900, height: 300 });
            // Observe before opening, including the first paint; a settled check misses cap snaps.
            await s.page.evaluate(() => {
              const bounds: number[] = [];
              let active = true;
              const sample = () => {
                const popup = document.querySelector('[data-slot="popover-popup"]');
                if (popup) {
                  const box = popup.getBoundingClientRect();
                  if (
                    box.width > 0 &&
                    box.height > 0 &&
                    getComputedStyle(popup).visibility === "visible" &&
                    Number(getComputedStyle(popup).opacity) > 0
                  )
                    bounds.push(
                      Math.max(
                        -box.left,
                        -box.top,
                        box.right - innerWidth,
                        box.bottom - innerHeight,
                      ),
                    );
                }
                if (active) requestAnimationFrame(sample);
              };
              Reflect.set(window, "popoverBounds", bounds);
              Reflect.set(window, "stopPopoverBounds", () => {
                active = false;
              });
              requestAnimationFrame(sample);
            });
            await s.page.locator("[data-chat-provider-model-picker]").click();
            await s.page.waitForSelector('[data-slot="popover-popup"]');
            await s.page.waitForFunction(() => {
              const popup = document.querySelector('[data-slot="popover-popup"]');
              return (
                popup &&
                !popup.hasAttribute("data-starting-style") &&
                getComputedStyle(popup).opacity === "1"
              );
            });
            const bounds = await s.page.evaluate(async () => {
              await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
              Reflect.get(window, "stopPopoverBounds")();
              return Reflect.get(window, "popoverBounds") as number[];
            });
            expect(
              bounds.length,
              "ASSERTION: opening popover supplies first and settled frame evidence",
            ).toBeGreaterThan(1);
            expect(
              Math.max(...bounds),
              "ASSERTION: model popover stays bounded on first and settled frames",
            ).toBeLessThanOrEqual(4);
            await s.page.keyboard.press("Escape");
            await s.page.setViewport({ width: 1280, height: 800 });
          });
          yield* s.then.noExternalNetwork;
        }),
      );
    });

    // Catches returning to a parked Mate losing its history, opening another chat, or repeating the cold door.
    it.effect("returning to a parked Mate preserves history", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        yield* s.given.project("Bea", { mate: true });
        yield* seed(s, "Bea", [["Earlier question", "Bea's conversation history"]]);
        yield* s.given.signedIn;
        yield* chat.when.open();
        yield* chat.then.text("The existing conversation is still here");
        const adaDoors = doorCount(s);
        yield* chat.when.open("Bea", "Bea's conversation history");
        const beaDoors = doorCount(s, "Bea");
        yield* chat.when.returnTo();
        yield* chat.when.type("Keep this draft with Ada");
        yield* chat.when.open("Bea", "Bea's conversation history");
        yield* chat.when.returnTo();
        yield* chat.then.text("The existing conversation is still here");
        yield* chat.then.draft("Keep this draft with Ada");
        yield* chat.then.noButton("Sign in");
        expect(doorCount(s), "ASSERTION: returning to Ada reuses its parked door").toBe(adaDoors);
        expect(doorCount(s, "Bea"), "ASSERTION: returning to Bea reuses its parked door").toBe(
          beaDoors,
        );
        yield* s.then.noReload;
        yield* s.then.noExternalNetwork;
      }),
    );

    describe("Decision: V1 behaviour unchanged; engine gets image parity.", () => {
      it.effect(
        "a tool screenshot and an attached image render from the Mate's asset references",
        () =>
          Effect.gen(function* () {
            const s = yield* createScenario([installArea]);
            const bytes = Buffer.from(
              yield* Effect.promise(() =>
                s.page.evaluate(() => {
                  const canvas = document.createElement("canvas");
                  canvas.width = 160;
                  canvas.height = 100;
                  const ctx = canvas.getContext("2d")!;
                  ctx.fillStyle = "blue";
                  ctx.fillRect(0, 0, 160, 100);
                  return canvas.toDataURL("image/png").split(",")[1]!;
                }),
              ),
              "base64",
            );
            s.drivers.onMate.push((mate) => {
              const handle = mate.handle;
              mate.handle = (request) =>
                request.url.pathname.includes("/api/assets/objects/")
                  ? Promise.resolve({
                      bytes,
                      headers: {
                        "content-type": "image/png",
                        "access-control-allow-headers": "authorization, dpop",
                      },
                    })
                  : handle(request);
            });
            yield* s.given.project("Ada", { mate: true });
            const chat = mateChat(s);
            const fixture = chat.fixture();
            const mate = fixture.mate;
            const asset = {
              id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
              threadId: ThreadId.make(`${mate.thread.id}/s/1`),
              ownerId: "browser-call",
              name: "tool-image",
              provenance: "capture" as const,
              original: {
                status: "ready" as const,
                digest: "a".repeat(64),
                mimeType: "image/png",
                sizeBytes: bytes.length,
                width: 160,
                height: 100,
              },
            };
            const attachment = {
              type: "image" as const,
              id: "attached-picture",
              name: "attached.png",
              mimeType: "image/png",
              sizeBytes: bytes.length,
              width: 160,
              height: 100,
              asset: {
                ...asset,
                id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                threadId: mate.thread.id,
                provenance: "upload" as const,
              },
            };
            const metadata: string[] = [];
            const screenshotThreadIds: ThreadId[] = [];
            Object.assign(mate.descriptor.capabilities!, { contentAddressedImages: true });
            Object.assign(mate.config.environment.capabilities, { contentAddressedImages: true });
            mate.rpcHandlers.unshift((request, socket) => {
              if (request.tag !== WS_METHODS.assetsCreateUrl) return false;
              const input = Schema.decodeUnknownSync(AssetCreateUrlInput)(request.payload);
              const resource = input.resource;
              if (resource._tag === "project-favicon") return false;
              const attached = resource._tag === "attachment";
              if (!attached) screenshotThreadIds.push(resource.threadId);
              metadata.push(attached ? "attachment" : "screenshot");
              const digest = (attached ? "b" : "a").repeat(64);
              const relativeUrl = `/api/assets/objects/${digest}/${input.preview ? "preview" : "original"}`;
              mate.reply(
                socket,
                request.id,
                Schema.encodeSync(AssetCreateUrlResult)({
                  relativeUrl,
                  expiresAt: 0,
                  occurrence: attached ? attachment.asset : asset,
                  representation: {
                    digest,
                    relativeUrl,
                    mimeType: "image/png",
                    sizeBytes: bytes.length,
                    width: 160,
                    height: 100,
                  },
                }),
              );
              return true;
            });
            const result = {
              toolName: "zerops_browser",
              resultText: '{"url":"https://tvstav.cz","steps":[]}',
              images: [{ mimeType: "image/png", asset, width: 160, height: 1 }],
            };
            const engine = fixture.wire.engine;
            const run = engine.personRun("Check these pictures");
            const person = [...engine.items.values()].find(
              (item) => item.runId === run && item.kind === "person",
            )!;
            engine.update(person.id, { attachments: [attachment] });
            engine.item(run, {
              kind: "call",
              step: "mcp",
              words: "Browser",
              state: "done",
              endedAt: 1791201600000,
              tool: { name: "zerops_browser", server: "zerops" },
              result,
            });
            engine.note(run, "Pictures checked", { kind: "completed" });
            yield* s.given.signedIn;
            yield* chat.when.open("Ada", "Check these pictures");
            yield* Effect.promise(async () => {
              await s.page.waitForFunction(() =>
                ["[data-result-picture] img", 'img[alt="attached.png"]'].every((selector) => {
                  const img = document.querySelector<HTMLImageElement>(selector);
                  return img !== null && img.complete && img.naturalWidth === 160;
                }),
              );
              expect(screenshotThreadIds).not.toHaveLength(0);
              for (const threadId of screenshotThreadIds)
                expect(
                  threadId,
                  "ASSERTION: screenshot requests target the owning Mate conversation",
                ).toBe(mate.thread.id);
              expect(
                metadata,
                "ASSERTION: screenshot and attachment resolve through the image data layer",
              ).toEqual(expect.arrayContaining(["screenshot", "attachment"]));
              expect(await s.page.evaluate(() => document.body.textContent)).not.toContain(
                "Image no longer available",
              );
            });
            yield* s.then.noExternalNetwork;
          }),
      );
    });

    // Catches a saved conversation link failing in a browser that has never opened this Mate.
    it.effect("cold direct conversation URL opens the named Mate and its history", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        yield* s.given.signedIn;
        expect(doorCount(s)).toBe(0);
        yield* chat.when.visit(route(s));
        yield* chat.then.ready("Ada");
        expect(doorCount(s)).toBe(1);
        yield* chat.then.headerName("Ada");
        yield* chat.then.text("The existing conversation is still here");
        yield* chat.then.path(route(s));
        yield* s.then.noExternalNetwork;
      }),
    );

    it.effect("/mate/project-id opens the Mate conversation from a cold door", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        yield* s.given.signedIn;
        expect(doorCount(s)).toBe(0);
        yield* chat.when.visit("/mate/Ada");
        yield* chat.then.ready("Ada");
        expect(doorCount(s)).toBe(1);
        yield* chat.then.headerName("Ada");
        yield* chat.then.path(route(s));
        yield* chat.then.text("The existing conversation is still here");
        yield* s.then.noExternalNetwork;
      }),
    );

    for (const [sentence, skew] of [
      ["a sent message keeps a long conversation at its end", 0],
      [
        "a message the Mate's clock puts on another day keeps a long conversation at its end",
        -3 * 24 * 60 * 60 * 1000,
      ],
    ] as const) {
      it.effect(sentence, () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          yield* s.given.project("Ada", { mate: true });
          const chat = mateChat(s);
          const wire = chat.fixture();
          for (const round of [1, 2, 3])
            wire.exchange(`Deploy ${round}`, "Deployment logs are clean.\n\n".repeat(30));
          wire.exchange("And now?", history);
          wire.skewClock(skew);
          yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
          yield* s.given.signedIn;
          yield* Effect.promise(() => ownerViewport(s.page));
          yield* chat.when.open();
          yield* Effect.promise(() => waitForStillFrames(s.page));
          const trace = yield* Effect.promise(() =>
            s.page.evaluateHandle(() => {
              const state = { active: true, readings: [] as number[] };
              const sample = () => {
                if (!state.active) return;
                const list = document.querySelector<HTMLElement>(".timeline-legend-list")!;
                state.readings.push(list.scrollHeight - list.clientHeight - list.scrollTop);
                requestAnimationFrame(sample);
              };
              sample();
              return state;
            }),
          );
          expect(
            yield* Effect.promise(() => trace.evaluate((state) => state.readings[0])),
          ).toBeLessThanOrEqual(2);
          yield* chat.when.send("Keep me at the end, whatever day the Mate says it is");
          yield* chat.then.once("Keep me at the end, whatever day the Mate says it is");
          yield* Effect.promise(() => waitForStillFrames(s.page, { stillFrames: 12 }));
          const readings = yield* Effect.promise(() =>
            trace.evaluate((state) => {
              state.active = false;
              return state.readings;
            }),
          );
          yield* Effect.promise(() => trace.dispose());
          expect(readings.length).toBeGreaterThan(10);
          expect(
            Math.max(...readings),
            "ASSERTION: the acknowledged message never takes the long conversation to its top",
          ).toBeLessThan(400);
          expect(
            readings.at(-1),
            "ASSERTION: the acknowledged message leaves the conversation at its end",
          ).toBeLessThanOrEqual(2);
          yield* s.then.noExternalNetwork;
        }),
      );
    }

    // Catches reload losing the selected chat/history or turning a kept session into a slow cold opening.
    it.effect("reload restores history", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        yield* s.given.signedIn;
        yield* chat.when.open();
        yield* chat.when.reload();
        yield* chat.then.headerName("Ada");
        yield* chat.then.text("The existing conversation is still here");
        yield* chat.then.path(route(s));
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches Enter dropping a prompt, showing it only in the editor, or losing the acknowledged message on reload.
    it.effect("sending a message puts it in the durable visible conversation", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        yield* s.given.signedIn;
        yield* chat.when.open();
        yield* chat.when.send("Please inspect the Shop project");
        expect(
          s.drivers.realMates.get("Ada")!.provider.sends.map((send) => send.input.input),
        ).toEqual(["Earlier question", "Please inspect the Shop project"]);
        yield* chat.then.once("Please inspect the Shop project");
        yield* chat.when.reload("Ada", "Please inspect the Shop project");
        yield* chat.then.headerName("Ada");
        yield* chat.then.once("Please inspect the Shop project");
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches the conversation opening mid-way (an engine Mate's did on CI, "list at 1764 of
    // 3905"): the list re-applied its own scroll after the view was placed at the end, and the
    // move was read as the person leaving it.
    it.effect(
      "a long conversation opens at its end, and the list's own scrolls never leave it",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([], { mate: "real" });
          yield* s.given.project("Ada", { mate: true });
          const chat = realChat(s);
          yield* seed(s, "Ada", [
            ...[1, 2, 3].map((round) => [
              `How did deploy ${round} go?`,
              "The shop's deploy built, its logs are clean and the storefront answers.\n\n".repeat(
                30,
              ),
            ]),
            ["And now?", history],
          ]);
          yield* s.given.signedIn;
          yield* chat.when.open();
          const fromEnd = () =>
            Effect.promise(() =>
              s.page.evaluate(async () => {
                const readings: number[] = [];
                for (let frame = 0; frame < 60; frame += 1) {
                  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
                  const scroll = document.querySelector<HTMLElement>(".timeline-legend-list");
                  if (scroll !== null)
                    readings.push(scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop);
                }
                return readings;
              }),
            );
          expect((yield* fromEnd()).at(-1)).toBeLessThanOrEqual(2);
          // The list puts its scroll back where it once aimed, as LegendList's initial scroll does
          // while its rows measure: the page's own move, never the person's.
          yield* Effect.promise(() =>
            s.page.evaluate(() => {
              const scroll = document.querySelector<HTMLElement>(".timeline-legend-list")!;
              scroll.scrollTo({ top: Math.round(scroll.scrollHeight * 0.45) });
            }),
          );
          expect((yield* fromEnd()).at(-1)).toBeLessThanOrEqual(2);
          yield* chat.then.text("The existing conversation is still here");
          yield* s.then.noExternalNetwork;
        }),
    );

    // Approval crosses the real browser, Mate engine and provider callback.
    const respondToCommand = (decision: "accept" | "decline") =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        const { server, provider, gate } = s.drivers.realMates.get("Ada")!;
        const conversationId = ConversationId.make(route(s).split("/").at(-1)!);
        const changes = yield* Queue.unbounded<EngineConversationFrame>();
        yield* server.engine.wire
          .subscribe(
            { protocol: MATE_ENGINE_PROTOCOLS[0]!, conversationId },
            { subject: "scenario-person", environmentId: "scenario", epoch: 1 },
          )
          .pipe(
            Stream.runForEach((frame) => Queue.offer(changes, frame)),
            Effect.forkScoped,
          );
        while ((yield* Queue.take(changes)).type !== "synchronized") {}
        const result = decision === "accept" ? "Build completed" : "Command declined";
        yield* provider.turn([
          { kind: "approval", detail: "vp run build" },
          ...(decision === "accept"
            ? [{ kind: "tool" as const, title: "vp run build", detail: "Build exited with code 0" }]
            : []),
          { kind: "say", text: result },
        ]);
        yield* s.given.signedIn;
        yield* chat.when.open();
        yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
        yield* mateChat(s).when.send("Build the project");
        expect((yield* provider.received).input.input).toBe("Build the project");
        let request: Request | undefined;
        while (!request) {
          const frame = yield* Queue.take(changes);
          if (frame.type === "changes")
            request = frame.requests.find((request) => request.state === "open");
        }
        expect(request.ask).toMatchObject({ kind: "approval", detail: "vp run build" });
        yield* chat.then.text("wants to run this command");
        expect(
          yield* Effect.promise(() =>
            s.page.$eval('[aria-label="Command"]', (element) => element.textContent),
          ),
          "ASSERTION: the browser shows the exact command awaiting the person's decision",
        ).toBe("vp run build");
        expect(provider.answers).toEqual([]);
        yield* chat.then.noText(result);
        const receipt = gate.answered((tag) => tag === "engine.answer");
        yield* chat.when.press(decision === "accept" ? "Approve" : "Decline");
        expect(yield* Effect.promise(() => receipt)).toMatchObject({
          exit: { _tag: "Success", value: { _tag: "Accepted" } },
        });
        let answered: Request | undefined;
        let completed: RunRecord | undefined;
        while (!answered || !completed) {
          const frame = yield* Queue.take(changes);
          if (frame.type !== "changes") continue;
          answered ??= frame.requests.find(
            (item) => item.id === request.id && item.state === "answered",
          );
          completed ??= frame.runs.find((run) => run.id === request.runId && run.state === "ended");
        }
        expect(answered.answer?.summary).toBe(decision === "accept" ? "Approved" : "Declined");
        expect(provider.answers.map(({ answer }) => answer)).toEqual([decision]);
        expect(completed.end).toEqual({ kind: "completed" });
        expect(completed.summary.calls).toEqual(decision === "accept" ? { command: 1 } : {});
        yield* chat.then.text(result);
        yield* chat.then.noButton("Approve");
        yield* chat.then.noButton("Decline");
        yield* chat.then.control("Stop generation", "button", false);
        yield* s.then.noExternalNetwork;
      });

    it.effect("approve an agent command and see it resolve", () => respondToCommand("accept"));

    it.effect("a free answer carries only the picture attached to that question", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        const { server, provider, gate } = s.drivers.realMates.get("Ada")!;
        const conversationId = ConversationId.make(route(s).split("/").at(-1)!);
        const changes = yield* Queue.unbounded<EngineConversationFrame>();
        yield* server.engine.wire
          .subscribe(
            { protocol: MATE_ENGINE_PROTOCOLS[0]!, conversationId },
            { subject: "scenario-person", environmentId: "scenario", epoch: 1 },
          )
          .pipe(
            Stream.runForEach((frame) => Queue.offer(changes, frame)),
            Effect.forkScoped,
          );
        while ((yield* Queue.take(changes)).type !== "synchronized") {}
        const requestIn = (state: "open" | "answered") =>
          Effect.gen(function* () {
            while (true) {
              const frame = yield* Queue.take(changes);
              const request =
                frame.type === "changes"
                  ? frame.requests.find((request) => request.state === state)
                  : undefined;
              if (request) return request;
            }
          });
        const finish = yield* Deferred.make<void>();
        yield* provider.turn([
          { kind: "ask", question: "Which environment should I inspect?" },
          { kind: "say", text: "Preview received" },
          { kind: "wait", until: finish },
        ]);
        yield* s.given.signedIn;
        yield* chat.when.open();
        yield* mateChat(s).when.send("Inspect the environment");
        expect((yield* provider.received).input.input).toBe("Inspect the environment");
        const question = yield* requestIn("open");
        yield* chat.then.text("Which environment should I inspect?");
        yield* chat.when.type("Inspect the preview shown here");
        const upload = s.page.waitForResponse(
          (response) => response.url().includes("/api/attachments/upload/") && response.ok(),
        );
        yield* chat.when.pastePicture("question-preview.png");
        yield* Effect.promise(() => upload);
        yield* chat.then.text("Attached to this answer");
        // Remove the real HTTP upload, rather than authoring an engine rejection.
        const pending = yield* Effect.promise(async () => {
          const directory = NodePath.join(server.stateDir, "attachments");
          const files = (await NodeFSP.readdir(directory)).filter((file) =>
            file.startsWith("pending-"),
          );
          expect(files).toHaveLength(1);
          const path = NodePath.join(directory, files[0]!);
          const bytes = await NodeFSP.readFile(path);
          await NodeFSP.rm(path);
          return { path, bytes };
        });
        const refusal = gate.answered((tag) => tag === "engine.answer");
        yield* chat.when.key("Enter");
        expect(yield* Effect.promise(() => refusal)).toMatchObject({
          exit: {
            _tag: "Success",
            value: { _tag: "Rejected", rejection: { reason: "attachment-refused" } },
          },
        });
        expect(provider.answers).toHaveLength(0);
        yield* chat.then.text(
          "Attachment 'question-preview.png' cannot be sent: attachment not found (removed or expired).",
        );
        yield* chat.then.composerText("Inspect the preview shown here");
        yield* chat.then.text("question-preview.png");
        yield* Effect.promise(() => NodeFSP.writeFile(pending.path, pending.bytes));
        const accepted = gate.answered((tag) => tag === "engine.answer");
        yield* chat.when.key("Enter");
        expect(yield* Effect.promise(() => accepted)).toMatchObject({
          exit: { _tag: "Success", value: { _tag: "Accepted" } },
        });
        const answered = yield* requestIn("answered");
        expect(answered.id).toBe(question.id);
        expect(answered.answer).toMatchObject({
          answers: { "0": "Inspect the preview shown here" },
          attachmentsByQuestionId: { "0": [{ name: "question-preview.png" }] },
        });
        expect(Object.keys(answered.answer!.attachmentsByQuestionId!)).toEqual(["0"]);
        expect(answered.answer!.attachmentsByQuestionId!["0"]).toHaveLength(1);
        yield* chat.then.text("Preview received");
        expect(provider.answers).toHaveLength(1);
        const picture = answered.answer!.attachmentsByQuestionId!["0"]![0]!;
        const picturePath = NodePath.join(server.stateDir, "attachments", `${picture.id}.png`);
        const quotedPath = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.String))(
          picturePath,
        );
        expect(provider.answers[0]!.answer).toEqual({
          "0": `Inspect the preview shown here\n\nAttached image "question-preview.png": ${quotedPath}`,
        });
        expect(yield* Effect.promise(() => NodeFSP.readFile(picturePath))).toEqual(pending.bytes);
        // Counted in the live run, before it settles and folds its work away.
        yield* chat.then.once("Inspect the preview shown here");
        yield* Deferred.succeed(finish, undefined);
        yield* chat.then.control("Stop generation", "button", false);
        yield* chat.when.activateLast("Show work");
        yield* chat.when.press("Open question-preview.png");
        yield* chat.then.text("question-preview.png");
        yield* chat.when.key("Escape");
        yield* chat.then.noText("Attached to this answer");
        yield* chat.then.draft("");
        yield* chat.when.reload();
        yield* chat.when.activateLast("Show work");
        yield* chat.then.once("Inspect the preview shown here");
        yield* chat.then.control("Open question-preview.png");
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
