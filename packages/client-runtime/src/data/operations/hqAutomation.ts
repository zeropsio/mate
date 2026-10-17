/**
 * The settings' writes for automated Mates, which HQ answers at once: an application's intake set
 * or stopped, the organization's API key for a provider kept or forgotten. A key's value is never
 * part of the recorded intent: it goes to the executor alone (`makeAutomationSettings`).
 *
 * @module data/operations/hqAutomation
 */
import type { HqAiKeyView } from "@t3tools/shared/hqIntake";
import { hqAppsScope } from "../families/hqNavigation.ts";
import type { ProjectionReads } from "../store.ts";
import type { IntentOf, OperationKind } from "./kind.ts";
import { shownInFacts } from "./shownInFacts.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "set-intake": {
      readonly orgId: string;
      readonly appId: string;
      readonly repo: string;
      readonly label: string;
      /** It takes a public repository's issues (`HqIntakeRequest.public`); absent: it does not. */
      readonly public?: true;
    };
    readonly "stop-intake": { readonly orgId: string; readonly appId: string };
    readonly "set-ai-key": { readonly orgId: string; readonly provider: string };
    readonly "remove-ai-key": { readonly orgId: string; readonly provider: string };
  }
  interface OperationResults {
    readonly "set-ai-key": HqAiKeyView;
    /** How the webhook stands; a secret to paste is never part of the result. */
    readonly "set-intake": { readonly hook: "made" | "paste" | "app" };
  }
}

/** The application's intake as HQ's navigation holds it: `undefined` while it is not read. */
export function navigationIntake(read: ProjectionReads, orgId: string, appId: string) {
  const app = read.fact("hqApp", appId);
  if (app.kind !== "known" || !read.members(hqAppsScope(orgId)).ids.includes(appId))
    return undefined;
  return app.value.intake;
}

export const setIntake: OperationKind<"set-intake"> = {
  kind: "set-intake",
  executor: "hq",
  ...shownInFacts(
    (intent: IntentOf<"set-intake">) => intent.appId,
    (read, intent) => {
      const intake = navigationIntake(read, intent.orgId, intent.appId);
      // HQ keeps the repository's name lower-cased, as GitHub matches it: any case is the same.
      return (
        intake != null &&
        intake.repo.toLowerCase() === intent.repo.toLowerCase() &&
        intake.label === intent.label
      );
    },
  ),
};

export const stopIntake: OperationKind<"stop-intake"> = {
  kind: "stop-intake",
  executor: "hq",
  ...shownInFacts(
    (intent: IntentOf<"stop-intake">) => intent.appId,
    (read, intent) => navigationIntake(read, intent.orgId, intent.appId) === null,
  ),
};

export const setAiKey: OperationKind<"set-ai-key"> = {
  kind: "set-ai-key",
  executor: "hq",
  reflected: (_read, _intent, receipt) => receipt.outcome.kind === "succeeded",
};

export const removeAiKey: OperationKind<"remove-ai-key"> = {
  kind: "remove-ai-key",
  executor: "hq",
  reflected: (_read, _intent, receipt) => receipt.outcome.kind === "succeeded",
};

export const HQ_AUTOMATION_KINDS = [setIntake, stopIntake, setAiKey, removeAiKey] as const;
