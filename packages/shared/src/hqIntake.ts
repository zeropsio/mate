/**
 * Where an application's automated Mates take tasks from, and the organization's API keys they run
 * on: HQ's HTTP shapes for both, shared by HQ and the clients.
 *
 * - `PUT /api/apps/:appId/intake` (`HqIntakeRequest` → `HqIntakeView`) points the application's
 *   automated Mates at a GitHub repository's issues carrying a label; `DELETE` stops it. HQ answers
 *   GitHub's webhooks at `webhookUrl`: it makes the hook itself where the repository's token may,
 *   else the person pastes the URL and the secret, shown once, into the repository's settings.
 * - `PUT /api/org/ai-keys/:provider` (`HqAiKeyRequest` → `HqAiKeyView`) keeps the organization's
 *   key for a provider (`OPENCODE_KEY_PROVIDERS`), sealed; `DELETE` forgets it. HQ never shows it.
 * - `POST /api/mate/ai-key` (Mate-authenticated, `HqMateAiKey`) hands the calling Mate the key, for
 *   zcp to put in its project's vault without the conversation ever holding it.
 *
 * @module hqIntake
 */
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "@t3tools/contracts";

/** The label HQ takes issues by when none is chosen. */
export const DEFAULT_INTAKE_LABEL = "mate";

export const HqIntakeRequest = Schema.Struct({
  /** `owner/name`, one of the application's repositories with a GitHub remote. */
  repo: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  /** A public repository takes issues only when this says so: anyone can open one. */
  public: Schema.optionalKey(Schema.Boolean),
});
export type HqIntakeRequest = typeof HqIntakeRequest.Type;

export const HqIntakeView = Schema.Struct({
  appId: Schema.String,
  repo: Schema.String,
  label: Schema.String,
  /** It takes a public repository's issues (`HqIntakeRequest.public`); absent from an older HQ. */
  public: Schema.optionalKey(Schema.Boolean),
  webhookUrl: Schema.String,
  hook: Schema.Union([
    /** HQ made the webhook on the repository with its token. */
    Schema.Struct({ kind: Schema.Literal("made") }),
    /** The person makes it: the secret is shown this once. */
    Schema.Struct({ kind: Schema.Literal("paste"), secret: Schema.String, why: Schema.String }),
  ]),
});
export type HqIntakeView = typeof HqIntakeView.Type;

export const HqAiKeyRequest = Schema.Struct({ value: TrimmedNonEmptyString });
export type HqAiKeyRequest = typeof HqAiKeyRequest.Type;

export const HqAiKeyView = Schema.Struct({
  provider: Schema.String,
  set: Schema.Boolean,
  setAt: Schema.NullOr(Schema.String),
});
export type HqAiKeyView = typeof HqAiKeyView.Type;

export const HqMateAiKey = Schema.Struct({
  provider: Schema.String,
  /** The variable apps read it from (`NEBIUS_API_KEY`). */
  env: Schema.String,
  value: Schema.String,
  /** The provider's OpenAI-compatible base URL. */
  baseUrl: Schema.String,
});
export type HqMateAiKey = typeof HqMateAiKey.Type;

/**
 * Slack (`/api/org/slack`, Owner/Admin): the organization connects a Slack app made from the
 * manifest HQ gives (`GET /api/org/slack/manifest`, its events URL HQ's own), pasting the app's bot
 * token and signing secret, both sealed and never shown back. An application takes tasks from one
 * channel (`PUT /api/apps/:appId/slack`): `@Mate <ask>` there starts a task whose thread is its
 * conversation.
 */
export const HqSlackConnectRequest = Schema.Struct({
  botToken: TrimmedNonEmptyString,
  signingSecret: TrimmedNonEmptyString,
});
export type HqSlackConnectRequest = typeof HqSlackConnectRequest.Type;

export const HqSlackView = Schema.Struct({
  connected: Schema.Boolean,
  /** The workspace the bot token belongs to, once connected. */
  workspace: Schema.NullOr(Schema.String),
  /** Where Slack sends events: the manifest names it. */
  eventsUrl: Schema.String,
});
export type HqSlackView = typeof HqSlackView.Type;

export const HqChannelRequest = Schema.Struct({ channelId: TrimmedNonEmptyString });
export type HqChannelRequest = typeof HqChannelRequest.Type;

export const HqChannelView = Schema.Struct({
  appId: Schema.String,
  channelId: Schema.String,
  /** The channel's name, without `#`. */
  channel: Schema.String,
});
export type HqChannelView = typeof HqChannelView.Type;

/**
 * Discord (`/api/org/discord`, Owner/Admin): the organization connects a Discord application by its
 * id, public key and bot token (sealed). HQ registers `/mate` and answers Discord's interactions at
 * `interactionsUrl`; `inviteUrl` adds the bot to a server. Only Discord users on the allowlist
 * (`PUT /api/org/discord/allow`) may start or steer a task. An application takes tasks from one
 * channel (`PUT /api/apps/:appId/discord`).
 */
export const HqDiscordConnectRequest = Schema.Struct({
  applicationId: TrimmedNonEmptyString,
  publicKey: TrimmedNonEmptyString,
  botToken: TrimmedNonEmptyString,
});
export type HqDiscordConnectRequest = typeof HqDiscordConnectRequest.Type;

export const HqDiscordView = Schema.Struct({
  connected: Schema.Boolean,
  interactionsUrl: Schema.String,
  inviteUrl: Schema.NullOr(Schema.String),
  /** Discord user ids allowed to start and steer tasks. */
  allowed: Schema.Array(Schema.String),
});
export type HqDiscordView = typeof HqDiscordView.Type;

export const HqDiscordAllowRequest = Schema.Struct({
  userIds: Schema.Array(TrimmedNonEmptyString),
});
export type HqDiscordAllowRequest = typeof HqDiscordAllowRequest.Type;

/**
 * An application's signed webhooks (`/api/apps/:appId/webhooks`): `POST {name}` makes one and
 * answers its URL and secret, the secret this once. A call is `POST <url>` with JSON
 * `{title, body?, url?, author?, dedupeKey?}` and header `X-Mate-Signature: sha256=<hex HMAC of the
 * raw body>`; it becomes a task.
 */
export const HqWebhookRequest = Schema.Struct({ name: TrimmedNonEmptyString });
export type HqWebhookRequest = typeof HqWebhookRequest.Type;

export const HqWebhookView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  url: Schema.String,
  /** Only in the answer that made it. */
  secret: Schema.optionalKey(Schema.String),
  createdAt: Schema.String,
});
export type HqWebhookView = typeof HqWebhookView.Type;

/**
 * An application's schedules (`/api/apps/:appId/schedules`): a brief its automated Mates get as a
 * task each time it is due.
 */
export const HqScheduleRule = Schema.Struct({
  every: Schema.Literals(["day", "weekday", "week"]),
  /** For `week`: 0 Sunday … 6 Saturday. */
  day: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 }))),
  /** `HH:MM`, 24-hour, in `timeZone`. */
  at: Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/)),
  /** IANA time zone, e.g. `Europe/Prague`. */
  timeZone: TrimmedNonEmptyString,
});
export type HqScheduleRule = typeof HqScheduleRule.Type;

export const HqScheduleRequest = Schema.Struct({
  name: TrimmedNonEmptyString,
  brief: TrimmedNonEmptyString,
  rule: HqScheduleRule,
});
export type HqScheduleRequest = typeof HqScheduleRequest.Type;

export const HqScheduleView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  brief: Schema.String,
  rule: HqScheduleRule,
  /** When it is next due, ISO; null while paused. */
  nextAt: Schema.NullOr(Schema.String),
});
export type HqScheduleView = typeof HqScheduleView.Type;

/** The organization's limits on each task (`/api/org/task-limits`, Owner/Admin). */
export const HqTaskLimitsView = Schema.Struct({
  minutes: Schema.Int,
  costUsd: Schema.NullOr(Schema.Number),
});
export type HqTaskLimitsView = typeof HqTaskLimitsView.Type;
