/**
 * The socket and timer shapes a platform push connection is built from —
 * split out of `platformWatch.ts` because that module's own runtime
 * (`openPlatformWatch`) has no surviving caller outside its own tests, while
 * these two interfaces are still the type contract `restAdapter.ts` and both
 * `ZeropsDataProvider.tsx` files (web, mobile) build their socket factories
 * against.
 */

/**
 * The shape a real `WebSocket` already satisfies (assignable handlers, not
 * `addEventListener`), so `makeSocket: (url) => new WebSocket(url)` works
 * unmodified in the browser; tests inject a fake.
 */
export interface PlatformWatchSocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { readonly data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface PlatformWatchTimers {
  readonly setTimer: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}
