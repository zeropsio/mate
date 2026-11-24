/**
 * The lazy surfaces of what this page opened (the conversation's panels, a review), loaded once
 * the page has settled, so opening one answers on the click's own commit. Routes and the
 * conversation itself are never warmed: every page load would then fetch and evaluate the whole
 * app. An open tab keeps the chunks of its build through the app-shell worker's asset cache, and a
 * chunk a later deploy removed recovers by the guarded reload (`staleChunk.ts`). Content renderers
 * (syntax grammars, diagrams, image decoders) stay on demand; they recover in place.
 *
 * One at a time, each in an idle slice, after the page's first seconds: warming never competes
 * with what the person waits on. A surface that registers while warming (the conversation's
 * panels, declared inside the conversation's own chunk) is warmed in the same pass.
 */

import { createElement, use, type ComponentType, type ReactPromise } from "react";

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

/** A surface's load, carrying the fields React's `use` reads to answer without suspending. */
type SurfaceLoad<M> = Promise<M> & ReactPromise<M>;

type PropsOf<T> = T extends ComponentType<infer P> ? P : never;

/**
 * Declares a lazy surface (`appChunk`) and returns the component that renders it. One load per
 * surface, shared by the warmer and every render: once it has resolved, `use` answers it in the
 * same render, so a surface whose code is here opens on the click's own commit with no loading
 * frame (a `lazy` object suspends on its first render even then). The element type never changes,
 * so nothing remounts when the code arrives.
 *
 * A failed load is never kept: the next load starts again. A render that waited on it meets its
 * error once (the error boundary, `staleChunk.ts`); a failure no render waited on (the warmer's)
 * is dropped. Clearing it under a waiting render instead would make the render's retry load
 * again, forever, and never show the error.
 */
export function appLazy<T extends ComponentType<never>>(
  load: () => Promise<{ default: T }>,
): ComponentType<PropsOf<T>>;
// The implementation sees every surface's props as an object it hands on unread.
export function appLazy(
  load: () => Promise<{ default: ComponentType<object> }>,
): ComponentType<object> {
  type Module = { default: ComponentType<object> };
  let current: SurfaceLoad<Module> | undefined;
  let awaited = false;
  const start = (): SurfaceLoad<Module> => {
    const promise: SurfaceLoad<Module> = load();
    current = promise;
    awaited = false;
    void promise.then(
      (module) => {
        Object.assign(promise, { status: "fulfilled", value: module });
      },
      (error: unknown) => {
        Object.assign(promise, { status: "rejected", reason: error });
        if (current === promise && !awaited) current = undefined;
      },
    );
    return promise;
  };
  appChunk(() => current ?? start());
  function AppLazySurface(props: object) {
    const promise = current ?? start();
    // This render meets the failure; the next one loads again.
    if (promise.status === "rejected") current = undefined;
    else if (promise.status !== "fulfilled") awaited = true;
    return createElement(use(promise).default, props);
  }
  return AppLazySurface;
}

interface ChunkWarmerHost {
  /** The loaders declared so far; read again after each load, which may declare more. */
  readonly loaders: () => Iterable<Load>;
  /** Runs `then` in the page's next idle slice. */
  readonly idle: (then: () => void) => void;
}

/**
 * Loads every declared loader once, one per idle slice, until none is left unloaded. A load that
 * fails is not retried here: the surface's own use meets it (`staleChunk.ts`).
 */
function makeChunkWarmer(host: ChunkWarmerHost) {
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
  return { warm };
}

/** How long the page settles before its surfaces are warmed. */
const SETTLE_MS = 4_000;

/**
 * Warms the declared surfaces in this page. Started once, after the page's first seconds; a
 * surface declared later (opening a conversation declares its panels) starts another pass.
 */
export function warmAppChunksAfterSettling(): void {
  const idle = (then: () => void) => {
    if (typeof window.requestIdleCallback === "function")
      window.requestIdleCallback(then, { timeout: 2_000 });
    else window.setTimeout(then, 50);
  };
  const warmer = makeChunkWarmer({
    loaders: () => registered,
    idle,
  });
  window.setTimeout(() => {
    listeners.add(warmer.warm);
    warmer.warm();
  }, SETTLE_MS);
}
