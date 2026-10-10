import { describe, expect, it } from "@effect/vitest";
import {
  AssetCreateUrlInput,
  AssetCreateUrlResult,
  ThreadId,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { mateChat } from "./dsl.ts";
import { EngineChatWire } from "./engine.ts";
import { installArea } from "./fake.ts";

const decodeCreateUrl = Schema.decodeUnknownSync(AssetCreateUrlInput);
const encodeCreateUrl = Schema.encodeSync(AssetCreateUrlResult);
const TITLE = "Launch plan";
const ANSWER = "Week one is the hardest.";
const EARLIER_TITLE = "Overview";

/** A page as an agent writes one: it reaches for the network, and it is taller or shorter. */
const pageOf = (height: number, script = 'fetch("https://example.com/beacon").catch(()=>{});') =>
  `<!doctype html><html><head><title>${TITLE}</title>` +
  `<style>.plan{box-sizing:border-box;height:${height}px;padding:16px;color:var(--foreground)}</style></head>` +
  `<body><div class="plan"><h1>Plan</h1><img src="https://example.com/chart.png" alt=""></div>` +
  `<script>${script}</script></body></html>`;

/** One frame of the page's place in the conversation: its frame's height, the answer under it. */
interface Sample {
  /** When, in ms since the sampler started. */
  readonly t: number;
  readonly frame: number;
  /** How far the answer's words stand below the frame's top; null before they show. */
  readonly answer: number | null;
  readonly loaded: boolean;
}

/** Records every frame from the moment the page's frame first paints. */
const SAMPLER = (title: string, answer: string) => {
  const samples: Array<{ t: number; frame: number; answer: number | null; loaded: boolean }> = [];
  const start = performance.now();
  (window as unknown as { pageSamples: typeof samples }).pageSamples = samples;
  const answerTop = () => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent?.includes(answer)) continue;
      const box = walker.currentNode.parentElement?.getBoundingClientRect();
      if (box && box.height > 0) return box.top;
    }
    return null;
  };
  const tick = () => {
    const box = document.querySelector(`figure[aria-label="${title}"] > div`);
    if (box !== null) {
      const rect = box.getBoundingClientRect();
      const top = answerTop();
      samples.push({
        t: performance.now() - start,
        frame: Math.round(rect.height * 10) / 10,
        answer: top === null ? null : Math.round((top - rect.top) * 10) / 10,
        loaded: box.querySelector("iframe") !== null,
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

/** How long the Mate takes to hand the page's bytes over: the page loads that much later. */
const BYTES_AFTER_MS = 1500;

const journey = (
  height: number,
  options: {
    readonly slowBytes?: boolean;
    readonly script?: string;
    /** An earlier run published a page of its own, and a long exchange followed it. */
    readonly earlierPage?: boolean;
  } = {},
) =>
  Effect.gen(function* () {
    const s = yield* createScenario([installArea]);
    yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
    const html = Buffer.from(pageOf(height, options.script));
    const digest = "c".repeat(64);
    s.drivers.onMate.push((mate) => {
      Object.assign(mate.descriptor.capabilities!, { contentAddressedImages: true });
      Object.assign(mate.config.environment.capabilities, { contentAddressedImages: true });
      const handle = mate.handle;
      mate.handle = (request) =>
        request.url.pathname.includes(`/api/assets/objects/${digest}/`)
          ? new Promise((resolve) =>
              setTimeout(
                () =>
                  resolve({
                    bytes: html,
                    headers: {
                      "content-type": "text/html",
                      "access-control-allow-headers": "authorization, dpop",
                    },
                  }),
                options.slowBytes ? BYTES_AFTER_MS : 0,
              ),
            )
          : handle(request);
      mate.rpcHandlers.unshift((request, socket) => {
        if (request.tag !== WS_METHODS.assetsCreateUrl) return false;
        const input = decodeCreateUrl(request.payload);
        if (input.resource._tag !== "media-file") return false;
        const relativeUrl = `/api/assets/objects/${digest}/original`;
        mate.reply(
          socket,
          request.id,
          encodeCreateUrl({
            relativeUrl,
            expiresAt: 0,
            representation: { digest, relativeUrl, mimeType: "text/html", sizeBytes: html.length },
          }),
        );
        return true;
      });
    });
    yield* s.given.project("Ada", { mate: true });
    const chat = mateChat(s);
    const fixture = chat.fixture();
    if (!(fixture.wire instanceof EngineChatWire)) throw new Error("A page is the engine's alone");
    const engine = fixture.wire.engine;
    const page = {
      asset: {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        threadId: ThreadId.make(`${fixture.mate.thread.id}/s/1`),
        ownerId: "publish-call",
        name: "page-0123456789abcdef.html",
        provenance: "capture" as const,
        original: {
          status: "ready" as const,
          digest,
          mimeType: "text/html",
          sizeBytes: html.length,
        },
      },
      title: TITLE,
      bytes: html.length,
      publishedAt: 1791201600000,
    };
    if (options.earlierPage === true) {
      const first = engine.personRun("Sketch the overview");
      engine.item(first, {
        kind: "call",
        step: "mcp",
        words: "MCP tool call",
        state: "done",
        endedAt: 1791201500000,
        tool: { name: "zerops_publish_page", server: "zerops" },
        result: {
          toolName: "zerops_publish_page",
          resultText: '{"page":{}}',
          page: {
            ...page,
            asset: { ...page.asset, id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
            title: EARLIER_TITLE,
            publishedAt: 1791201500000,
          },
        },
      });
      engine.note(first, "The overview stands above.", { kind: "completed" });
      engine.note(
        engine.personRun("Tell me more"),
        "A long line of the Mate's words that fills the conversation. ".repeat(40),
        { kind: "completed" },
      );
    }
    const run = engine.personRun("Plan the launch");
    yield* s.given.signedIn;
    yield* chat.when.open("Ada", "Plan the launch");
    /** The call that publishes the page lands while the run still works. */
    const publishLive = () =>
      engine.item(run, {
        kind: "call",
        step: "mcp",
        words: "MCP tool call",
        state: "done",
        endedAt: 1791201600000,
        tool: { name: "zerops_publish_page", server: "zerops" },
        result: { toolName: "zerops_publish_page", resultText: '{"page":{}}', page },
      });
    /** The run answers and ends: its card settles and folds. */
    const answer = () => engine.note(run, ANSWER, { kind: "completed" });
    const publish = () => {
      publishLive();
      answer();
    };
    /** The run goes on working: another call opens after the page landed. */
    const workOn = () =>
      engine.item(run, {
        kind: "call",
        step: "mcp",
        words: "MCP tool call",
        state: "running",
        endedAt: null,
        tool: { name: "zerops_browser", server: "zerops" },
      });
    return { s, chat, publish, publishLive, workOn, answer };
  });

/** Starts the sampler, lets `act` happen, and reads every frame until the page has stood still. */
const sampled = (
  s: Effect.Success<ReturnType<typeof journey>>["s"],
  act: Effect.Effect<void>,
  onNewDocument = false,
) =>
  Effect.gen(function* () {
    if (onNewDocument)
      yield* Effect.promise(() => s.page.evaluateOnNewDocument(SAMPLER, TITLE, ANSWER));
    else yield* Effect.promise(() => s.page.evaluate(SAMPLER, TITLE, ANSWER));
    yield* act;
    return yield* Effect.promise(async () => {
      await s.page.waitForFunction(
        () => {
          const samples = (window as unknown as { pageSamples?: Sample[] }).pageSamples ?? [];
          const loadedAt = samples.findIndex((sample) => sample.loaded);
          return loadedAt !== -1 && samples.length - loadedAt > 40;
        },
        { polling: 100, timeout: 15_000 },
      );
      return s.page.evaluate(
        () => (window as unknown as { pageSamples: Sample[] }).pageSamples,
      ) as Promise<Sample[]>;
    });
  });

describe("C: a page the Mate publishes", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "a page the Mate publishes draws inline above its answer, and reaches no network",
      () =>
        Effect.gen(function* () {
          const { s, publish } = yield* journey(180);
          yield* sampled(
            s,
            Effect.sync(() => publish()),
          );
          const placed = yield* Effect.promise(() =>
            s.page.evaluate(
              (title, answer) => {
                const frame = document.querySelector(`iframe[title="${title}"]`);
                const answerBox = [...document.querySelectorAll("p, div")]
                  .findLast((node) => node.textContent?.trim() === answer)
                  ?.getBoundingClientRect();
                return {
                  sandbox: frame?.getAttribute("sandbox") ?? null,
                  frameBottom: frame?.getBoundingClientRect().bottom ?? null,
                  answerTop: answerBox?.top ?? null,
                };
              },
              TITLE,
              ANSWER,
            ),
          );
          expect(placed.sandbox, "ASSERTION: the page runs scripts alone").toBe("allow-scripts");
          expect(placed.frameBottom).not.toBeNull();
          expect(placed.answerTop, "ASSERTION: the answer stands under the page").not.toBeNull();
          expect(placed.answerTop!).toBeGreaterThanOrEqual(placed.frameBottom!);
          // Its image and its beacon were never asked for: the harness blocks and records any.
          yield* s.then.noExternalNetwork;
        }),
    );
  });

  // Milo, 2026-10-10: every page closed itself 0.4 s after it landed live, saying it had tried to
  // open something else, with no navigation at all: the run settling around it reloaded its frame.
  describe("Decision: only the page's own navigation takes it down.", () => {
    it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
      it.effect(
        "a page published during a live run is still open 3 s after its run settles and folds",
        () =>
          Effect.gen(function* () {
            const { s, publishLive, answer } = yield* journey(180);
            yield* Effect.sync(publishLive);
            yield* Effect.promise(() =>
              s.page.waitForSelector(`iframe[title="${TITLE}"]`, { timeout: 10_000 }),
            );
            yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 800)));
            yield* Effect.sync(answer);
            yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 3000)));
            const state = yield* Effect.promise(() =>
              s.page.evaluate(
                (title) => ({
                  framed: document.querySelector(`iframe[title="${title}"]`) !== null,
                  notice:
                    document.body.textContent?.includes("The page tried to open something else") ??
                    false,
                }),
                TITLE,
              ),
            );
            expect(state, "ASSERTION: the page stands, never closed").toEqual({
              framed: true,
              notice: false,
            });
            yield* s.then.noExternalNetwork;
          }),
      );
      // Milo, 2026-10-10: a new page's row was born twice, half a second apart: the list handed it
      // the earlier page's container, out of order, then sorted its containers, and a frame moved
      // in the document loads its page again.
      it.effect(
        "a page published during a live run loads once as it lands and its run settles",
        () =>
          Effect.gen(function* () {
            const { s, publishLive, workOn, answer } = yield* journey(180, { earlierPage: true });
            yield* Effect.promise(() =>
              s.page.evaluate((title) => {
                const loads: number[] = [];
                (window as unknown as { pageLoads: number[] }).pageLoads = loads;
                document.addEventListener(
                  "load",
                  (event) => {
                    const target = event.target;
                    if (target instanceof HTMLIFrameElement && target.title === title)
                      loads.push(performance.now());
                  },
                  true,
                );
              }, TITLE),
            );
            // The conversation stands placed before the page lands: its rows in the document in
            // the order they show.
            yield* Effect.promise(() =>
              s.page.waitForFunction(
                () => {
                  const tops = [...document.querySelectorAll("[data-timeline-row-id]")].map(
                    (row) => row.getBoundingClientRect().top,
                  );
                  return tops.length > 0 && tops.every((top, i) => i === 0 || top >= tops[i - 1]!);
                },
                { polling: 100, timeout: 10_000 },
              ),
            );
            yield* Effect.sync(publishLive);
            yield* Effect.promise(() =>
              s.page.waitForSelector(`iframe[title="${TITLE}"]`, { timeout: 10_000 }),
            );
            yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 300)));
            yield* Effect.sync(workOn);
            yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 1500)));
            yield* Effect.sync(answer);
            yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 2000)));
            const loads = yield* Effect.promise(
              () =>
                s.page.evaluate(
                  () => (window as unknown as { pageLoads: number[] }).pageLoads.length,
                ) as Promise<number>,
            );
            expect(loads, "ASSERTION: the frame loads once on landing").toBe(1);
            yield* s.then.noExternalNetwork;
          }),
      );
      it.effect("a page whose frame the conversation moves loads again and stays open", () =>
        Effect.gen(function* () {
          const { s, publish } = yield* journey(180);
          yield* Effect.sync(publish);
          yield* Effect.promise(() =>
            s.page.waitForSelector(`iframe[title="${TITLE}"]`, { timeout: 10_000 }),
          );
          yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 800)));
          // A list moving a row (React reordering keyed rows, the list recycling one) takes the
          // frame out of the document and puts it back: the browser loads its document again.
          yield* Effect.promise(() =>
            s.page.evaluate((title) => {
              const box = document.querySelector(`figure[aria-label="${title}"] > div`)!;
              const parent = box.parentElement!;
              const next = box.nextSibling;
              box.remove();
              parent.insertBefore(box, next);
            }, TITLE),
          );
          yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 2000)));
          const state = yield* Effect.promise(() =>
            s.page.evaluate(
              (title) => ({
                framed: document.querySelector(`iframe[title="${title}"]`) !== null,
                notice:
                  document.body.textContent?.includes("The page tried to open something else") ??
                  false,
              }),
              TITLE,
            ),
          );
          expect(state, "ASSERTION: a frame loaded again by a move is still the page").toEqual({
            framed: true,
            notice: false,
          });
          yield* s.then.noExternalNetwork;
        }),
      );
    });
  });

  describe("Decision: a page that navigates its own frame is not the page the Mate published.", () => {
    it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
      const LOGIN = "https://example.com/login";
      for (const trick of [
        { how: "by script", script: `location.href=${JSON.stringify(LOGIN)};`, takenDown: true },
        {
          how: "to a data: document",
          script: 'location.href="data:text/html,<h1>Sign in to Zerops</h1>";',
          takenDown: true,
        },
        {
          how: "by a refresh",
          script: `document.head.insertAdjacentHTML("beforeend",'<meta http-equiv="refresh" content="0;url=${LOGIN}">');`,
          takenDown: true,
        },
        {
          how: "by a link it clicks itself",
          script: `var a=document.createElement("a");a.href=${JSON.stringify(LOGIN)};document.body.append(a);a.click();`,
          takenDown: true,
        },
        {
          how: "by a named target",
          script: `window.name="self";window.open(${JSON.stringify(LOGIN)},"self");`,
          takenDown: true,
        },
        {
          how: "by a form",
          script: `var f=document.createElement("form");f.action=${JSON.stringify(LOGIN)};document.body.append(f);f.submit();`,
          takenDown: false,
        },
      ])
        it.effect(
          `a published page that navigates itself ${trick.how} sends nothing and is never shown`,
          () =>
            Effect.gen(function* () {
              const { s, publish } = yield* journey(180, {
                script: `setTimeout(function(){${trick.script}},400);`,
              });
              publish();
              yield* Effect.promise(() =>
                s.page.waitForSelector(`iframe[title="${TITLE}"]`, { timeout: 10_000 }),
              );
              yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 1500)));
              const state = yield* Effect.promise(() =>
                s.page.evaluate(
                  (title) => ({
                    framed: document.querySelector(`iframe[title="${title}"]`) !== null,
                    notice:
                      document.body.textContent?.includes(
                        "The page tried to open something else",
                      ) ?? false,
                  }),
                  TITLE,
                ),
              );
              expect(state, "ASSERTION: a page whose frame loads again is taken down").toEqual(
                trick.takenDown ? { framed: false, notice: true } : { framed: true, notice: false },
              );
              const readable = yield* Effect.promise(() =>
                Promise.all(
                  s.page
                    .frames()
                    .map((frame) =>
                      frame.evaluate(() => document.body?.textContent ?? "").catch(() => ""),
                    ),
                ),
              );
              expect(
                readable.some((text) => /Sign in to Zerops|Example Domain/.test(text)),
                "ASSERTION: what it navigated to stands nowhere in the conversation",
              ).toBe(false);
              // Nothing left: the harness records any request it would have made.
              yield* s.then.noExternalNetwork;
            }),
        );
    });
  });

  describe("Decision: geometry relations only; no style pins.", () => {
    it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
      it.effect(
        "a page taller than the shared cap holds its frame from its first paint: the answer under it never moves as it loads",
        () =>
          Effect.gen(function* () {
            const { s, publish } = yield* journey(2400, { slowBytes: true });
            const samples = yield* sampled(
              s,
              Effect.sync(() => publish()),
            );
            const heights = new Set(samples.map((sample) => sample.frame));
            expect(heights.size, `ASSERTION: one frame height, saw ${[...heights]}`).toBe(1);
            // The answer has risen in and settled long before the page's bytes come: from half a
            // second before the page loads through its load, nothing under the frame moves.
            const loadedAt = samples.find((sample) => sample.loaded)!.t;
            const settled = samples.filter((sample) => sample.t >= loadedAt - 500);
            expect(
              settled.some((sample) => !sample.loaded) && settled.some((sample) => sample.loaded),
              "ASSERTION: the page loads inside the watched window",
            ).toBe(true);
            const offsets = new Set(
              settled.flatMap((sample) => (sample.answer === null ? [] : [sample.answer])),
            );
            expect(offsets.size, `ASSERTION: the answer keeps its place, saw ${[...offsets]}`).toBe(
              1,
            );
            yield* s.then.noExternalNetwork;
          }),
      );

      it.effect(
        "a short page holds the shared cap from its first paint until it says its height, then eases down to it, never past it",
        () =>
          Effect.gen(function* () {
            const { s, publish } = yield* journey(180);
            const samples = yield* sampled(
              s,
              Effect.sync(() => publish()),
            );
            const heights = samples.map((sample) => sample.frame);
            expect(heights[0], "ASSERTION: it opens at the cap").toBeGreaterThan(400);
            expect(
              heights.every((height, i) => i === 0 || height <= heights[i - 1]!),
              `ASSERTION: it only ever eases down, saw ${[...new Set(heights)]}`,
            ).toBe(true);
            expect(heights.at(-1), "ASSERTION: it stands at the page's own height").toBe(182);
            yield* s.then.noExternalNetwork;
          }),
      );
    });
  });
});
