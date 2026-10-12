/** A run that publishes a page, in a conversation the scenario opens (the engine's wire). */
import {
  AssetCreateUrlInput,
  AssetCreateUrlResult,
  ThreadId,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { createScenario } from "../../harness/scenario.ts";
import { mateChat } from "./dsl.ts";
import { installArea } from "./fake.ts";

const decodeCreateUrl = Schema.decodeUnknownSync(AssetCreateUrlInput);
const encodeCreateUrl = Schema.encodeSync(AssetCreateUrlResult);
export const TITLE = "Launch plan";
export const ANSWER = "Week one is the hardest.";
const EARLIER_TITLE = "Overview";

/** A page as an agent writes one: it reaches for the network, and it is taller or shorter. */
const pageOf = (height: number, script = 'fetch("https://example.com/beacon").catch(()=>{});') =>
  `<!doctype html><html><head><title>${TITLE}</title>` +
  `<style>.plan{box-sizing:border-box;height:${height}px;padding:16px;color:var(--foreground)}</style></head>` +
  `<body><div class="plan"><h1>Plan</h1><img src="https://example.com/chart.png" alt=""></div>` +
  `<script>${script}</script></body></html>`;

/** One frame of the page's place in the conversation: its frame's height, the answer under it. */
export interface Sample {
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
    // Only what the person sees: a conversation still placing its rows is not shown yet.
    if (box !== null && document.querySelector("[data-timeline-placing]") === null) {
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

export const journey = (
  height: number,
  options: {
    readonly slowBytes?: boolean;
    readonly script?: string;
    /** An earlier run published a page of its own, and a long exchange followed it. */
    readonly earlierPage?: boolean;
    /** The area's install: the engine's own wire where the suite runs V1's by default. */
    readonly install?: typeof installArea;
  } = {},
) =>
  Effect.gen(function* () {
    const s = yield* createScenario([options.install ?? installArea]);
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
    return { s, chat, engine, publish, publishLive, workOn, answer };
  });

/** Starts the sampler, lets `act` happen, and reads every frame until the page has stood still. */
export const sampled = (
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
