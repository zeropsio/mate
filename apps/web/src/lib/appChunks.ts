/**
 * The app's own lazy surfaces (routes, the conversation, its panels, the review), loaded once the
 * page has settled, so a deploy that removes this build's chunks never reaches a person's click.
 *
 * Each deploy replaces the whole bundle (`staleChunk.ts`): a tab open across a deploy that opens a
 * surface it has not opened yet asks for a chunk the host no longer has, and the only recovery is a
 * reload that takes the page away behind the click. A module once imported stays in the page's
 * module map, and a later `import()` of it is answered from there with no request: warmed, the tab
 * keeps working on its own build however many deploys pass. Content renderers (syntax grammars,
 * diagrams, image decoders) are not surfaces and stay on demand; they recover in place.
 *
 * One at a time, each in an idle slice, after the page's first seconds: warming never competes
 * with what the person waits on. A surface that registers while warming (the conversation's
 * panels, declared inside the conversation's own chunk) is warmed in the same pass.
 */

type Load = () => Promise<unknown>;

/** Every surface the app declared, in the order it declared them. */
const registered = new Set<Load>();
const listeners = new Set<() => void>();

/** Declares a lazy surface's loader as the app's own: it is warmed with the rest. */
export function appChunk<T>(load: () => Promise<T>): () => Promise<T> {
  registered.add(load);
  for (const listener of listeners) listener();
  return load;
}

export interface ChunkWarmerHost {
  /** The loaders declared so far; read again after each load, which may declare more. */
  readonly loaders: () => Iterable<Load>;
  /** Runs `then` in the page's next idle slice. */
  readonly idle: (then: () => void) => void;
  /** Told when a pass has loaded every declared loader and each load has settled. */
  readonly drained: () => void;
}

/**
 * Loads every declared loader once, one per idle slice, until none is left unloaded. A load that
 * fails is not retried here: the surface's own use meets it (`staleChunk.ts`).
 */
export function makeChunkWarmer(host: ChunkWarmerHost) {
  const loaded = new Set<Load>();
  let running = false;
  const next = (): Load | undefined => {
    for (const load of host.loaders()) if (!loaded.has(load)) return load;
    return undefined;
  };
  const step = () => {
    const load = next();
    if (load === undefined) {
      running = false;
      host.drained();
      return;
    }
    loaded.add(load);
    host.idle(() => {
      // A failed load moves on to the next surface; its own use meets the failure again.
      void load().then(step, step);
    });
  };
  /** Starts warming, or does nothing while a pass runs: it reads the declared loaders as it goes. */
  const warm = () => {
    if (running) return;
    running = true;
    step();
  };
  return { warm, loaded: () => loaded.size };
}

/** How long the page settles before its surfaces are warmed. */
export const SETTLE_MS = 4_000;

/** The window event a finished warming pass dispatches: the page's receipt that it is warm. */
export const CHUNKS_WARMED = "mate:chunks-warmed";

/**
 * Warms the app's surfaces in this page: the router's route chunks beside every declared loader.
 * Started once, after the page's first seconds; a surface declared later starts another pass.
 */
export function warmAppChunksAfterSettling(routeLoaders: ReadonlyArray<Load>): void {
  const idle = (then: () => void) => {
    if (typeof window.requestIdleCallback === "function")
      window.requestIdleCallback(then, { timeout: 2_000 });
    else window.setTimeout(then, 50);
  };
  const warmer = makeChunkWarmer({
    loaders: () => [...routeLoaders, ...registered],
    idle,
    drained: () => window.dispatchEvent(new Event(CHUNKS_WARMED)),
  });
  window.setTimeout(() => {
    listeners.add(warmer.warm);
    warmer.warm();
  }, SETTLE_MS);
}
