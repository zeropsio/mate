/**
 * Why HQ refused something of automated Mates — an application's intake (`intake.ts`), the
 * organization's API keys (`orgAiKeys.ts`), a task's report (`mateTasks.ts`): one code, the status
 * it answers (`api.ts`), and a reason code beside it. A permission's refusal carries its reason
 * (`permissions.ts`), so a write refused over a view kept is confirmed over a fresh one
 * (`roles.ts`).
 *
 * @module automationRefused
 */
import * as Schema from "effect/Schema";

export class AutomationRefused extends Schema.TaggedError<AutomationRefused>()(
  "AutomationRefused",
  {
    code: Schema.Literals([
      "forbidden",
      "app_not_found",
      "not_found",
      "invalid",
      "conflict",
      "no_key",
    ]),
    reason: Schema.String,
  },
) {}

export const AUTOMATION_STATUS = {
  forbidden: 403,
  app_not_found: 404,
  not_found: 404,
  invalid: 400,
  conflict: 409,
  no_key: 404,
} as const satisfies Record<AutomationRefused["code"], number>;
