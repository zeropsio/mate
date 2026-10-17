/**
 * The settings for automated Mates as a screen reads them: the organization's API keys (set or
 * not, never a value) with where this account's last key write stands, and an application's
 * intake as HQ's navigation holds it, with what HQ answered when it was set from this screen — the
 * webhook it made, or the URL and secret to paste.
 */
import type { HqAiKeyView, HqIntakeView } from "@t3tools/shared/hqIntake";
import type { HqNavigationIntake } from "@t3tools/shared/hqStream";
import {
  aiKeysId,
  aiKeysScope,
  intakeId,
  type AiKeysKey,
  type IntakeKey,
} from "../families/hqAutomation.ts";
import type { OperationRecord } from "../model.ts";
import { navigationIntake } from "../operations/hqAutomation.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { sameValue } from "./equal.ts";

/** Where this account's last write from a settings row stands. */
export type AutomationAction<Verb extends string> =
  | { readonly kind: "idle" }
  | { readonly kind: "working"; readonly verb: Verb }
  | { readonly kind: "failed"; readonly words: string }
  | { readonly kind: "unresolved"; readonly words: string }
  | { readonly kind: "done"; readonly verb: Verb };

function actionOf<Verb extends string>(
  record: OperationRecord | undefined,
  verbOf: (kind: string) => Verb,
  unresolved: string,
): AutomationAction<Verb> {
  if (record === undefined) return { kind: "idle" };
  const verb = verbOf(record.intent.kind);
  if (record.receipt?.acceptance.kind === "refused")
    return { kind: "failed", words: record.receipt.acceptance.reason };
  if (
    record.submission === "uncertain" ||
    record.submission === "uncertain-unasked" ||
    record.unresolved !== null
  )
    return { kind: "unresolved", words: unresolved };
  if (record.receipt === null) return { kind: "working", verb };
  return { kind: "done", verb };
}

export interface OrgAiKeysRead {
  readonly keys:
    | { readonly state: "unread" | "reading" | "withheld" }
    | {
        readonly state: "known";
        readonly keys: ReadonlyArray<HqAiKeyView>;
        /** Its last read failed: what is shown is what HQ said before. */
        readonly stale: boolean;
      }
    | { readonly state: "failed"; readonly words: string };
  readonly action: AutomationAction<"set" | "remove">;
}

const keysOf = (read: ProjectionReads, key: AiKeysKey): OrgAiKeysRead["keys"] => {
  const fact = read.fact("hqAiKeys", aiKeysId(key));
  const stream = read.stream(aiKeysScope(key));
  if (fact.kind === "known")
    return { state: "known", keys: fact.value, stale: stream.fault !== null };
  if (fact.kind === "withheld") return { state: "withheld" };
  if (stream.fault !== null) return { state: "failed", words: stream.fault.message };
  return {
    state: stream.phase === "baselining" || stream.phase === "connecting" ? "reading" : "unread",
  };
};

export const orgAiKeys: Projection<AiKeysKey, OrgAiKeysRead> = {
  name: "orgAiKeys",
  keyOf: aiKeysId,
  derive: (read, key) => {
    const keys = keysOf(read, key);
    // This account's own record of its last key write: one never published is none made here.
    const request = read.fact("hqAiKeyRequest", aiKeysId(key));
    if (request.kind !== "known") return { keys, action: { kind: "idle" } };
    return {
      keys,
      action: actionOf(
        read.operation(request.value.requestId),
        (kind) => (kind === "remove-ai-key" ? "remove" : "set"),
        "HQ may have taken this change. The key list shows what HQ holds once it is read again.",
      ),
    };
  },
  equals: sameValue,
};

export interface AppIntakeRead {
  /** As HQ's navigation holds it: `undefined` while it is not read, `null` where there is none. */
  readonly intake: HqNavigationIntake | null | undefined;
  readonly action: AutomationAction<"set" | "stop">;
  /** HQ's answer to the intake this screen set, while the screen stays open. */
  readonly answer: HqIntakeView | null;
}

export const appIntake: Projection<IntakeKey, AppIntakeRead> = {
  name: "appIntake",
  keyOf: intakeId,
  derive: (read, key) => {
    const intake = navigationIntake(read, key.orgId, key.appId);
    // This screen's own record of what it set: no read can fail or be refused, so one never
    // published is that nothing was set from here — no write to follow, no answer to show.
    const reveal = read.fact("hqIntakeReveal", intakeId(key));
    if (reveal.kind !== "known") return { intake, action: { kind: "idle" }, answer: null };
    return {
      intake,
      action: actionOf(
        read.operation(reveal.value.requestId),
        (kind) => (kind === "stop-intake" ? "stop" : "set"),
        "HQ may have taken this change. What it holds shows here once HQ says it.",
      ),
      answer: reveal.value.view,
    };
  },
  equals: sameValue,
};
