// @effect-diagnostics nodeBuiltinImport:off -- Ed25519 and the address's randomness are the system's.
/**
 * Discord as a source of tasks (`taskSources.ts`): the organization connects a Discord application
 * (`hq_discord`, by an owner or admin, `keep_ai_key`) — its id and public key, and its bot token
 * sealed (`deployKeys.ts`, bound to the application and its address) once Discord confirmed all
 * three belong together. HQ registers `/mate task text:` and `/mate reply text:` as the
 * application's commands and answers Discord's interactions over HTTP alone (no gateway) at
 * `https://<HQ's own domain>/api/intake/discord/<public id>`, the address the person pastes as the
 * application's Interactions Endpoint URL. An application of the organization takes tasks from one
 * channel (`hq_discord_channel`, by a structure writer, `keep_intake`), read from Discord when set.
 *
 * Every interaction is taken only once its Ed25519 signature — over its timestamp and its bytes,
 * under the application's public key — holds and its timestamp is at most five minutes off;
 * Discord probes the address with bad ones, which are `refused`. Only Discord users on the
 * organization's list (`hq_discord_allowed`) may ask; anyone else, a channel set for no
 * application, or a task's own thread are answered in words only the asker sees.
 *
 * `/mate task` in an application's channel is answered at once (deferred, then "On it: <title>"),
 * a public thread is opened on that answer, and the task is asked of HQ (`TaskIntake.enqueue`)
 * keyed by the thread (`discord:<thread id>`): the thread is its conversation. `/mate reply` in that
 * thread tells the task (`TaskIntake.message`), its words answered in the thread for all. The task's status is one message of the bot's in
 * its thread, posted the first time and edited after (`hq_discord_status`); a thread Discord no
 * longer has stops its task — HQ hears of no deletion otherwise, without the gateway.
 *
 * @module discord
 */
import * as NodeCrypto from "node:crypto";

import {
  type DiscordThreadSource,
  MATE_TASK_BODY_MAX,
  MATE_TASK_TITLE_MAX,
} from "@t3tools/contracts";
import type {
  HqChannelRequest,
  HqChannelView,
  HqDiscordAllowRequest,
  HqDiscordConnectRequest,
  HqDiscordView,
} from "@t3tools/shared/hqIntake";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import { AutomationRefused } from "./automationRefused.ts";
import { type KeySecret, openWithData, sealWithData } from "./deployKeys.ts";
import { DiscordApi } from "./discordApi.ts";
import { Leader, type NotLeader } from "./leader.ts";
import { can } from "./permissions.ts";
import { Roles, confirmingRefusal } from "./roles.ts";
import {
  BUDGET_WAIT,
  type TaskOnSource,
  type TaskStatus,
  TaskIntake,
  TaskSourceChannels,
} from "./taskSources.ts";
import type { ZeropsError } from "./zerops/api.ts";

/** Where Discord delivers the organization's interactions, below HQ's own address. */
export const DISCORD_INTERACTIONS_PATH = "/api/intake/discord";

/**
 * What the bot may do where it is invited: see a channel, send messages, open public threads and
 * send in them, add reactions, read a channel's history.
 */
export const DISCORD_BOT_PERMISSIONS = [10n, 11n, 35n, 38n, 6n, 16n]
  .reduce((bits, bit) => bits | (1n << bit), 0n)
  .toString();

/** The application's one command, `/mate`, with its two subcommands. */
export const MATE_COMMANDS = [
  {
    name: "mate",
    type: 1,
    description: "Ask Mate",
    // Servers only, by the bot invited to them.
    contexts: [0],
    integration_types: [0],
    options: [
      {
        type: 1,
        name: "task",
        description: "Start a task in a new thread",
        options: [
          {
            type: 3,
            name: "text",
            description: "What to do",
            required: true,
            max_length: 6000,
          },
        ],
      },
      {
        type: 1,
        name: "reply",
        description: "Tell this thread's task something",
        options: [
          {
            type: 3,
            name: "text",
            description: "What to tell it",
            required: true,
            max_length: 6000,
          },
        ],
      },
    ],
  },
] as const;

/** A Discord id (a snowflake). */
const SNOWFLAKE = /^\d{1,20}$/u;
const PUBLIC_KEY = /^[0-9a-f]{64}$/u;
/** A bot token as Discord gives it: printable, no spaces. */
const BOT_TOKEN = /^[\x21-\x7e]{1,200}$/u;
/** How far an interaction's timestamp may be from HQ's clock: a replay older is refused. */
const FRESH_SECONDS = 300;
/** How many people the list holds. */
const ALLOWED_MAX = 500;
/** What a message holds, by Discord's limit; a thread's name. */
const MESSAGE_MAX = 2000;
const THREAD_NAME_MAX = 100;
/** Channels a thread opens in: a text channel, an announcement channel. */
const THREAD_PARENTS = new Set([0, 5]);
/** Threads: announcement, public, private. */
const THREADS = new Set([10, 11, 12]);
/** Discord's error codes HQ acts on. */
const UNKNOWN_CHANNEL = 10003;
const UNKNOWN_MESSAGE = 10008;
/** How long a reply waits for HQ to tell its task: Discord gives an answer three seconds. */
const REPLY_WITHIN = Duration.millis(2500);

const KEY_PREFIX = "discord:";

/** The words people read when HQ answers them in Discord. */
const SAY = {
  notListed:
    "You're not on the list of people who may ask Mate here. An admin of the organization adds you in Mate's settings.",
  notMapped:
    "This channel takes no tasks. An admin of the organization picks a channel for an application in Mate's settings.",
  inThread: "This is a task's thread: tell its task something with /mate reply.",
  noTask:
    "This thread has no task to tell. Start one with /mate task in the application's channel.",
  noText: "Say what to do: /mate task text:<what to do>.",
  server: "Ask Mate in a channel of a server.",
  unknown: "Mate knows /mate task and /mate reply.",
  notTold: "Mate couldn't pass this on now. Try again in a moment.",
  noThread:
    "Mate couldn't open a thread here. An admin gives it Create Public Threads and Send Messages in Threads in this channel.",
  threadGone: "The thread was deleted.",
} as const;

/** An answer only the asker sees. */
const ephemeral = (content: string) => ({
  type: 4,
  data: { content, flags: 64, allowed_mentions: { parse: [] } },
});
/** An answer everyone in the channel sees, mentioning nobody. */
const said = (content: string) => ({
  type: 4,
  data: {
    content: content.length <= MESSAGE_MAX ? content : `${content.slice(0, MESSAGE_MAX - 1)}…`,
    allowed_mentions: { parse: [] },
  },
});
/** Discord's "Mate is thinking…": the answer's words follow (`editOriginal`). */
const DEFERRED = { type: 5 };
const PONG = { type: 1 };

const DiscordUser = Schema.Struct({
  id: Schema.String,
  username: Schema.String,
  global_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  bot: Schema.optionalKey(Schema.Boolean),
});
const CommandOption = Schema.Struct({
  name: Schema.String,
  type: Schema.Number,
  value: Schema.optionalKey(Schema.Unknown),
  options: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        type: Schema.Number,
        value: Schema.optionalKey(Schema.Unknown),
      }),
    ),
  ),
});
/** What HQ reads of an interaction; everything else in it is passed by. */
const Interaction = Schema.Struct({
  id: Schema.String,
  type: Schema.Number,
  token: Schema.optionalKey(Schema.String),
  guild_id: Schema.optionalKey(Schema.String),
  channel_id: Schema.optionalKey(Schema.String),
  channel: Schema.optionalKey(
    Schema.Struct({
      id: Schema.String,
      type: Schema.Number,
      name: Schema.optionalKey(Schema.NullOr(Schema.String)),
      parent_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  ),
  member: Schema.optionalKey(
    Schema.Struct({
      nick: Schema.optionalKey(Schema.NullOr(Schema.String)),
      user: DiscordUser,
    }),
  ),
  user: Schema.optionalKey(DiscordUser),
  data: Schema.optionalKey(
    Schema.Struct({
      name: Schema.String,
      options: Schema.optionalKey(Schema.Array(CommandOption)),
    }),
  ),
});
type Interaction = typeof Interaction.Type;
const decodeInteraction = Schema.decodeUnknownOption(Schema.fromJsonString(Interaction));

/** An interaction as Discord sends it: its signature headers, and its bytes as they came. */
export interface InteractionDelivery {
  readonly signature: string | undefined;
  readonly timestamp: string | undefined;
  readonly body: Uint8Array;
}

/**
 * What became of an interaction: no connection at that address, its signature refused, one HQ
 * cannot read, or Discord's answer (`body`, JSON).
 */
export type Interacted =
  | { readonly kind: "unknown" | "refused" | "invalid" }
  | { readonly kind: "answer"; readonly body: unknown };

type DiscordError = AutomationRefused | NotLeader | SqlError | ZeropsError;

/** Whether `signature` (hex) is the Ed25519 signature of `timestamp` + `body` under `publicKey`. */
export const interactionSigned = (
  publicKey: string,
  delivery: InteractionDelivery,
  nowSeconds: number,
) => {
  const { signature, timestamp } = delivery;
  if (signature === undefined || !/^[0-9a-f]{128}$/iu.test(signature)) return false;
  if (timestamp === undefined || !/^\d{1,12}$/u.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > FRESH_SECONDS) return false;
  try {
    const key = NodeCrypto.createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(publicKey, "hex").toString("base64url") },
      format: "jwk",
    });
    return NodeCrypto.verify(
      null,
      Buffer.concat([Buffer.from(timestamp, "utf8"), delivery.body]),
      key,
      Buffer.from(signature, "hex"),
    );
  } catch {
    return false;
  }
};

/** What binds the sealed bot token to its row: a token copied onto another does not open there. */
const sealedRow = (applicationId: string, publicId: string) =>
  Buffer.from(`hq_discord:${JSON.stringify([applicationId, publicId])}`, "utf8");

/** A task's status as its thread reads it. */
export const statusWords = (status: TaskStatus): string => {
  const words = (() => {
    switch (status.kind) {
      case "queued":
        return `Waiting for a free Mate: #${String(status.position)} in line.`;
      case "budget":
        return BUDGET_WAIT;
      case "picked":
        return `${status.mate} picked this up.`;
      case "waiting":
        return `${status.mate} is waiting for you: ${status.question}\n\nAnswer with /mate reply in this thread.`;
      case "change":
        return `${status.mate} opened a change for review: ${status.link}`;
      case "done":
        return status.link === null
          ? `${status.mate} finished this.`
          : `${status.mate} finished this: ${status.link}`;
      case "failed":
        return `${status.mate ?? "Mate"} couldn't finish this: ${status.why}`;
      case "stopped":
        return `Stopped: ${status.why}`;
      case "merged":
        return status.pullRequest !== undefined
          ? `Merged: ${status.pullRequest.url}`
          : status.change == null
            ? "Merged."
            : `Merged into main: ${status.change}`;
    }
  })();
  return words.length <= MESSAGE_MAX ? words : `${words.slice(0, MESSAGE_MAX - 1)}…`;
};

export class Discord extends Context.Service<
  Discord,
  {
    readonly view: Effect.Effect<HqDiscordView, SqlError | ZeropsError | AutomationRefused>;
    readonly connect: (
      userId: string,
      request: HqDiscordConnectRequest,
    ) => Effect.Effect<HqDiscordView, DiscordError>;
    readonly disconnect: (userId: string) => Effect.Effect<void, DiscordError>;
    readonly allow: (
      userId: string,
      request: HqDiscordAllowRequest,
    ) => Effect.Effect<HqDiscordView, DiscordError>;
    readonly channelOf: (appId: string) => Effect.Effect<HqChannelView | undefined, SqlError>;
    readonly keepChannel: (
      userId: string,
      appId: string,
      request: HqChannelRequest,
    ) => Effect.Effect<HqChannelView, DiscordError>;
    readonly dropChannel: (userId: string, appId: string) => Effect.Effect<void, DiscordError>;
    /** Discord's interaction to the connection at `publicId`. */
    readonly interact: (
      publicId: string,
      delivery: InteractionDelivery,
    ) => Effect.Effect<Interacted, SqlError>;
  }
>()("@t3tools/hq/discord") {}

interface ConnectionRow {
  readonly application_id: string;
  readonly public_key: string;
  readonly public_id: string;
  readonly sealed: Uint8Array;
  readonly key_id: string;
}

interface ChannelRow {
  readonly app_id: string;
  readonly channel_id: string;
  readonly channel: string;
  readonly guild_id: string;
  readonly server: string;
}

const randomId = (bytes: number) => NodeCrypto.randomBytes(bytes).toString("base64url");

/** The user an interaction came from, and the name people know them by. */
const askerOf = (interaction: Interaction) => {
  const user = interaction.member?.user ?? interaction.user;
  if (user === undefined) return undefined;
  const name = [interaction.member?.nick, user.global_name, user.username]
    .map((candidate) => candidate?.trim() ?? "")
    .find((candidate) => candidate !== "");
  return { id: user.id, bot: user.bot === true, name: name ?? null };
};

/** The `/mate` subcommand an interaction runs, and its text. */
const commandOf = (interaction: Interaction) => {
  if (interaction.data?.name !== "mate") return undefined;
  const sub = interaction.data.options?.[0];
  if (sub === undefined || sub.type !== 1) return undefined;
  const value = sub.options?.find((option) => option.name === "text")?.value;
  return { name: sub.name, text: typeof value === "string" ? value.trim() : "" };
};

export const discordLayer = (options: {
  readonly hqProjectId: string;
  readonly keySecret: KeySecret;
}) =>
  Layer.effect(
    Discord,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const leader = yield* Leader;
      const roles = yield* Roles;
      const api = yield* DiscordApi;
      const intake = yield* TaskIntake;
      const channels = yield* TaskSourceChannels;
      const layerScope = yield* Effect.scope;
      const secret = options.keySecret;
      // One status line at a time: the first is posted once, never twice.
      const statusLine = yield* Semaphore.make(1);

      const refuse = (code: AutomationRefused["code"], reason: string) =>
        Effect.fail(new AutomationRefused({ code, reason }));

      /** A write by an owner or admin of the organization. */
      const orgAdmin = (userId: string) =>
        Effect.gen(function* () {
          const verdict = can(
            { kind: "person", userId },
            "keep_ai_key",
            null,
            yield* roles.forWrite,
          );
          if (!verdict.allow) return yield* refuse("forbidden", verdict.reason);
        });

      /** A write of an application's channel, by a structure writer. */
      const appWriter = (userId: string, appId: string) =>
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

      const connection = Effect.map(
        sql<ConnectionRow>`
          SELECT application_id, public_key, public_id, sealed, key_id FROM hq_discord`,
        (rows) => rows[0],
      );

      /** The bot token `row` keeps; none where HQ's key does not open it. */
      const botToken = (row: ConnectionRow) =>
        secret.state === "ok"
          ? openWithData(secret, sealedRow(row.application_id, row.public_id), {
              sealed: row.sealed,
              keyId: row.key_id,
            })
          : undefined;

      /** HQ's own address, as Discord reaches it. */
      const interactionsUrl = (publicId: string) =>
        Effect.gen(function* () {
          const zone = (yield* roles.view).projects.find(
            (project) => project.id === options.hqProjectId,
          )?.publicZone;
          if (!zone) return yield* refuse("conflict", "hq_address_unknown");
          return `https://${zone}${DISCORD_INTERACTIONS_PATH}/${publicId}`;
        });

      const view = Effect.gen(function* () {
        const row = yield* connection;
        const allowed = yield* sql<{ readonly user_id: string }>`
          SELECT user_id FROM hq_discord_allowed ORDER BY user_id`;
        return {
          connected: row !== undefined,
          interactionsUrl: row === undefined ? "" : yield* interactionsUrl(row.public_id),
          inviteUrl:
            row === undefined
              ? null
              : `https://discord.com/oauth2/authorize?client_id=${row.application_id}&scope=bot%20applications.commands&permissions=${DISCORD_BOT_PERMISSIONS}`,
          allowed: allowed.map((entry) => entry.user_id),
        } satisfies HqDiscordView;
      });

      const unreachable = () => refuse("conflict", "discord_unreachable");

      /** The status line of `task`'s thread, posted the first time and edited after. */
      const status = (task: TaskOnSource, now: TaskStatus) =>
        Effect.gen(function* () {
          if (!task.sourceKey.startsWith(KEY_PREFIX)) return;
          const threadId = task.sourceKey.slice(KEY_PREFIX.length);
          const row = yield* connection;
          const token = row === undefined ? undefined : botToken(row);
          if (token === undefined) return;
          const content = statusWords(now);
          const [held] = yield* sql<{ readonly message_id: string }>`
            SELECT message_id FROM hq_discord_status WHERE thread_id = ${threadId}`;
          const edited =
            held === undefined
              ? undefined
              : yield* api.edit(token, threadId, held.message_id, content);
          if (edited !== undefined && edited.status >= 200 && edited.status < 300) return;
          // Never posted, or its message deleted: posted (again).
          const posted =
            edited === undefined || edited.code === UNKNOWN_MESSAGE
              ? yield* api.post(token, threadId, content)
              : edited;
          if (posted.value !== undefined) {
            yield* leader.write(sql`
              INSERT INTO hq_discord_status (thread_id, message_id)
              VALUES (${threadId}, ${posted.value.id})
              ON CONFLICT (thread_id) DO UPDATE SET message_id = EXCLUDED.message_id`);
            return;
          }
          if (posted.code === UNKNOWN_CHANNEL) {
            // The thread is gone: so is its task, unless it already ended.
            if (now.kind === "done" || now.kind === "failed" || now.kind === "stopped") return;
            yield* Effect.forkIn(intake.stop(task.sourceKey, SAY.threadGone), layerScope);
            return;
          }
          yield* Effect.logInfo("discord status not posted", {
            taskId: task.taskId,
            status: posted.status,
          });
        }).pipe(
          statusLine.withPermits(1),
          Effect.catch((error) =>
            Effect.logInfo("discord status not posted", { taskId: task.taskId, why: error._tag }),
          ),
        );

      yield* channels.register({
        kind: "discord-thread",
        // The interaction's own answer ("On it: …") is the acknowledgement.
        acknowledge: () => Effect.void,
        status,
      });

      /** A `/mate task`: said, its thread opened on what was said, and asked of HQ. */
      const start = (
        row: ConnectionRow,
        token: Redacted.Redacted,
        place: ChannelRow,
        interaction: Interaction,
        interactionToken: Redacted.Redacted,
        asker: { readonly name: string | null },
        text: string,
      ) =>
        Effect.gen(function* () {
          const title = (text.split("\n")[0] ?? "").trim().slice(0, MATE_TASK_TITLE_MAX) || "Task";
          const said = yield* api.editOriginal(
            row.application_id,
            interactionToken,
            `On it: ${title}`,
          );
          if (said.value === undefined)
            return yield* Effect.logInfo("discord answer not said", { status: said.status });
          const thread = yield* api.startThread(
            token,
            place.channel_id,
            said.value.id,
            title.slice(0, THREAD_NAME_MAX),
          );
          if (thread.value === undefined) {
            yield* Effect.logInfo("discord thread not opened", { status: thread.status });
            yield* api.editOriginal(row.application_id, interactionToken, SAY.noThread);
            return;
          }
          const channelName = interaction.channel?.name?.trim() || place.channel;
          const source: DiscordThreadSource = {
            kind: "discord-thread",
            server: place.server,
            channel: channelName,
            url: `https://discord.com/channels/${place.guild_id}/${thread.value.id}`,
            title,
            author: asker.name,
          };
          yield* intake.enqueue({
            appId: place.app_id,
            source,
            body: text.slice(0, MATE_TASK_BODY_MAX),
            sourceKey: `${KEY_PREFIX}${thread.value.id}`,
            deliveryId: `${KEY_PREFIX}${interaction.id}`,
            requestedBy: null,
          });
        }).pipe(
          Effect.catch((error) => Effect.logInfo("discord task not started", { why: error._tag })),
        );

      /** The answer to a `/mate` command HQ read. */
      const command = (row: ConnectionRow, interaction: Interaction) =>
        Effect.gen(function* () {
          const asked = commandOf(interaction);
          if (asked === undefined) return ephemeral(SAY.unknown);
          const asker = askerOf(interaction);
          if (asker === undefined || asker.bot) return ephemeral(SAY.notListed);
          const listed = yield* sql`
            SELECT 1 FROM hq_discord_allowed WHERE user_id = ${asker.id}`;
          if (listed.length === 0) return ephemeral(SAY.notListed);
          const channelId = interaction.channel_id ?? interaction.channel?.id;
          if (interaction.guild_id === undefined || channelId === undefined)
            return ephemeral(SAY.server);
          if (asked.text === "") return ephemeral(SAY.noText);
          if (asked.name === "reply") {
            const told = yield* intake
              .message(`${KEY_PREFIX}${channelId}`, {
                id: `${KEY_PREFIX}${interaction.id}`,
                from: "reply",
                author: asker.name,
                text: asked.text.slice(0, MATE_TASK_BODY_MAX),
              })
              .pipe(Effect.timeoutOption(REPLY_WITHIN));
            // The thread is the task's conversation: everyone in it reads the follow-up.
            if (Option.isSome(told) && told.value)
              return said(`${asker.name ?? "Someone"}: ${asked.text}`);
            return ephemeral(Option.isNone(told) ? SAY.notTold : SAY.noTask);
          }
          if (asked.name !== "task") return ephemeral(SAY.unknown);
          const [place] = yield* sql<ChannelRow>`
            SELECT app_id::text AS app_id, channel_id, channel, guild_id, server
            FROM hq_discord_channel WHERE channel_id = ${channelId}`;
          if (place === undefined)
            return ephemeral(
              THREADS.has(interaction.channel?.type ?? -1) ? SAY.inThread : SAY.notMapped,
            );
          const token = botToken(row);
          if (token === undefined || interaction.token === undefined) return ephemeral(SAY.notTold);
          yield* Effect.forkIn(
            start(
              row,
              token,
              place,
              interaction,
              Redacted.make(interaction.token),
              asker,
              asked.text,
            ),
            layerScope,
          );
          return DEFERRED;
        });

      return Discord.of({
        view,
        interact: (publicId, delivery) =>
          Effect.gen(function* () {
            const [row] = yield* sql<ConnectionRow>`
              SELECT application_id, public_key, public_id, sealed, key_id FROM hq_discord
              WHERE public_id = ${publicId}`;
            if (row === undefined) return { kind: "unknown" } as const;
            const now = yield* Clock.currentTimeMillis;
            if (!interactionSigned(row.public_key, delivery, Math.floor(now / 1000)))
              return { kind: "refused" } as const;
            const read = decodeInteraction(new TextDecoder().decode(delivery.body));
            if (Option.isNone(read)) return { kind: "invalid" } as const;
            const interaction = read.value;
            if (interaction.type === 1) return { kind: "answer", body: PONG } as const;
            if (interaction.type !== 2) return { kind: "invalid" } as const;
            return { kind: "answer", body: yield* command(row, interaction) } as const;
          }),
        connect: (userId, request) =>
          confirmingRefusal(
            Effect.gen(function* () {
              yield* orgAdmin(userId);
              const applicationId = request.applicationId;
              const publicKey = request.publicKey.toLowerCase();
              const token = Redacted.make(request.botToken);
              if (!SNOWFLAKE.test(applicationId)) return yield* refuse("invalid", "application_id");
              if (!PUBLIC_KEY.test(publicKey)) return yield* refuse("invalid", "public_key");
              if (!BOT_TOKEN.test(request.botToken)) return yield* refuse("invalid", "bot_token");
              if (secret.state !== "ok") return yield* refuse("conflict", "no_key_secret");
              // All three are the same application's: one pasted from another would break quietly.
              const app = yield* Effect.catch(api.application(token), unreachable);
              if (app.value === undefined) return yield* refuse("invalid", "bot_token");
              if (app.value.id !== applicationId) return yield* refuse("invalid", "application_id");
              if (app.value.verify_key.toLowerCase() !== publicKey)
                return yield* refuse("invalid", "public_key");
              const before = yield* connection;
              const publicId =
                before?.application_id === applicationId ? before.public_id : randomId(24);
              // The address is known before anything is kept or registered.
              yield* interactionsUrl(publicId);
              const registered = yield* Effect.catch(
                api.putCommands(token, applicationId, MATE_COMMANDS),
                unreachable,
              );
              if (registered < 200 || registered >= 300)
                return yield* refuse("conflict", "commands_refused");
              const sealed = sealWithData(secret, sealedRow(applicationId, publicId), token);
              yield* leader.write(sql`
                INSERT INTO hq_discord (one, application_id, public_key, public_id, sealed, key_id, connected_by)
                VALUES (true, ${applicationId}, ${publicKey}, ${publicId}, ${sealed.sealed},
                  ${sealed.keyId}, ${userId})
                ON CONFLICT (one) DO UPDATE SET application_id = EXCLUDED.application_id,
                  public_key = EXCLUDED.public_key, public_id = EXCLUDED.public_id,
                  sealed = EXCLUDED.sealed, key_id = EXCLUDED.key_id,
                  connected_by = EXCLUDED.connected_by, connected_at = now()`);
              return yield* view;
            }),
          ),
        disconnect: (userId) =>
          confirmingRefusal(
            Effect.gen(function* () {
              yield* orgAdmin(userId);
              const before = yield* connection;
              if (before === undefined) return;
              yield* leader.write(sql`DELETE FROM hq_discord`);
              // `/mate` goes from Discord too, where HQ still may.
              const token = botToken(before);
              if (token === undefined) return;
              const status = yield* api
                .putCommands(token, before.application_id, [])
                .pipe(Effect.orElseSucceed(() => 0));
              if (status < 200 || status >= 300)
                yield* Effect.logInfo("discord commands not removed", { status });
            }),
          ),
        allow: (userId, request) =>
          confirmingRefusal(
            Effect.gen(function* () {
              yield* orgAdmin(userId);
              const ids = [...new Set(request.userIds)];
              if (ids.length > ALLOWED_MAX || !ids.every((id) => SNOWFLAKE.test(id)))
                return yield* refuse("invalid", "user_ids");
              yield* leader.write(
                sql.withTransaction(
                  Effect.gen(function* () {
                    yield* sql`DELETE FROM hq_discord_allowed`;
                    if (ids.length > 0)
                      yield* sql`INSERT INTO hq_discord_allowed ${sql.insert(
                        ids.map((id) => ({ user_id: id, added_by: userId })),
                      )}`;
                  }),
                ),
              );
              return yield* view;
            }),
          ),
        channelOf: (appId) =>
          Effect.map(
            sql<ChannelRow>`
              SELECT app_id::text AS app_id, channel_id, channel, guild_id, server
              FROM hq_discord_channel WHERE app_id::text = ${appId}`,
            ([row]) =>
              row === undefined
                ? undefined
                : { appId: row.app_id, channelId: row.channel_id, channel: row.channel },
          ),
        keepChannel: (userId, appId, request) =>
          confirmingRefusal(
            Effect.gen(function* () {
              yield* appWriter(userId, appId);
              const channelId = request.channelId;
              if (!SNOWFLAKE.test(channelId)) return yield* refuse("invalid", "channel_id");
              const row = yield* connection;
              const token = row === undefined ? undefined : botToken(row);
              if (token === undefined) return yield* refuse("conflict", "not_connected");
              const found = yield* Effect.catch(api.channel(token, channelId), unreachable);
              if (found.value === undefined || found.value.guild_id === undefined)
                return yield* refuse("conflict", "channel_not_found");
              if (!THREAD_PARENTS.has(found.value.type))
                return yield* refuse("invalid", "channel_kind");
              const guild = yield* Effect.catch(
                api.guild(token, found.value.guild_id),
                unreachable,
              );
              if (guild.value === undefined) return yield* refuse("conflict", "channel_not_found");
              const [taken] = yield* sql<{ readonly app_id: string }>`
                SELECT app_id::text AS app_id FROM hq_discord_channel WHERE channel_id = ${channelId}`;
              if (taken !== undefined && taken.app_id !== appId)
                return yield* refuse("conflict", "channel_taken");
              const channel = found.value.name?.trim() || channelId;
              yield* leader.write(sql`
                INSERT INTO hq_discord_channel (app_id, channel_id, channel, guild_id, server, set_by)
                VALUES (${appId}::uuid, ${channelId}, ${channel}, ${found.value.guild_id},
                  ${guild.value.name}, ${userId})
                ON CONFLICT (app_id) DO UPDATE SET channel_id = EXCLUDED.channel_id,
                  channel = EXCLUDED.channel, guild_id = EXCLUDED.guild_id,
                  server = EXCLUDED.server, set_by = EXCLUDED.set_by, set_at = now()`);
              return { appId, channelId, channel } satisfies HqChannelView;
            }),
          ),
        dropChannel: (userId, appId) =>
          confirmingRefusal(
            Effect.gen(function* () {
              yield* appWriter(userId, appId);
              yield* leader.write(
                sql`DELETE FROM hq_discord_channel WHERE app_id::text = ${appId}`,
              );
            }),
          ),
      });
    }),
  );
