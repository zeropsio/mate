// @effect-diagnostics nodeBuiltinImport:off -- the page file zcp keeps in the Mate's workspace, and the Mate's record of its height.
/** A run that publishes a page, in a conversation the scenario opens, on the real Mate. */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { RuntimeItemId, WS_METHODS } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import type { ScriptedStep } from "../../../../../server/integration/scriptedProviderDriver.ts";
import { createScenario } from "../../harness/scenario.ts";

export const TITLE = "Launch plan";
export const ANSWER = "Week one is the hardest.";
const EARLIER_TITLE = "Overview";
const EARLIER_ANSWER = "The overview stands above.";
const LONG_ANSWER = Array.from(
  { length: 40 },
  () => "A long line of the Mate's words that fills the conversation.",
).join(" ");
/** How tall a page is: in pixels, or in its viewport's height (`600vh`), as slides are. */
export type PageTall = number | `${number}vh`;

/** A page as an agent writes one: it reaches for the network, and it is taller or shorter. */
const pageOf = (height: PageTall, script = 'fetch("https://example.com/beacon").catch(()=>{});') =>
  `<!doctype html><html><head><title>${TITLE}</title>` +
  `<style>.plan{box-sizing:border-box;height:${typeof height === "number" ? `${height}px` : height};padding:16px;color:var(--foreground)}</style></head>` +
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
      // The answer in the conversation, never its preview in the menu.
      const element = walker.currentNode.parentElement;
      if (!element?.closest("[data-timeline-row-kind]")) continue;
      const box = element.getBoundingClientRect();
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

/**
 * A call to zcp's `zerops_publish_page` as OpenCode reports it (an MCP tool is `<server>_<tool>`):
 * its result names the file zcp wrote in the session's `.zcp/state/pages`.
 */
const publishCall = (id: string, file: string, title: string): ScriptedStep[] =>
  (["item.started", "item.completed"] as const).map((type) =>
    mcpCall(type, id, "zerops_zerops_publish_page", JSON.stringify({ page: { file, title } })),
  );

const mcpCall = (
  type: "item.started" | "item.completed",
  id: string,
  tool: string,
  output: string,
): ScriptedStep => ({
  kind: "event",
  event: {
    type,
    itemId: RuntimeItemId.make(id),
    payload: {
      itemType: "mcp_tool_call",
      status: type === "item.completed" ? "completed" : "inProgress",
      data: {
        tool,
        state:
          type === "item.completed"
            ? { status: "completed", input: {}, output }
            : { status: "running", input: {} },
      },
    },
  },
});

const isPageHeight = (tag: string) => tag === WS_METHODS.engineRecordPageHeight;

export const journey = (
  height: PageTall,
  options: {
    readonly script?: string;
    /** An earlier run published a page of its own, and a long exchange followed it. */
    readonly earlierPage?: boolean;
    /** The run goes on working after the page landed: another call opens before it answers. */
    readonly workOn?: boolean;
  } = {},
) =>
  Effect.gen(function* () {
    const s = yield* createScenario([], { mate: "real" });
    yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
    yield* s.given.project("Ada", { mate: true });
    const ada = s.drivers.realMates.get("Ada")!;
    const pages = NodePath.join(ada.server.root, "workspace", ".zcp", "state", "pages");
    const pageFile = (name: string, html: string) =>
      Effect.promise(async () => {
        await NodeFSP.mkdir(pages, { recursive: true });
        const file = NodePath.join(pages, name);
        await NodeFSP.writeFile(file, html);
        return file;
      });
    /** The heights the Mate recorded for each page, from its own record. */
    const recorded = () => {
      const db = new NodeSqlite.DatabaseSync(ada.server.dbPath, { readOnly: true });
      try {
        return db
          .prepare("SELECT item_id, height FROM engine_page_height ORDER BY at")
          .all() as Array<{ item_id: string; height: number }>;
      } finally {
        db.close();
      }
    };
    yield* s.given.signedIn;
    yield* s.when.menu.opensMate("Ada");
    yield* s.then.conversation.appears;
    if (options.earlierPage === true) {
      const earlier = yield* pageFile("page-dddddddddddddddd.html", pageOf(height, options.script));
      yield* ada.provider.turn([
        ...publishCall("overview", earlier, EARLIER_TITLE),
        { kind: "say", text: EARLIER_ANSWER },
      ]);
      const measured = ada.gate.answered(isPageHeight);
      yield* s.when.conversation.sends("Sketch the overview");
      yield* s.then.conversation.showsMessage(EARLIER_ANSWER);
      yield* Effect.promise(() => measured);
      yield* ada.provider.turn([{ kind: "say", text: LONG_ANSWER }]);
      yield* s.when.conversation.sends("Tell me more");
      yield* s.then.conversation.showsMessage(LONG_ANSWER);
    }
    const earlierPages = new Set(recorded().map((row) => row.item_id));
    const file = yield* pageFile("page-cccccccccccccccc.html", pageOf(height, options.script));
    const go = {
      publish: Deferred.makeUnsafe<void>(),
      work: Deferred.makeUnsafe<void>(),
      answer: Deferred.makeUnsafe<void>(),
    };
    yield* ada.provider.turn([
      { kind: "wait", until: go.publish },
      ...publishCall("plan", file, TITLE),
      ...(options.workOn === true
        ? [
            { kind: "wait", until: go.work } as const,
            mcpCall("item.started", "browse", "zerops_zerops_browser", ""),
          ]
        : []),
      { kind: "wait", until: go.answer },
      ...(options.workOn === true
        ? [mcpCall("item.completed", "browse", "zerops_zerops_browser", "{}")]
        : []),
      { kind: "say", text: ANSWER },
    ]);
    yield* s.when.conversation.sends("Plan the launch");
    yield* s.then.conversation.showsMessage("Plan the launch");
    // The run works in its conversation, past the draft it was sent from: a page lands in a
    // conversation that stands.
    yield* Effect.promise(() =>
      s.page.waitForFunction(() => !location.pathname.startsWith("/draft/"), {
        polling: 100,
      }),
    );
    // Registered before the page can land: its first height may be recorded at once.
    let pageHeight = ada.gate.answered(isPageHeight);
    const release = (step: Deferred.Deferred<void>) => () =>
      void Deferred.doneUnsafe(step, Effect.void);
    /** The call that publishes the page lands while the run still works. */
    const publishLive = release(go.publish);
    /** The run answers and ends: its card settles and folds. */
    const answer = release(go.answer);
    const publish = () => {
      publishLive();
      answer();
    };
    /** The run goes on working: another call opens after the page landed. */
    const workOn = release(go.work);
    /** Once the view recorded this page's height: every height the Mate keeps for it. */
    const measured = Effect.promise(async () => {
      for (;;) {
        await pageHeight;
        pageHeight = ada.gate.answered(isPageHeight);
        const heights = recorded().filter((row) => !earlierPages.has(row.item_id));
        if (heights.length > 0) return heights.map((row) => row.height);
      }
    });
    const reload = Effect.gen(function* () {
      yield* Effect.promise(() => s.page.reload());
      yield* s.then.conversation.showsMessage(ANSWER);
    });
    return { s, ada, publish, publishLive, workOn, answer, measured, reload };
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
        { polling: 100 },
      );
      return s.page.evaluate(
        () => (window as unknown as { pageSamples: Sample[] }).pageSamples,
      ) as Promise<Sample[]>;
    });
  });
