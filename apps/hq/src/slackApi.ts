/**
 * What HQ asks of Slack's Web API with the organization's bot token (`slack.ts`): who the token is
 * (`auth.test`), a channel (`conversations.info`), a user and their email (`users.info`), a
 * message's link (`chat.getPermalink`), a message in a thread posted and edited
 * (`chat.postMessage`, `chat.update`), a reaction (`reactions.add`).
 *
 * Every call is a form-encoded `POST`, as each of these methods takes one; it waits at most 10 s
 * and reads at most 1 MiB of its answer. Slack says no in the body (`ok: false`, `error`), which is
 * answered as such; one that cannot be reached or read is `SlackUnreachable`. Never the token in
 * an answer, an error or a log.
 *
 * @module slackApi
 */
import * as ByteSize from "effect/ByteSize";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";

/** Slack's own Web API. */
export const SLACK_API = "https://slack.com/api";

/** Slack could not be reached, or answered what HQ cannot read. */
export class SlackUnreachable extends Schema.TaggedError<SlackUnreachable>()("SlackUnreachable", {
  method: Schema.String,
}) {}

/** What Slack answered: the value HQ reads of it, or its error code (`invalid_auth`, …). */
export type SlackAnswer<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: string };

export interface SlackIdentity {
  /** The workspace's name and id. */
  readonly team: string;
  readonly teamId: string;
  /** The bot's own user. */
  readonly userId: string;
}

export interface SlackUser {
  /** Their email, only once Slack confirmed it is theirs. */
  readonly email: string | null;
  /** As people see them: the display name, else the real name. */
  readonly name: string | null;
  readonly bot: boolean;
  /** Deactivated, or of a workspace that shares only a channel with this one (Slack Connect). */
  readonly away: boolean;
  /** A guest of the workspace, of some channels or of one. */
  readonly guest: boolean;
  /** The workspaces the user belongs to. */
  readonly teams: ReadonlyArray<string>;
}

type Call<A> = Effect.Effect<SlackAnswer<A>, SlackUnreachable>;

export class SlackApi extends Context.Service<
  SlackApi,
  {
    readonly identity: (token: Redacted.Redacted) => Call<SlackIdentity>;
    readonly channel: (
      token: Redacted.Redacted,
      channel: string,
    ) => Call<{ readonly name: string; readonly member: boolean }>;
    readonly user: (token: Redacted.Redacted, user: string) => Call<SlackUser>;
    readonly permalink: (token: Redacted.Redacted, channel: string, ts: string) => Call<string>;
    /** A message in the thread of `threadTs`; its own ts. */
    readonly post: (
      token: Redacted.Redacted,
      message: { readonly channel: string; readonly threadTs: string; readonly text: string },
    ) => Call<string>;
    readonly update: (
      token: Redacted.Redacted,
      message: { readonly channel: string; readonly ts: string; readonly text: string },
    ) => Call<void>;
    readonly react: (
      token: Redacted.Redacted,
      reaction: { readonly channel: string; readonly ts: string; readonly name: string },
    ) => Call<void>;
  }
>()("@t3tools/hq/slackApi") {}

const Refusal = Schema.Struct({ ok: Schema.Literal(false), error: Schema.String });
const decodeRefusal = Schema.decodeUnknownOption(Refusal);

const answers = {
  identity: Schema.Struct({ team: Schema.String, team_id: Schema.String, user_id: Schema.String }),
  channel: Schema.Struct({
    channel: Schema.Struct({ name: Schema.String, is_member: Schema.optionalKey(Schema.Boolean) }),
  }),
  user: Schema.Struct({
    user: Schema.Struct({
      name: Schema.optionalKey(Schema.String),
      real_name: Schema.optionalKey(Schema.String),
      team_id: Schema.optionalKey(Schema.String),
      is_bot: Schema.optionalKey(Schema.Boolean),
      is_email_confirmed: Schema.optionalKey(Schema.Boolean),
      is_stranger: Schema.optionalKey(Schema.Boolean),
      deleted: Schema.optionalKey(Schema.Boolean),
      is_restricted: Schema.optionalKey(Schema.Boolean),
      is_ultra_restricted: Schema.optionalKey(Schema.Boolean),
      enterprise_user: Schema.optionalKey(
        Schema.Struct({ teams: Schema.optionalKey(Schema.Array(Schema.String)) }),
      ),
      profile: Schema.optionalKey(
        Schema.Struct({
          team: Schema.optionalKey(Schema.String),
          email: Schema.optionalKey(Schema.String),
          display_name: Schema.optionalKey(Schema.String),
          real_name: Schema.optionalKey(Schema.String),
        }),
      ),
    }),
  }),
  permalink: Schema.Struct({ permalink: Schema.String }),
  posted: Schema.Struct({ ts: Schema.String }),
  done: Schema.Struct({ ok: Schema.Literal(true) }),
} as const;

/** The first of `names` that says something. */
const firstNamed = (...names: ReadonlyArray<string | undefined>) =>
  names.map((name) => name?.trim() ?? "").find((name) => name !== "") ?? null;

/** Over HTTP; `api` replaces Slack's Web API address (the tests' fake). */
export const slackApiLayer = (api: string = SLACK_API) =>
  Layer.effect(
    SlackApi,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;

      /** `method` asked with `params`; what HQ reads of its answer with `schema`. */
      const call = <A, I>(
        method: string,
        token: Redacted.Redacted,
        params: Record<string, string>,
        schema: Schema.Codec<I, unknown>,
        read: (answer: I) => A,
      ): Call<A> =>
        Effect.scoped(
          Effect.gen(function* () {
            const response = yield* client.execute(
              HttpClientRequest.post(`${api}/${method}`).pipe(
                HttpClientRequest.bearerToken(token),
                HttpClientRequest.bodyUrlParams(params),
              ),
            );
            return yield* response.json;
          }),
        ).pipe(
          Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.mebibytes(1)),
          Effect.timeout(Duration.seconds(10)),
          Effect.mapError(() => new SlackUnreachable({ method })),
          Effect.flatMap((body): Call<A> => {
            const refused = decodeRefusal(body);
            if (Option.isSome(refused))
              return Effect.succeed({ ok: false, error: refused.value.error });
            const read_ = Schema.decodeUnknownOption(schema)(body);
            return Option.isSome(read_)
              ? Effect.succeed({ ok: true, value: read(read_.value) })
              : Effect.fail(new SlackUnreachable({ method }));
          }),
        );

      return SlackApi.of({
        identity: (token) =>
          call("auth.test", token, {}, answers.identity, (answer) => ({
            team: answer.team,
            teamId: answer.team_id,
            userId: answer.user_id,
          })),
        channel: (token, channel) =>
          call("conversations.info", token, { channel }, answers.channel, (answer) => ({
            name: answer.channel.name,
            member: answer.channel.is_member === true,
          })),
        user: (token, user) =>
          call("users.info", token, { user }, answers.user, ({ user: found }) => ({
            email: found.is_email_confirmed === true ? firstNamed(found.profile?.email) : null,
            name: firstNamed(
              found.profile?.display_name,
              found.profile?.real_name,
              found.real_name,
              found.name,
            ),
            bot: found.is_bot === true,
            away: found.deleted === true || found.is_stranger === true,
            guest: found.is_restricted === true || found.is_ultra_restricted === true,
            teams: [
              ...new Set(
                [
                  found.team_id,
                  found.profile?.team,
                  ...(found.enterprise_user?.teams ?? []),
                ].filter((team): team is string => team !== undefined && team !== ""),
              ),
            ],
          })),
        permalink: (token, channel, ts) =>
          call(
            "chat.getPermalink",
            token,
            { channel, message_ts: ts },
            answers.permalink,
            (answer) => answer.permalink,
          ),
        post: (token, message) =>
          call(
            "chat.postMessage",
            token,
            { channel: message.channel, thread_ts: message.threadTs, text: message.text },
            answers.posted,
            (answer) => answer.ts,
          ),
        update: (token, message) =>
          call(
            "chat.update",
            token,
            { channel: message.channel, ts: message.ts, text: message.text },
            answers.done,
            () => undefined,
          ),
        react: (token, reaction) =>
          call(
            "reactions.add",
            token,
            { channel: reaction.channel, timestamp: reaction.ts, name: reaction.name },
            answers.done,
            () => undefined,
          ),
      });
    }),
  );
