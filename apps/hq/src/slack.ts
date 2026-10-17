// @effect-diagnostics nodeBuiltinImport:off -- Slack signs its requests with HMAC-SHA256; an events address is the system's randomness.
/**
 * Tasks from Slack (`@t3tools/shared/hqIntake`): the organization connects a Slack app made from
 * the manifest HQ gives, an application takes tasks from one channel, and `@Mate <ask>` there
 * starts a task whose thread is its conversation.
 *
 * - The connection (`hq_slack`), by an owner or admin of the organization (`keep_ai_key`): the bot
 *   token, checked with Slack (`auth.test`, which names the workspace), and the signing secret,
 *   both sealed (`deployKeys.ts`) and never answered back. Slack sends its events to
 *   `https://<HQ's own domain>/api/intake/slack/<public id>`, the address the manifest names, made
 *   at the first look and kept across connections. Connected to another workspace, the channels
 *   and threads of the one it leaves go.
 * - An application's channel (`hq_slack_channel`), by a structure writer (`keep_intake`): one Slack
 *   says exists and the bot is in.
 * - An event is taken only once its `X-Slack-Signature` holds — `v0=` and the HMAC-SHA256 of
 *   `v0:<timestamp>:<body>` under the signing secret, compared in constant time, its timestamp at
 *   most five minutes off — before a byte of it is parsed; Slack's URL check is answered too,
 *   and before the app is connected only it, so an app made from the manifest checks its address
 *   at once. Every event is answered at once and worked after, as Slack waits three seconds.
 * - `@Mate <ask>` in a mapped channel, by a member of the organization (the Slack user's email,
 *   a member's verified one): a task for the channel's application (`TaskIntake.enqueue`) keyed by
 *   its thread (`slack:<team>/<channel>/<thread ts>`). Anyone else is told only members can ask.
 *   A reply or a mention in a thread whose task lives, by a member, is told to it
 *   (`TaskIntake.message`) and marked 👀; the bot's own words and other bots' never are. The
 *   ask deleted stops its task (`TaskIntake.stop`); anyone else's message deleted, nothing.
 * - Its channel (`TaskSourceChannels`): 👀 on the ask, and one status message in the thread, posted
 *   for a task the first time and edited after; a question is put to the person who asked.
 *
 * @module slack
 */
import * as NodeCrypto from "node:crypto";

import type { MateTaskMessage } from "@t3tools/contracts";
import type { HqChannelView, HqSlackView } from "@t3tools/shared/hqIntake";
import { ZEROPS_ACTIVE_MEMBER_STATUS } from "@t3tools/shared/zeropsRoles";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import { AutomationRefused } from "./automationRefused.ts";
import { DeployKeys } from "./deployKeys.ts";
import { Leader, type NotLeader } from "./leader.ts";
import { can } from "./permissions.ts";
import { Roles, confirmingRefusal } from "./roles.ts";
import { SlackApi, type SlackAnswer, type SlackUnreachable } from "./slackApi.ts";
import { REPLIES, askOf, questionText, statusText, titleOf } from "./slackText.ts";
import { TaskIntake, TaskSourceChannels, type TaskOnSource } from "./taskSources.ts";
import type { ZeropsError, ZeropsMember } from "./zerops/api.ts";

/** Where Slack sends the organization's events, below HQ's own address. */
export const SLACK_EVENTS_PATH = "/api/intake/slack";

/** What the bot may do: hear mentions and its channels' threads, answer there, know who asked. */
export const SLACK_BOT_SCOPES = [
  "app_mentions:read",
  "chat:write",
  "channels:history",
  "groups:history",
  "reactions:write",
  "users:read",
  "users:read.email",
  "channels:read",
  "groups:read",
] as const;

/** What Slack tells HQ of: a mention, and messages in the public and private channels it is in. */
export const SLACK_BOT_EVENTS = ["app_mention", "message.channels", "message.groups"] as const;

/** How far a request's timestamp may be from HQ's clock: Slack's own advice, against replays. */
const MAX_AGE_SECONDS = 5 * 60;

/** A bot token as Slack makes one, and a signing secret: printable, no spaces. */
const BOT_TOKEN = /^xoxb-[\x21-\x7e]{1,1000}$/u;
const SIGNING_SECRET = /^[\x21-\x7e]{1,256}$/u;
/** A channel's id: public `C…`, private `G…` (older) or `C…`. */
const CHANNEL_ID = /^[CG][A-Z0-9]{2,40}$/u;

/** The reaction that says HQ heard an ask or a reply. */
const HEARD = "eyes";

/**
 * Whether `signature` (`v0=<hex>`) is Slack's for `body` sent at `timestamp` (seconds), under
 * `secret`, and `timestamp` within five minutes of `nowMs`.
 */
export const slackSignatureHolds = (
  secret: Redacted.Redacted,
  timestamp: string | undefined,
  body: Uint8Array,
  signature: string | undefined,
  nowMs: number,
) => {
  if (timestamp === undefined || !/^\d{1,12}$/u.test(timestamp)) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > MAX_AGE_SECONDS) return false;
  const presented = /^v0=([0-9a-f]{64})$/u.exec(signature ?? "")?.[1];
  if (presented === undefined) return false;
  const expected = NodeCrypto.createHmac("sha256", Redacted.value(secret))
    .update(`v0:${timestamp}:`)
    .update(body)
    .digest();
  return NodeCrypto.timingSafeEqual(expected, Buffer.from(presented, "hex"));
};

/** The Slack app's manifest, its events sent to `eventsUrl`: what an admin makes the app from. */
export const slackManifest = (eventsUrl: string) => ({
  display_information: {
    name: "Mate",
    description: "Hands the work you ask for to your organization's automated Mates.",
  },
  features: { bot_user: { display_name: "Mate", always_online: true } },
  oauth_config: { scopes: { bot: [...SLACK_BOT_SCOPES] } },
  settings: {
    event_subscriptions: { request_url: eventsUrl, bot_events: [...SLACK_BOT_EVENTS] },
    org_deploy_enabled: false,
    socket_mode_enabled: false,
    token_rotation_enabled: false,
  },
});

/** The work item of a thread: one live task per key. */
export const slackSourceKey = (team: string, channel: string, threadTs: string) =>
  `slack:${team}/${channel}/${threadTs}`;

/** An event as Slack posts it: its headers HQ reads, and its bytes as they came. */
export interface SlackDelivery {
  readonly timestamp: string | undefined;
  readonly signature: string | undefined;
  readonly body: Uint8Array;
}

/**
 * What became of an event: no connection at that address, its signature refused, one HQ cannot
 * read, Slack's URL check (its `challenge` answered back), or taken — to be worked after.
 */
export type SlackReceived =
  | { readonly kind: "unknown" | "refused" | "invalid" | "taken" }
  | { readonly kind: "challenge"; readonly challenge: string };

type SlackError = AutomationRefused | NotLeader | SqlError | ZeropsError;

export class Slack extends Context.Service<
  Slack,
  {
    /** Whether the organization is connected, to which workspace, and where Slack sends events. */
    readonly view: Effect.Effect<HqSlackView, SlackError>;
    readonly manifest: (
      userId: string,
    ) => Effect.Effect<ReturnType<typeof slackManifest>, SlackError>;
    readonly connect: (
      userId: string,
      secrets: { readonly botToken: Redacted.Redacted; readonly signingSecret: Redacted.Redacted },
    ) => Effect.Effect<HqSlackView, SlackError>;
    readonly disconnect: (userId: string) => Effect.Effect<void, SlackError>;
    /** The channel the application takes tasks from. */
    readonly channelOf: (
      appId: string,
    ) => Effect.Effect<HqChannelView, AutomationRefused | SqlError>;
    readonly mapChannel: (
      userId: string,
      appId: string,
      channelId: string,
    ) => Effect.Effect<HqChannelView, SlackError>;
    readonly unmapChannel: (userId: string, appId: string) => Effect.Effect<void, SlackError>;
    /** Slack's event to the connection at `publicId`, answered at once and worked after. */
    readonly receive: (
      publicId: string,
      delivery: SlackDelivery,
    ) => Effect.Effect<SlackReceived, SqlError>;
    /** Once every event taken so far is worked. */
    readonly drained: Effect.Effect<void>;
  }
>()("@t3tools/hq/slack") {}

interface SlackRow {
  readonly public_id: string;
  readonly team_id: string | null;
  readonly team_name: string | null;
  readonly bot_user_id: string | null;
  readonly token_sealed: Uint8Array | null;
  readonly secret_sealed: Uint8Array | null;
  readonly key_id: string | null;
}

/** The connection, its secrets opened. */
interface Connection {
  readonly publicId: string;
  readonly teamId: string;
  readonly team: string;
  readonly botUserId: string;
  readonly token: Redacted.Redacted;
  readonly secret: Redacted.Redacted;
}

interface ThreadRow {
  readonly source_key: string;
  readonly channel_id: string;
  readonly thread_ts: string;
  readonly ask_ts: string;
  readonly asker: string;
  readonly task_id: string | null;
  readonly status_ts: string | null;
}

/** What HQ reads of Slack's envelope; the event inside is read on its own. */
const Envelope = Schema.Union([
  Schema.Struct({ type: Schema.Literal("url_verification"), challenge: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("event_callback"),
    team_id: Schema.String,
    event_id: Schema.String,
    event: Schema.Unknown,
  }),
  Schema.Struct({ type: Schema.String }),
]);
const decodeEnvelope = Schema.decodeUnknownOption(Schema.fromJsonString(Envelope));

/** A mention or a message, as far as HQ reads it. */
const SlackEvent = Schema.Struct({
  type: Schema.String,
  subtype: Schema.optionalKey(Schema.String),
  user: Schema.optionalKey(Schema.String),
  bot_id: Schema.optionalKey(Schema.String),
  text: Schema.optionalKey(Schema.String),
  ts: Schema.optionalKey(Schema.String),
  thread_ts: Schema.optionalKey(Schema.String),
  channel: Schema.optionalKey(Schema.String),
  deleted_ts: Schema.optionalKey(Schema.String),
  message: Schema.optionalKey(
    Schema.Struct({
      ts: Schema.optionalKey(Schema.String),
      subtype: Schema.optionalKey(Schema.String),
    }),
  ),
});
type SlackEvent = typeof SlackEvent.Type;
const decodeEvent = Schema.decodeUnknownOption(SlackEvent);

/** The messages a person wrote: plain, a reply also sent to the channel, one with a file. */
const PERSON_SUBTYPES = new Set([undefined, "thread_broadcast", "file_share"]);

/** Who wrote a message, as the gate answers. */
type Asker =
  | { readonly kind: "member"; readonly userId: string; readonly name: string | null }
  | { readonly kind: "bot" | "stranger" | "unchecked" };

const randomId = (bytes: number) => NodeCrypto.randomBytes(bytes).toString("base64url");

export const slackLayer = (options: { readonly hqProjectId: string }) =>
  Layer.effect(
    Slack,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const leader = yield* Leader;
      const roles = yield* Roles;
      const keys = yield* DeployKeys;
      const api = yield* SlackApi;
      const intake = yield* TaskIntake;
      const channels = yield* TaskSourceChannels;
      const work = yield* FiberSet.make();
      // One status message per task: two moves of it never both post one.
      const statusLock = yield* Semaphore.make(1);

      const refuse = (code: AutomationRefused["code"], reason: string) =>
        Effect.fail(new AutomationRefused({ code, reason }));

      /** A write of the organization's connection: by its owner or an admin. */
      const mayConnect = (userId: string) =>
        Effect.gen(function* () {
          const verdict = can(
            { kind: "person", userId },
            "keep_ai_key",
            null,
            yield* roles.forWrite,
          );
          if (!verdict.allow) return yield* refuse("forbidden", verdict.reason);
        });

      /** A write of where an application takes tasks from: by a structure writer. */
      const mayMap = (userId: string, appId: string) =>
        Effect.gen(function* () {
          const verdict = can(
            { kind: "person", userId },
            "keep_intake",
            null,
            yield* roles.forWrite,
          );
          if (!verdict.allow) return yield* refuse("forbidden", verdict.reason);
          const apps = yield* sql`SELECT 1 FROM hq_app WHERE id::text = ${appId}`;
          if (apps.length === 0) return yield* refuse("app_not_found", "app_not_found");
        });

      const rowWhere = (publicId: string | null) =>
        Effect.map(
          publicId === null
            ? sql<SlackRow>`
                SELECT public_id, team_id, team_name, bot_user_id, token_sealed, secret_sealed, key_id
                FROM hq_slack`
            : sql<SlackRow>`
                SELECT public_id, team_id, team_name, bot_user_id, token_sealed, secret_sealed, key_id
                FROM hq_slack WHERE public_id = ${publicId}`,
          (rows) => rows[0],
        );

      /** The organization's row, made at the first look: its events address stays from then on. */
      const ensured = Effect.gen(function* () {
        const found = yield* rowWhere(null);
        if (found !== undefined) return found;
        yield* leader.write(sql`
          INSERT INTO hq_slack (public_id) VALUES (${randomId(24)}) ON CONFLICT (one) DO NOTHING`);
        const made = yield* rowWhere(null);
        if (made === undefined) return yield* refuse("conflict", "slack_unavailable");
        return made;
      });

      const opened = (row: SlackRow | undefined): Connection | undefined => {
        if (
          row === undefined ||
          row.team_id === null ||
          row.team_name === null ||
          row.bot_user_id === null ||
          row.token_sealed === null ||
          row.secret_sealed === null ||
          row.key_id === null
        )
          return undefined;
        const token = keys.openSlack("bot_token", row.public_id, {
          sealed: row.token_sealed,
          keyId: row.key_id,
        });
        const secret = keys.openSlack("signing_secret", row.public_id, {
          sealed: row.secret_sealed,
          keyId: row.key_id,
        });
        if (token === undefined || secret === undefined) return undefined;
        return {
          publicId: row.public_id,
          teamId: row.team_id,
          team: row.team_name,
          botUserId: row.bot_user_id,
          token,
          secret,
        };
      };
      const connection = Effect.map(rowWhere(null), opened);

      /** HQ's own address, as Slack reaches it. */
      const eventsUrl = (publicId: string) =>
        Effect.gen(function* () {
          const zone = (yield* roles.view).projects.find(
            (project) => project.id === options.hqProjectId,
          )?.publicZone;
          if (!zone) return yield* refuse("conflict", "hq_address_unknown");
          return `https://${zone}${SLACK_EVENTS_PATH}/${publicId}`;
        });

      const view = Effect.gen(function* () {
        const row = yield* ensured;
        return {
          connected: opened(row) !== undefined,
          workspace: row.team_name,
          eventsUrl: yield* eventsUrl(row.public_id),
        } satisfies HqSlackView;
      });

      const channelRow = (appId: string) =>
        Effect.map(
          sql<{ readonly channel_id: string; readonly channel_name: string }>`
            SELECT channel_id, channel_name FROM hq_slack_channel WHERE app_id::text = ${appId}`,
          (rows) => rows[0],
        );

      const threadRow = (sourceKey: string) =>
        Effect.map(
          sql<ThreadRow>`
            SELECT source_key, channel_id, thread_ts, ask_ts, asker, task_id, status_ts
            FROM hq_slack_thread WHERE source_key = ${sourceKey}`,
          (rows) => rows[0],
        );

      /** Slack's answer to a call that changes nothing of a task: logged when it said no. */
      const besides = (what: string, call: Effect.Effect<SlackAnswer<unknown>, SlackUnreachable>) =>
        call.pipe(
          Effect.flatMap((answer) =>
            answer.ok || answer.error === "already_reacted"
              ? Effect.void
              : Effect.logInfo("slack refused", { what, error: answer.error }),
          ),
          Effect.catch(() => Effect.logInfo("slack unreachable", { what })),
        );

      const say = (link: Connection, channel: string, threadTs: string, text: string) =>
        besides("reply", api.post(link.token, { channel, threadTs, text }));
      const heard = (link: Connection, channel: string, ts: string) =>
        besides("reaction", api.react(link.token, { channel, ts, name: HEARD }));

      /** Who the Slack user is to the organization: a member by their verified email, or not. */
      const gate = (link: Connection, user: string) =>
        Effect.gen(function* () {
          const answer = yield* api.user(link.token, user);
          if (!answer.ok) return { kind: "unchecked" } as const;
          if (answer.value.bot) return { kind: "bot" } as const;
          // A member's email counts only as Slack confirmed it, on a person of this workspace:
          // never on a deactivated user or a Slack Connect partner's.
          if (answer.value.away || !answer.value.teams.includes(link.teamId))
            return { kind: "stranger" } as const;
          const email = answer.value.email?.toLowerCase();
          if (email === undefined) return { kind: "stranger" } as const;
          const named = (members: ReadonlyArray<ZeropsMember>) =>
            members.find(
              (member) =>
                member.kind === "person" &&
                member.status === ZEROPS_ACTIVE_MEMBER_STATUS &&
                member.email?.trim().toLowerCase() === email,
            );
          // One the view kept does not list may have joined since: read now before saying no.
          const member =
            named((yield* roles.view).members) ??
            named((yield* roles.readSince(yield* Clock.currentTimeMillis)).members);
          return member === undefined
            ? ({ kind: "stranger" } as const)
            : ({ kind: "member", userId: member.userId, name: answer.value.name } as const);
        }).pipe(Effect.orElseSucceed((): Asker => ({ kind: "unchecked" })));

      const messageOf = (
        link: Connection,
        channel: string,
        ts: string,
        author: string | null,
        text: string,
      ): MateTaskMessage => ({
        id: slackSourceKey(link.teamId, channel, ts),
        from: "reply",
        author,
        text,
      });

      /** `@Mate <ask>`: a task for the channel's application, or a follow-up to its thread's. */
      const mentioned = (link: Connection, event: SlackEvent, eventId: string) =>
        Effect.gen(function* () {
          const { user, channel, ts } = event;
          if (user === undefined || channel === undefined || ts === undefined) return;
          if (event.bot_id !== undefined || user === link.botUserId) return;
          const threadTs = event.thread_ts ?? ts;
          const sourceKey = slackSourceKey(link.teamId, channel, threadTs);
          const held = yield* threadRow(sourceKey);
          const [mapped] = yield* sql<{ readonly app_id: string; readonly channel_name: string }>`
            SELECT app_id::text AS app_id, channel_name FROM hq_slack_channel
            WHERE channel_id = ${channel}`;
          if (mapped === undefined && held === undefined)
            return yield* say(link, channel, threadTs, REPLIES.unmapped);
          const asker = yield* gate(link, user);
          if (asker.kind === "bot") return;
          if (asker.kind !== "member")
            return yield* say(
              link,
              channel,
              threadTs,
              asker.kind === "stranger" ? REPLIES.notMember : REPLIES.unchecked,
            );
          const ask = askOf(event.text ?? "", link.botUserId);
          if (ask === "") return yield* say(link, channel, threadTs, REPLIES.empty);
          if (
            held !== undefined &&
            (yield* intake.message(sourceKey, messageOf(link, channel, ts, asker.name, ask)))
          )
            return yield* heard(link, channel, ts);
          if (mapped === undefined) return yield* say(link, channel, threadTs, REPLIES.unmapped);
          const permalink = yield* api.permalink(link.token, channel, threadTs).pipe(
            Effect.map((answer) => (answer.ok ? answer.value : undefined)),
            Effect.catch(() => Effect.undefined),
          );
          // The ask first: the channel's 👀 goes on it as the task is taken in.
          yield* leader.write(sql`
            INSERT INTO hq_slack_thread (source_key, app_id, channel_id, thread_ts, ask_ts, asker)
            VALUES (${sourceKey}, ${mapped.app_id}::uuid, ${channel}, ${threadTs}, ${ts}, ${user})
            ON CONFLICT (source_key) DO UPDATE SET app_id = EXCLUDED.app_id,
              ask_ts = EXCLUDED.ask_ts, asker = EXCLUDED.asker, updated_at = now()`);
          const taken = yield* Effect.exit(
            intake.enqueue({
              appId: mapped.app_id,
              source: {
                kind: "slack-thread",
                workspace: link.team,
                channel: mapped.channel_name,
                url:
                  permalink ??
                  `https://app.slack.com/client/${link.teamId}/${channel}/thread/${channel}-${threadTs}`,
                title: titleOf(ask),
                author: asker.name,
              },
              body: ask,
              sourceKey,
              deliveryId: `slack:${link.teamId}/${eventId}`,
              requestedBy: asker.userId,
            }),
          );
          // HQ could not take it in now; Slack has its answer already, so the person asks again.
          if (Exit.isFailure(taken)) {
            yield* Effect.logWarning("slack ask not taken", {
              sourceKey,
              cause: String(taken.cause),
            });
            return yield* say(link, channel, threadTs, REPLIES.unavailable);
          }
          if (taken.value.kind === "told") yield* heard(link, channel, ts);
        });

      /** A reply in a thread HQ holds: told to its task, when a member wrote it. */
      const replied = (link: Connection, event: SlackEvent) =>
        Effect.gen(function* () {
          const { user, channel, ts, thread_ts: threadTs } = event;
          if (user === undefined || channel === undefined || ts === undefined) return;
          if (threadTs === undefined || threadTs === ts) return;
          if (event.bot_id !== undefined || user === link.botUserId) return;
          if (!PERSON_SUBTYPES.has(event.subtype)) return;
          // The mention's own event carries it.
          if ((event.text ?? "").includes(`<@${link.botUserId}`)) return;
          const sourceKey = slackSourceKey(link.teamId, channel, threadTs);
          if ((yield* threadRow(sourceKey)) === undefined) return;
          const asker = yield* gate(link, user);
          if (asker.kind !== "member") return;
          const text = askOf(event.text ?? "", link.botUserId);
          if (text === "") return;
          if (yield* intake.message(sourceKey, messageOf(link, channel, ts, asker.name, text)))
            yield* heard(link, channel, ts);
        });

      /** A task's ask deleted: its task stops. Anyone else's message deleted stops nothing. */
      const deleted = (channel: string | undefined, ts: string | undefined) =>
        Effect.gen(function* () {
          if (channel === undefined || ts === undefined) return;
          const asks = yield* sql<{ readonly source_key: string }>`
            SELECT source_key FROM hq_slack_thread WHERE channel_id = ${channel} AND ask_ts = ${ts}`;
          for (const { source_key } of asks)
            yield* intake.stop(source_key, "The Slack thread was deleted.");
        });

      const worked = (link: Connection, eventId: string, raw: unknown) =>
        Effect.gen(function* () {
          const read = decodeEvent(raw);
          if (Option.isNone(read)) return;
          const event = read.value;
          if (event.type === "app_mention") return yield* mentioned(link, event, eventId);
          if (event.type !== "message") return;
          if (event.subtype === "message_deleted")
            return yield* deleted(event.channel, event.deleted_ts);
          if (event.subtype === "message_changed" && event.message?.subtype === "tombstone")
            return yield* deleted(event.channel, event.message.ts);
          return yield* replied(link, event);
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("slack event not worked", { eventId, cause: String(cause) }),
          ),
        );

      /** The thread of a task, with the connection to speak there; nothing without either. */
      const inThread = (
        task: TaskOnSource,
        speak: (
          link: Connection,
          thread: ThreadRow,
        ) => Effect.Effect<void, SlackUnreachable | NotLeader | SqlError>,
      ) =>
        Effect.gen(function* () {
          const link = yield* connection;
          const thread = yield* threadRow(task.sourceKey);
          if (link === undefined || thread === undefined) return;
          yield* speak(link, thread);
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("slack thread not told", {
              taskId: task.taskId,
              cause: String(cause),
            }),
          ),
        );

      yield* channels.register({
        kind: "slack-thread",
        acknowledge: (task) =>
          inThread(task, (link, thread) => heard(link, thread.channel_id, thread.ask_ts)),
        status: (task, status) =>
          inThread(task, (link, thread) =>
            Effect.gen(function* () {
              const text = statusText(status);
              const edited =
                thread.task_id === task.taskId && thread.status_ts !== null
                  ? yield* api.update(link.token, {
                      channel: thread.channel_id,
                      ts: thread.status_ts,
                      text,
                    })
                  : undefined;
              if (edited?.ok !== true) {
                const posted = yield* api.post(link.token, {
                  channel: thread.channel_id,
                  threadTs: thread.thread_ts,
                  text,
                });
                if (!posted.ok)
                  return yield* Effect.logInfo("slack refused", {
                    what: "status",
                    error: posted.error,
                  });
                yield* leader.write(sql`
                  UPDATE hq_slack_thread SET task_id = ${task.taskId}, status_ts = ${posted.value},
                    updated_at = now()
                  WHERE source_key = ${thread.source_key}`);
              }
              if (status.kind === "waiting")
                yield* say(
                  link,
                  thread.channel_id,
                  thread.thread_ts,
                  questionText(thread.asker, status.mate, status.question),
                );
            }).pipe(statusLock.withPermits(1)),
          ),
      });

      return Slack.of({
        view,
        drained: FiberSet.awaitEmpty(work),
        manifest: (userId) =>
          confirmingRefusal(
            Effect.gen(function* () {
              yield* mayConnect(userId);
              return slackManifest(yield* eventsUrl((yield* ensured).public_id));
            }),
          ),
        connect: (userId, secrets) =>
          confirmingRefusal(
            Effect.gen(function* () {
              yield* mayConnect(userId);
              if (!BOT_TOKEN.test(Redacted.value(secrets.botToken)))
                return yield* refuse("invalid", "bot_token");
              if (!SIGNING_SECRET.test(Redacted.value(secrets.signingSecret)))
                return yield* refuse("invalid", "signing_secret");
              const identity = yield* api
                .identity(secrets.botToken)
                .pipe(Effect.catch(() => refuse("conflict", "slack_unreachable")));
              if (!identity.ok) return yield* refuse("invalid", "bot_token_refused");
              const row = yield* ensured;
              const token = keys.sealSlack("bot_token", row.public_id, secrets.botToken);
              const secret = keys.sealSlack("signing_secret", row.public_id, secrets.signingSecret);
              if (token === undefined || secret === undefined)
                return yield* refuse("conflict", "no_key_secret");
              const { team, teamId, userId: botUserId } = identity.value;
              yield* leader.write(
                Effect.gen(function* () {
                  // Another workspace's channels and threads are none of this one's.
                  if (row.team_id !== null && row.team_id !== teamId) {
                    yield* sql`DELETE FROM hq_slack_channel`;
                    yield* sql`DELETE FROM hq_slack_thread`;
                  }
                  yield* sql`
                    UPDATE hq_slack SET team_id = ${teamId}, team_name = ${team},
                      bot_user_id = ${botUserId}, token_sealed = ${token.sealed},
                      secret_sealed = ${secret.sealed}, key_id = ${token.keyId},
                      connected_by = ${userId}, connected_at = now()
                    WHERE public_id = ${row.public_id}`;
                }),
              );
              return {
                connected: true,
                workspace: team,
                eventsUrl: yield* eventsUrl(row.public_id),
              } satisfies HqSlackView;
            }),
          ),
        disconnect: (userId) =>
          confirmingRefusal(
            Effect.gen(function* () {
              yield* mayConnect(userId);
              yield* leader.write(
                Effect.gen(function* () {
                  yield* sql`DELETE FROM hq_slack_channel`;
                  yield* sql`DELETE FROM hq_slack_thread`;
                  yield* sql`
                    UPDATE hq_slack SET team_id = NULL, team_name = NULL, bot_user_id = NULL,
                      token_sealed = NULL, secret_sealed = NULL, key_id = NULL,
                      connected_by = NULL, connected_at = NULL`;
                }),
              );
            }),
          ),
        channelOf: (appId) =>
          Effect.gen(function* () {
            const row = yield* channelRow(appId);
            if (row === undefined) return yield* refuse("not_found", "no_channel");
            return { appId, channelId: row.channel_id, channel: row.channel_name };
          }),
        mapChannel: (userId, appId, channelId) =>
          confirmingRefusal(
            Effect.gen(function* () {
              yield* mayMap(userId, appId);
              const link = yield* connection;
              if (link === undefined) return yield* refuse("conflict", "slack_not_connected");
              if (!CHANNEL_ID.test(channelId)) return yield* refuse("invalid", "channel");
              const found = yield* api
                .channel(link.token, channelId)
                .pipe(Effect.catch(() => refuse("conflict", "slack_unreachable")));
              if (!found.ok) return yield* refuse("invalid", "channel_not_found");
              if (!found.value.member) return yield* refuse("conflict", "not_in_channel");
              const taken = yield* sql`
                SELECT 1 FROM hq_slack_channel
                WHERE channel_id = ${channelId} AND app_id::text <> ${appId}`;
              if (taken.length > 0) return yield* refuse("conflict", "channel_taken");
              yield* leader.write(sql`
                INSERT INTO hq_slack_channel (app_id, channel_id, channel_name, mapped_by)
                VALUES (${appId}::uuid, ${channelId}, ${found.value.name}, ${userId})
                ON CONFLICT (app_id) DO UPDATE SET channel_id = EXCLUDED.channel_id,
                  channel_name = EXCLUDED.channel_name, mapped_by = EXCLUDED.mapped_by,
                  mapped_at = now()`);
              return { appId, channelId, channel: found.value.name } satisfies HqChannelView;
            }),
          ),
        unmapChannel: (userId, appId) =>
          confirmingRefusal(
            Effect.gen(function* () {
              yield* mayMap(userId, appId);
              yield* leader.write(sql`DELETE FROM hq_slack_channel WHERE app_id::text = ${appId}`);
            }),
          ),
        receive: (publicId, delivery) =>
          Effect.gen(function* () {
            const row = yield* rowWhere(publicId);
            if (row === undefined) return { kind: "unknown" } as const;
            const link = opened(row);
            if (link === undefined) {
              // Not connected yet: only Slack's check of the address, as the app is made.
              const read = decodeEnvelope(new TextDecoder().decode(delivery.body));
              return Option.isSome(read) &&
                read.value.type === "url_verification" &&
                "challenge" in read.value
                ? ({ kind: "challenge", challenge: read.value.challenge } as const)
                : ({ kind: "unknown" } as const);
            }
            const now = yield* Clock.currentTimeMillis;
            if (
              !slackSignatureHolds(
                link.secret,
                delivery.timestamp,
                delivery.body,
                delivery.signature,
                now,
              )
            )
              return { kind: "refused" } as const;
            const read = decodeEnvelope(new TextDecoder().decode(delivery.body));
            if (Option.isNone(read)) return { kind: "invalid" } as const;
            const envelope = read.value;
            if ("challenge" in envelope)
              return { kind: "challenge", challenge: envelope.challenge } as const;
            if ("event_id" in envelope && envelope.team_id === link.teamId)
              yield* FiberSet.run(work, worked(link, envelope.event_id, envelope.event));
            return { kind: "taken" } as const;
          }),
      });
    }),
  );
