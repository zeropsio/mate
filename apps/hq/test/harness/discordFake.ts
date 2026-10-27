// @effect-diagnostics nodeBuiltinImport:off -- Discord's REST API, as HQ reaches it: over HTTP.
/**
 * Discord's REST API in miniature for the tests: one application with its bot token, its servers
 * and channels; what HQ asked of it, and how it answers — commands registered, an interaction's
 * answer edited into a message, a thread opened on it, messages posted and edited, a thread the
 * test deleted answering `404` with Discord's `10003`.
 *
 * @module test/harness/discordFake
 */
import * as NodeHttp from "node:http";

import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

export interface DiscordRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

export interface FakeDiscordChannel {
  readonly id: string;
  readonly name: string;
  readonly type: number;
  readonly guildId: string;
}

export const discordFake = (application: {
  readonly id: string;
  readonly publicKey: string;
  readonly botToken: string;
}) =>
  Effect.gen(function* () {
    const state = {
      seen: [] as Array<DiscordRequest>,
      guilds: new Map<string, string>(),
      channels: new Map<string, FakeDiscordChannel>(),
      /** Threads the test deleted: every call on them answers `404` `10003`. */
      deleted: new Set<string>(),
      /** The status the next thread opened answers; 201 with a new id. */
      threadStatus: 201,
      next: 100,
    };
    const send = (response: NodeHttp.ServerResponse, status: number, body?: unknown) => {
      response.setHeader("content-type", "application/json");
      response.writeHead(status);
      response.end(body === undefined ? "" : JSON.stringify(body));
    };
    const handle = (
      request: NodeHttp.IncomingMessage,
      response: NodeHttp.ServerResponse,
      path: string,
    ) => {
      const method = request.method ?? "";
      const bot = request.headers["authorization"] === `Bot ${application.botToken}`;
      const webhook = /^\/webhooks\/(\d+)\/([^/]+)\/messages\/@original$/u.exec(path);
      if (method === "PATCH" && webhook !== null) {
        state.next += 1;
        return send(response, 200, { id: `9${String(state.next)}`, channel_id: "c" });
      }
      if (!bot) return send(response, 401, { code: 0, message: "401: Unauthorized" });
      if (method === "GET" && path === "/applications/@me")
        return send(response, 200, { id: application.id, verify_key: application.publicKey });
      if (method === "PUT" && path === `/applications/${application.id}/commands`)
        return send(response, 200, []);
      const guild = /^\/guilds\/(\d+)$/u.exec(path);
      if (method === "GET" && guild !== null) {
        const name = state.guilds.get(guild[1]!);
        return name === undefined
          ? send(response, 404, { code: 10004 })
          : send(response, 200, { id: guild[1], name });
      }
      const channel = /^\/channels\/(\d+)(\/.*)?$/u.exec(path);
      if (channel === null) return send(response, 404, { code: 0 });
      const [, channelId, rest = ""] = channel;
      if (state.deleted.has(channelId!)) return send(response, 404, { code: 10003 });
      if (method === "GET" && rest === "") {
        const found = state.channels.get(channelId!);
        return found === undefined
          ? send(response, 404, { code: 10003 })
          : send(response, 200, {
              id: found.id,
              name: found.name,
              type: found.type,
              guild_id: found.guildId,
            });
      }
      if (method === "POST" && /^\/messages\/\d+\/threads$/u.test(rest)) {
        state.next += 1;
        return state.threadStatus === 201
          ? send(response, 201, { id: `7${String(state.next)}`, type: 11, parent_id: channelId })
          : send(response, state.threadStatus, { code: 50013 });
      }
      if (method === "POST" && rest === "/messages") {
        state.next += 1;
        return send(response, 200, { id: `8${String(state.next)}`, channel_id: channelId });
      }
      const edited = /^\/messages\/(\d+)$/u.exec(rest);
      if (method === "PATCH" && edited !== null)
        return send(response, 200, { id: edited[1], channel_id: channelId });
      return send(response, 404, { code: 0 });
    };
    const { url } = yield* Effect.acquireRelease(
      Effect.promise(
        () =>
          new Promise<{ server: NodeHttp.Server; url: string }>((resolve) => {
            const server = NodeHttp.createServer((request, response) => {
              let text = "";
              request.on("data", (chunk: Buffer) => {
                text += chunk.toString("utf8");
              });
              request.on("end", () => {
                const path = request.url ?? "";
                state.seen.push({
                  method: request.method ?? "",
                  path,
                  authorization: request.headers["authorization"],
                  body: text === "" ? undefined : JSON.parse(text),
                });
                handle(request, response, path);
              });
            }).listen(0, "127.0.0.1", () => {
              const address = server.address();
              if (address && typeof address !== "string")
                resolve({ server, url: `http://127.0.0.1:${address.port}` });
            });
          }),
      ),
      ({ server }) =>
        Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
    /** What HQ asked of Discord once `matches` holds of it; fails after ten seconds. */
    const seenWhere = (what: string, matches: (seen: ReadonlyArray<DiscordRequest>) => boolean) =>
      Effect.suspend(() =>
        matches(state.seen) ? Effect.succeed([...state.seen]) : Effect.fail(what),
      ).pipe(
        Effect.retry(Schedule.spaced(Duration.millis(20))),
        Effect.timeout(Duration.seconds(10)),
        Effect.orDie,
      );
    return { url, state, seenWhere };
  });
