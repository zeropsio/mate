// @effect-diagnostics nodeBuiltinImport:off -- observe the browser's fake-platform wire traffic.
import { WebSocket } from "ws";
import * as NodeEvents from "node:events";
import type { ZeropsFake } from "../zerops.ts";
import { settled } from "./activity.ts";
import { deadline, serve } from "../../harness/http.ts";

export async function observeBrowserBudget(zerops: ZeropsFake) {
  const events = new NodeEvents.EventEmitter();
  let pending = 0;
  let registrations = 0;
  const handle = zerops.handle;
  const activity = () => events.emit("activity");
  zerops.events.on("change", activity);
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
    close: async () => {
      zerops.events.off("change", activity);
      await server.close();
    },
    settled: async () => {
      const registrations = () =>
        [...zerops.subscriptions.values()].filter((entry) => isBrowser(entry.apiToken));
      await settled(
        events,
        () =>
          pending === 0 &&
          registrations().every((entry) => entry.socket?.readyState === WebSocket.OPEN),
        "browser Zerops responses and subscription receivers ready",
      );
      const sockets = new Set(registrations().map((entry) => entry.socket!));
      await Promise.all(
        [...sockets].map(async (socket) => {
          let pong = () => {};
          try {
            await deadline(
              new Promise<void>((resolve, reject) => {
                pong = resolve;
                socket.once("pong", pong);
                socket.ping(undefined, undefined, (error) => {
                  if (error) reject(error);
                });
              }),
              "browser Zerops websocket delivery barrier (pong)",
            );
          } finally {
            socket.off("pong", pong);
          }
        }),
      );
    },
    projectsReady: async (projectIds: string[]) => {
      await settled(
        events,
        () =>
          projectIds.every((projectId) =>
            ["service-stack", "user-data"].every((kind) => {
              const services = zerops
                .rows("service-stack")
                .filter((row) => row.projectId === projectId);
              const rows =
                kind === "service-stack"
                  ? services
                  : zerops
                      .rows(kind)
                      .filter((row) =>
                        services.some((service) => service.id === row.serviceStackId),
                      );
              return rows.every((row) =>
                [...zerops.subscriptions.values()].some(
                  (entry) =>
                    isBrowser(entry.apiToken) &&
                    entry.kind === kind &&
                    entry.socket?.readyState === WebSocket.OPEN &&
                    entry.members.has(row.id),
                ),
              );
            }),
          ),
        `browser startup service/variable coverage for projects: ${projectIds.join(", ")}`,
      );
    },
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
