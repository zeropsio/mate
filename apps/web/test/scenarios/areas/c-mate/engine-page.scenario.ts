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

/** A page as an agent writes one: it reaches for the network, and it is taller or shorter. */
const pageOf = (height: number) =>
  `<!doctype html><html><head><title>${TITLE}</title>` +
  `<style>.plan{height:${height}px;background:var(--muted);color:var(--foreground)}</style></head>` +
  `<body><div class="plan"><h1>Plan</h1><img src="https://example.com/chart.png" alt=""></div>` +
  `<script>fetch("https://example.com/beacon").catch(()=>{});</script></body></html>`;

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

const journey = (height: number, slowBytes = false) =>
  Effect.gen(function* () {
    const s = yield* createScenario([installArea]);
    yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
    const html = Buffer.from(pageOf(height));
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
                slowBytes ? BYTES_AFTER_MS : 0,
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
    const run = engine.personRun("Plan the launch");
    yield* s.given.signedIn;
    yield* chat.when.open("Ada", "Plan the launch");
    const publish = () => {
      engine.item(run, {
        kind: "call",
        step: "mcp",
        words: "MCP tool call",
        state: "done",
        endedAt: 1791201600000,
        tool: { name: "zerops_publish_page", server: "zerops" },
        result: { toolName: "zerops_publish_page", resultText: '{"page":{}}', page },
      });
      engine.note(run, ANSWER, { kind: "completed" });
    };
    return { s, chat, publish };
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

  describe("Decision: geometry relations only; no style pins.", () => {
    it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
      it.effect(
        "a page taller than the shared cap holds its frame from its first paint: the answer under it never moves as it loads",
        () =>
          Effect.gen(function* () {
            const { s, publish } = yield* journey(2400, true);
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
        "after a reload a short page paints at its own height from its first frame: nothing under it moves",
        () =>
          Effect.gen(function* () {
            const { s, chat, publish } = yield* journey(180);
            const live = yield* sampled(
              s,
              Effect.sync(() => publish()),
            );
            const settled = live.at(-1)!.frame;
            const reloaded = yield* sampled(s, chat.when.reload("Ada", ANSWER), true);
            const heights = new Set(reloaded.map((sample) => sample.frame));
            expect(
              [...heights],
              "ASSERTION: the frame stands at its own height throughout",
            ).toEqual([settled]);
            const offsets = new Set(
              reloaded.flatMap((sample) => (sample.answer === null ? [] : [sample.answer])),
            );
            expect(offsets.size, `ASSERTION: the answer keeps its place, saw ${[...offsets]}`).toBe(
              1,
            );
            yield* s.then.noExternalNetwork;
          }),
      );
    });
  });
});
