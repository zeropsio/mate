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

import { MateTaskSource, mateBoardProtocolOf, TrimmedNonEmptyString } from "@t3tools/contracts";

import type { BoardTask } from "./zeropsPermissions.ts";

/** The label HQ takes issues by when none is chosen. */
export const DEFAULT_INTAKE_LABEL = "mate";

/**
 * The first Mate that puts its working copies on each task's base (`ZeropsWorkingCopy`): HQ hands
 * it tasks while its earlier tasks' changes wait for review. An older one, its one working copy
 * holding that work, takes none until they are merged or closed — and its board says so.
 */
export const TASK_CHANGES_SINCE = "0.15.178";

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
  /** It takes a public repository's issues (`HqIntakeRequest.public`). */
  public: Schema.Boolean,
  webhookUrl: Schema.String,
  hook: Schema.Union([
    /** HQ made the webhook on the repository with its token. */
    Schema.Struct({ kind: Schema.Literal("made") }),
    /**
     * The organization's GitHub app reaches the repository: its own webhook delivers the issues,
     * and the repository has none of HQ's.
     */
    Schema.Struct({ kind: Schema.Literal("app") }),
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
  /** The Zerops user id of the Owner or Admin who set it. */
  setBy: Schema.NullOr(Schema.String),
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
  /** Both to connect; once connected, either alone replaces the one HQ holds. */
  botToken: Schema.optionalKey(TrimmedNonEmptyString),
  signingSecret: Schema.optionalKey(TrimmedNonEmptyString),
});
export type HqSlackConnectRequest = typeof HqSlackConnectRequest.Type;

export const HqSlackView = Schema.Struct({
  connected: Schema.Boolean,
  /** The workspace the bot token belongs to, once connected. */
  workspace: Schema.NullOr(Schema.String),
  /** Where Slack sends events: the manifest names it. */
  eventsUrl: Schema.String,
  /**
   * The last time an event's signature did not hold (`401` at `eventsUrl`), and the last time one
   * did; `null` for never. While the refusal is the later, the signing secret is not the app's.
   */
  eventsRefusedAt: Schema.NullOr(Schema.String),
  eventsAcceptedAt: Schema.NullOr(Schema.String),
  /**
   * The Zerops user id of the Owner or Admin who sealed its bot token, and when (ISO); both `null`
   * while not connected.
   */
  connectedBy: Schema.NullOr(Schema.String),
  connectedAt: Schema.NullOr(Schema.String),
});
export type HqSlackView = typeof HqSlackView.Type;

/**
 * The channels the bot is in (`GET /api/org/slack/channels`, a structure writer's), by name, for
 * an application's channel to be picked from; `bot` is its name in the workspace, which people
 * invite to a channel (`null` where HQ does not know it yet).
 */
export const HqSlackChannels = Schema.Struct({
  bot: Schema.NullOr(Schema.String),
  channels: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
});
export type HqSlackChannels = typeof HqSlackChannels.Type;

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
 * `interactionsUrl`; `inviteUrl` adds the bot to a server. Only a Discord user who linked their account to a
 * person (`/mate link`) may start or steer a task (`mate-hq spec/protocol.md` § Slack, Discord and the GitHub
 * webhook). An application takes tasks from one channel (`PUT /api/apps/:appId/discord`).
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
  /**
   * The Zerops user id of the Owner or Admin who sealed its bot token, and when (ISO); both `null`
   * while not connected.
   */
  connectedBy: Schema.NullOr(Schema.String),
  connectedAt: Schema.NullOr(Schema.String),
});
export type HqDiscordView = typeof HqDiscordView.Type;

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
  /**
   * What the organization's automated Mates may spend in a calendar month (UTC), all tasks
   * together; `null`: no budget. Reached, HQ hands out no more tasks until the next month or a
   * higher budget.
   */
  monthlyBudgetUsd: Schema.NullOr(Schema.Number),
  /** What they spent this month so far, as their Mates reported it. Read only. */
  spentThisMonthUsd: Schema.Number,
  /**
   * The model the organization's automated Mates run each new task on, as an OpenCode slug (one
   * of `automatedModels`): the default until one is picked.
   */
  model: Schema.String,
});
export type HqTaskLimitsView = typeof HqTaskLimitsView.Type;

/**
 * A write of the organization's limits on each task (`PUT /api/org/task-limits`): the budget and
 * the model, left out, are kept as they are. HQ answers {@link HqTaskLimitsView}.
 */
export const HqTaskLimitsRequest = Schema.Struct({
  minutes: Schema.Int,
  costUsd: Schema.NullOr(Schema.Number),
  monthlyBudgetUsd: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  model: Schema.optionalKey(Schema.String),
});
export type HqTaskLimitsRequest = typeof HqTaskLimitsRequest.Type;

/**
 * Who has a task: the automated pool (HQ handed it to `mateProjectId`), or a person who pressed
 * Take for one of their own Mates (`userId`, their Zerops user id).
 */
export const HqTaskTaker = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("pool"), mateProjectId: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("person"),
    userId: Schema.String,
    mateProjectId: Schema.String,
  }),
]);
export type HqTaskTaker = typeof HqTaskTaker.Type;

/** One task of an application, as its Board lists it. */
export const HqAppTask = Schema.Struct({
  id: Schema.String,
  /** Where it came from, linked (`MateTaskSource`'s words and address). */
  title: Schema.String,
  label: Schema.String,
  url: Schema.NullOr(Schema.String),
  /**
   * Where it stands: `stopping` is live with a person's stop taken, until its Mate stops; `merged`
   * and `closed` are done with its change merged or closed unmerged.
   */
  state: Schema.Literals([
    "queued",
    "taken",
    "assigned",
    "working",
    "waiting",
    "stopping",
    "done",
    "merged",
    "closed",
    "failed",
    "stopped",
  ]),
  /** The automated Mate on it or that had it: its project id and name. */
  mate: Schema.NullOr(Schema.Struct({ projectId: Schema.String, name: Schema.String })),
  /** Its place in the queue while queued (1 = next). */
  position: Schema.optionalKey(Schema.Int),
  /**
   * Who asked, as HQ names them: for a webhook task its caller's `author`; `null` for every other
   * task (Slack, Discord, GitHub intake, schedule), because HQ names no person on the board
   * (`mate-hq spec/protocol.md` § Automation and issue intake).
   */
  requestedBy: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  startedAt: Schema.NullOr(Schema.String),
  endedAt: Schema.NullOr(Schema.String),
  spentUsd: Schema.NullOr(Schema.Number),
  workedMs: Schema.NullOr(Schema.Number),
  /**
   * Why it failed or stopped; the question while waiting; done, where its Mate left
   * its work undelivered.
   */
  detail: Schema.NullOr(Schema.String),
  /** Its change in Mate and its pull request on GitHub, once it has them. */
  change: Schema.NullOr(Schema.Struct({ repo: Schema.String, number: Schema.Int })),
  pullRequest: Schema.NullOr(Schema.Struct({ number: Schema.Int, url: Schema.String })),
  /** Where to follow it in Mate (its own conversation, or its Mate's page). */
  link: Schema.NullOr(Schema.String),
  /**
   * The Board's fields, answered only to a read that opts in (`HQ_BOARD_READ`); an HQ that answers
   * without them names none of a task's sources, takers or linked changes, and no `taken` state.
   * Where it came from (a person's Put on board is `conversation`; their New task on the Board
   * itself, `board`).
   */
  source: Schema.optionalKey(MateTaskSource),
  /**
   * Its brief, the ask's text as its Mate gets it (`MateTask.body`): what a Take sends as its
   * conversation's first message, and what the Board shows every member.
   */
  brief: Schema.optionalKey(Schema.String),
  /** Who has it; `null`: nobody (queued, or ended). */
  taker: Schema.optionalKey(Schema.NullOr(HqTaskTaker)),
  /** When a person took it, while `taken` (ISO). */
  takenAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /** The changes linked to it, a taken task's by its Mate (`POST /api/mate/tasks/:taskId/change`). */
  changes: Schema.optionalKey(
    Schema.Array(Schema.Struct({ repo: Schema.String, number: Schema.Int })),
  ),
});
export type HqAppTask = typeof HqAppTask.Type;

/** `GET /api/apps/:appId/tasks`: what is queued, at work, and the latest that ended. */
export const HqAppTasksView = Schema.Struct({
  tasks: Schema.Array(HqAppTask),
});
export type HqAppTasksView = typeof HqAppTasksView.Type;

/**
 * A Board task as the task verbs read it (`zeropsPermissions.ts`): where it stands as HQ stores it,
 * its putter, its taker. HQ shows a task a person took `closed` once every change linked to it
 * closed unmerged, while it keeps it `taken` (it is still that person's, to release, finish or
 * stop); its `takenAt`, kept while taken, says so.
 */
export const boardTaskOf = (task: HqAppTask): BoardTask => ({
  stored:
    task.state === "closed" && task.taker?.kind === "person" && task.takenAt != null
      ? "taken"
      : task.state,
  putBy:
    task.source?.kind === "conversation" || task.source?.kind === "board"
      ? task.source.putBy
      : null,
  protocol: task.source === undefined ? 1 : mateBoardProtocolOf(task.source),
  taker: task.taker ?? null,
});

/** The longest title and brief a person puts on the Board (`HqPutTaskRequest`). */
export const BOARD_TITLE_MAX = 120;
export const BOARD_BRIEF_MAX = 8_000;
/** The longest answer or steer its putter sends a task (`HqTaskMessageRequest`). */
export const BOARD_MESSAGE_MAX = 8_000;

/**
 * `POST /api/apps/:appId/tasks` (a signed-in person): a person's **Put on board** — the title and
 * the brief, and where they put it from: one of their conversations, its Mate and conversation in
 * the application (`from`), or the Board itself (no `from`: **New task**, source `board`). HQ
 * answers `201` {@link HqTaskAnswer}, the task queued at once.
 */
export const HqPutTaskRequest = Schema.Struct({
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(BOARD_TITLE_MAX)),
  brief: TrimmedNonEmptyString.check(Schema.isMaxLength(BOARD_BRIEF_MAX)),
  from: Schema.optionalKey(
    Schema.Struct({
      mateProjectId: TrimmedNonEmptyString,
      conversationId: TrimmedNonEmptyString,
    }),
  ),
  /**
   * The put's own request id, the same on every send of one card's or draft's put
   * (`boardPutRequestId`): HQ puts one task per id however often it arrives. The client's operation
   * adds it; a surface never names one.
   */
  requestId: Schema.optionalKey(TrimmedNonEmptyString),
});
export type HqPutTaskRequest = typeof HqPutTaskRequest.Type;

/**
 * The request id a Put on board is sent under (`HqPutTaskRequest.requestId`): one per card — the
 * board ask's request in its chat of its Mate, or a New task's draft on the Board (no `from`) —
 * the same on every send of it, from any tab or device, so HQ answers a repeated put with the task
 * the first made. A UUID (version 8) of a 128-bit hash of them; HQ scopes it to the application
 * and the person.
 */
export function boardPutRequestId(
  from: { readonly mateProjectId: string; readonly conversationId: string } | undefined,
  card: string,
): string {
  const hex = hash128(
    from === undefined
      ? `board\n${card}`
      : `${from.mateProjectId}\n${from.conversationId}\n${card}`,
  );
  const variant = ((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Four 32-bit lanes of a string's hash (cyrb128), as 32 hex digits: the same on every runtime. */
function hash128(text: string): string {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at);
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1, h2, h3, h4].map((lane) => (lane >>> 0).toString(16).padStart(8, "0")).join("");
}

/**
 * `POST /api/apps/:appId/tasks/:taskId/take` `{mateProjectId}`: a queued task taken for one of the
 * person's own Mates in the application; `taken`, its taker that person and Mate.
 */
export const HqTakeTaskRequest = Schema.Struct({ mateProjectId: TrimmedNonEmptyString });
export type HqTakeTaskRequest = typeof HqTakeTaskRequest.Type;

/**
 * The task as it stands after a person's write to it: `POST …/tasks` (`201`), `…/take`,
 * `…/release` (`taken` → `queued`) and `…/done` (`taken` → `done`), each `200`.
 */
export const HqTaskAnswer = Schema.Struct({ task: HqAppTask });
export type HqTaskAnswer = typeof HqTaskAnswer.Type;

/**
 * `POST /api/apps/:appId/tasks/:taskId/messages` `{text}` → `204`: its putter answers or steers a
 * conversation's task a pool Mate holds; it reaches that Mate as a `task-message` (`reply`).
 */
export const HqTaskMessageRequest = Schema.Struct({
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(BOARD_MESSAGE_MAX)),
});
export type HqTaskMessageRequest = typeof HqTaskMessageRequest.Type;

/**
 * `POST /api/mate/tasks/:taskId/change` `{repo, number}` → `204` (the Mate's project key): this
 * Mate's own open change linked to a task its person took on this Mate. A taken task ends `done`
 * when a linked change merges.
 */
export const HqTaskChangeRequest = Schema.Struct({
  repo: TrimmedNonEmptyString,
  number: Schema.Int.check(Schema.isGreaterThan(0)),
});
export type HqTaskChangeRequest = typeof HqTaskChangeRequest.Type;

/**
 * One thing a person set aside until it changes, theirs on every device (HQ keeps it per person):
 * `item` a key the client builds (`task:<id>`, `change:<appId>/<repo>#<n>`, `ask:<…>`), `revision`
 * the item's own revision when it was snoozed. The client hides the item while its revision is
 * still that one.
 *
 * - `GET /api/me/snoozes` → {@link HqSnoozesView};
 * - `PUT /api/me/snoozes` {@link HqSnoozeRequest} → `204`;
 * - `DELETE /api/me/snoozes?item=…` → `204`.
 */
export const HqSnooze = Schema.Struct({
  item: Schema.String,
  revision: Schema.String,
  /** When it was snoozed (ISO). */
  at: Schema.String,
});
export type HqSnooze = typeof HqSnooze.Type;

export const HqSnoozesView = Schema.Struct({ snoozes: Schema.Array(HqSnooze) });
export type HqSnoozesView = typeof HqSnoozesView.Type;

/** The longest item key and revision HQ keeps for a snooze. */
export const SNOOZE_ITEM_MAX = 300;
export const SNOOZE_REVISION_MAX = 200;

export const HqSnoozeRequest = Schema.Struct({
  item: TrimmedNonEmptyString.check(Schema.isMaxLength(SNOOZE_ITEM_MAX)),
  revision: TrimmedNonEmptyString.check(Schema.isMaxLength(SNOOZE_REVISION_MAX)),
});
export type HqSnoozeRequest = typeof HqSnoozeRequest.Type;
