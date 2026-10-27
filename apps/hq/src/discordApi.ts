/**
 * What HQ asks of Discord's REST API (`discord.ts`), with the organization's bot token or an
 * interaction's own token: the application the token belongs to, the `/mate` command registered,
 * a channel and its server read, an interaction's answer edited, a thread opened on a message, a
 * message posted or edited. Each call waits at most 10 s and reads at most 1 MiB of its answer, as
 * `githubIssues.ts`; an answer is its status, Discord's error code where it gave one, and what HQ
 * reads of it — never a token. Every message HQ posts mentions nobody: what people wrote may ask
 * for `@everyone`, and HQ never pings for them.
 *
 * @module discordApi
 */
import * as ByteSize from "effect/ByteSize";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";

import { HostUnreachable } from "./gitTransport.ts";

/** Discord's own API, version 10. */
export const DISCORD_API = "https://discord.com/api/v10";

/** An answer: its status, Discord's error code (`10003` unknown channel…), and what HQ read of it. */
export interface DiscordReply<A> {
  readonly status: number;
  readonly code: number | undefined;
  readonly value: A | undefined;
}

const Application = Schema.Struct({ id: Schema.String, verify_key: Schema.String });
const Channel = Schema.Struct({
  id: Schema.String,
  type: Schema.Number,
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  guild_id: Schema.optionalKey(Schema.String),
});
const Guild = Schema.Struct({ id: Schema.String, name: Schema.String });
const Message = Schema.Struct({ id: Schema.String, channel_id: Schema.String });
const Thread = Schema.Struct({ id: Schema.String });
const ErrorBody = Schema.Struct({ code: Schema.Number });

const reading = <A>(schema: Schema.Codec<A, unknown>) =>
  Schema.decodeUnknownOption(Schema.fromJsonString(schema));
const readError = reading(ErrorBody);

/** No mention in what HQ posts pings anyone. */
const NO_MENTIONS = { parse: [] };

export class DiscordApi extends Context.Service<
  DiscordApi,
  {
    /** The application the bot token belongs to: its id and public key. */
    readonly application: (
      token: Redacted.Redacted,
    ) => Effect.Effect<DiscordReply<typeof Application.Type>, HostUnreachable>;
    /** The application's global commands, all replaced by `commands`; the status. */
    readonly putCommands: (
      token: Redacted.Redacted,
      applicationId: string,
      commands: ReadonlyArray<unknown>,
    ) => Effect.Effect<number, HostUnreachable>;
    readonly channel: (
      token: Redacted.Redacted,
      channelId: string,
    ) => Effect.Effect<DiscordReply<typeof Channel.Type>, HostUnreachable>;
    readonly guild: (
      token: Redacted.Redacted,
      guildId: string,
    ) => Effect.Effect<DiscordReply<typeof Guild.Type>, HostUnreachable>;
    /** An interaction's answer, given as deferred, said: the message it became. */
    readonly editOriginal: (
      applicationId: string,
      interactionToken: Redacted.Redacted,
      content: string,
    ) => Effect.Effect<DiscordReply<typeof Message.Type>, HostUnreachable>;
    /** A public thread opened on the message `messageId` of `channelId`. */
    readonly startThread: (
      token: Redacted.Redacted,
      channelId: string,
      messageId: string,
      name: string,
    ) => Effect.Effect<DiscordReply<typeof Thread.Type>, HostUnreachable>;
    readonly post: (
      token: Redacted.Redacted,
      channelId: string,
      content: string,
    ) => Effect.Effect<DiscordReply<typeof Message.Type>, HostUnreachable>;
    readonly edit: (
      token: Redacted.Redacted,
      channelId: string,
      messageId: string,
      content: string,
    ) => Effect.Effect<DiscordReply<typeof Message.Type>, HostUnreachable>;
  }
>()("@t3tools/hq/discordApi") {}

/** Over HTTP; `api` replaces Discord's API address (the tests' fake). */
export const discordApiLayer = (api: string = DISCORD_API) =>
  Layer.effect(
    DiscordApi,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const send = <A>(
        method: "GET" | "POST" | "PUT" | "PATCH",
        path: string,
        bot: Redacted.Redacted | null,
        decode: (text: string) => Option.Option<A>,
        body?: unknown,
      ) =>
        Effect.scoped(
          Effect.gen(function* () {
            const url = `${api}${path}`;
            const made =
              method === "GET"
                ? HttpClientRequest.get(url)
                : method === "POST"
                  ? HttpClientRequest.post(url)
                  : method === "PUT"
                    ? HttpClientRequest.put(url)
                    : HttpClientRequest.patch(url);
            const request = made.pipe(
              HttpClientRequest.setHeader("user-agent", "DiscordBot (https://zerops.io, 1) Mate"),
              (request) =>
                bot === null
                  ? request
                  : HttpClientRequest.setHeader(
                      request,
                      "authorization",
                      `Bot ${Redacted.value(bot)}`,
                    ),
            );
            const response = yield* client.execute(
              body === undefined ? request : HttpClientRequest.bodyJsonUnsafe(request, body),
            );
            const text = yield* response.text;
            const ok = response.status >= 200 && response.status < 300;
            return {
              status: response.status,
              code: ok ? undefined : Option.getOrUndefined(readError(text))?.code,
              value: ok ? Option.getOrUndefined(decode(text)) : undefined,
            } satisfies DiscordReply<A>;
          }).pipe(
            Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.mebibytes(1)),
            Effect.timeout(Duration.seconds(10)),
            // Whatever went wrong, nothing of the request (its token) goes further.
            Effect.mapError(() => new HostUnreachable({})),
          ),
        );
      const id = (part: string) => encodeURIComponent(part);
      const message = (content: string) => ({ content, allowed_mentions: NO_MENTIONS });
      return DiscordApi.of({
        application: (token) => send("GET", "/applications/@me", token, reading(Application)),
        putCommands: (token, applicationId, commands) =>
          Effect.map(
            send(
              "PUT",
              `/applications/${id(applicationId)}/commands`,
              token,
              () => Option.some(true),
              commands,
            ),
            (reply) => reply.status,
          ),
        channel: (token, channelId) =>
          send("GET", `/channels/${id(channelId)}`, token, reading(Channel)),
        guild: (token, guildId) => send("GET", `/guilds/${id(guildId)}`, token, reading(Guild)),
        editOriginal: (applicationId, interactionToken, content) =>
          send(
            "PATCH",
            `/webhooks/${id(applicationId)}/${id(Redacted.value(interactionToken))}/messages/@original`,
            null,
            reading(Message),
            message(content),
          ),
        startThread: (token, channelId, messageId, name) =>
          send(
            "POST",
            `/channels/${id(channelId)}/messages/${id(messageId)}/threads`,
            token,
            reading(Thread),
            // A week of quiet before Discord archives it: a task may wait days for an answer.
            { name, auto_archive_duration: 10080 },
          ),
        post: (token, channelId, content) =>
          send(
            "POST",
            `/channels/${id(channelId)}/messages`,
            token,
            reading(Message),
            message(content),
          ),
        edit: (token, channelId, messageId, content) =>
          send(
            "PATCH",
            `/channels/${id(channelId)}/messages/${id(messageId)}`,
            token,
            reading(Message),
            message(content),
          ),
      });
    }),
  );
