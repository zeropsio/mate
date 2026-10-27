// @effect-diagnostics nodeBuiltinImport:off -- observe the browser's fake-platform wire traffic.
import * as NodeEvents from "node:events";
import type { ZeropsFake } from "../zerops.ts";
import { settled } from "./activity.ts";
import { serve } from "../../harness/http.ts";

export async function observeBrowserBudget(zerops: ZeropsFake) {
  const events = new NodeEvents.EventEmitter();
  let pending = 0;
  let registrations = 0;
  const handle = zerops.handle;
  const isBrowser = (credential: string) => credential === "personal" || credential === "anonymous";
  // Core retains the original fake origin; only browser routes use this observed listener.
  const server = await serve(async (request) => {
    const credential = request.headers.authorization?.replace(/^Bearer /u, "") ?? "anonymous";
    if (!isBrowser(credential)) return handle(request);
    pending++;
    if (request.method !== "OPTIONS" && request.body.wsOutputType) registrations++;
    events.emit("activity");
    try {
      return await handle(request);
    } finally {
      pending--;
      events.emit("activity");
    }
  }, zerops.socket);
  return {
    ...server,
    settled: () => settled(events, () => pending === 0, "browser Zerops traffic quiet for 1 s"),
    sample() {
      let requests = 0;
      for (const [credential, counts] of zerops.requestsByCredential) {
        if (!isBrowser(credential)) continue;
        for (const [key, count] of counts) if (!key.startsWith("OPTIONS ")) requests += count;
      }
      return { requests, registrations, otherRequests: requests - registrations };
    },
    /** The browser's requests whose `METHOD path` matches, CORS preflights included. */
    matching(pattern: RegExp) {
      let count = 0;
      for (const [credential, counts] of zerops.requestsByCredential) {
        if (!isBrowser(credential)) continue;
        for (const [key, spent] of counts) if (pattern.test(key)) count += spent;
      }
      return count;
    },
  };
}
