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
});
export type HqIntakeRequest = typeof HqIntakeRequest.Type;

export const HqIntakeView = Schema.Struct({
  appId: Schema.String,
  repo: Schema.String,
  label: Schema.String,
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
