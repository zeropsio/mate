/** Host-independent browser transport construction. Hosts supply targets and cookie policy. */
import * as Layer from "effect/Layer";
import { FetchHttpClient } from "effect/http";
import * as Socket from "effect/socket/Socket";
import { remoteHttpClientLayer } from "../../rpc/http.ts";
import { makeDescriptorShare } from "../../zerops/descriptorShare.ts";
import type { ExchangeClock } from "../../zerops/environments/exchange.ts";

/** Resolve at call time so session mocks and browser fetch instrumentation share the same port. */
export const browserTransportFetch: typeof globalThis.fetch = (input, init) =>
  // @effect-diagnostics-next-line globalFetch:off -- native fetch port for the Effect FetchHttpClient and account door protocols.
  globalThis.fetch(input, init);

export const browserHttpClientLayer = remoteHttpClientLayer(browserTransportFetch);
export const browserWebSocketLayer = Socket.layerWebSocketConstructorGlobal;

export function browserPrimaryHttpLayer(credentials: NonNullable<RequestInit["credentials"]>) {
  return Layer.merge(
    browserHttpClientLayer,
    Layer.succeed(FetchHttpClient.RequestInit, { credentials }),
  );
}

export function makeBrowserMateDescriptors(clock: ExchangeClock) {
  return makeDescriptorShare({ clock, fetch: browserTransportFetch });
}
