/** The single account Zerops transport's socket port; shared by web and mobile. */
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
