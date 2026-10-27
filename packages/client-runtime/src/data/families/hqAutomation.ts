/**
 * What automated Mates run on and take tasks from, as the settings read it: the organization's
 * API keys (whether each is set, and since when — never a value), read while a screen demands
 * them; and, for one application, what HQ answered when its intake was set — the webhook it made,
 * or the URL and secret to paste, held only while the screen that set it stays open.
 */
import type { HqAiKeyView, HqIntakeView } from "@t3tools/shared/hqIntake";
import type { LinkKey, ScopeKey } from "../model.ts";
import type { FamilySpec } from "./spec.ts";

export interface AiKeysKey {
  readonly orgId: string;
}
export const aiKeysId = (key: AiKeysKey): string => JSON.stringify([key.orgId]);
export const aiKeysScope = (key: AiKeysKey): ScopeKey => `hq:${key.orgId}:ai-keys:${aiKeysId(key)}`;

export interface IntakeKey {
  readonly orgId: string;
  readonly appId: string;
}
export const intakeId = (key: IntakeKey): string => JSON.stringify([key.orgId, key.appId]);
export const intakeRevealScope = (key: IntakeKey): ScopeKey =>
  `hq:${key.orgId}:intake-reveal:${intakeId(key)}`;

/** The link the keys are read on: its fault is the read's own. */
export const aiKeysLink = (key: AiKeysKey): LinkKey =>
  `hq:ai-keys-${encodeURIComponent(aiKeysId(key))}`;

/**
 * A setting's read fault where HQ keeps no such setting — an HQ with no such address, or a client
 * whose HQ has no such call: it predates the setting, which nothing then offers.
 */
export const SETTING_UNSUPPORTED = "unsupported";
/** The keys' read fault where HQ keeps no organization keys: it predates automated Mates. */
export const AI_KEYS_UNSUPPORTED = SETTING_UNSUPPORTED;

export const aiKeyRequestScope = (key: AiKeysKey): ScopeKey =>
  `hq:${key.orgId}:ai-key-request:${aiKeysId(key)}`;

/** The latest intake set from this screen, and HQ's answer to it once given. */
export interface IntakeReveal {
  readonly requestId: string;
  readonly view: HqIntakeView | null;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly hqAiKeys: ReadonlyArray<HqAiKeyView>;
    readonly hqIntakeReveal: IntakeReveal;
    /**
     * The latest key write of this account's, by its request, and the keys' read it was made
     * after (its revision's sequence; `null` before any): the write's answer stands for the key
     * until a later read says what HQ holds.
     */
    readonly hqAiKeyRequest: { readonly requestId: string; readonly after: number | null };
  }
}

export const hqAiKeysFamily: FamilySpec<"hqAiKeys"> = {
  family: "hqAiKeys",
  authority: "hq",
  scope: { source: "hq", suffix: "ai-keys", leaving: "removed", demand: "detail", mode: "once" },
};

export const hqIntakeRevealFamily: FamilySpec<"hqIntakeReveal"> = {
  family: "hqIntakeReveal",
  authority: "hq",
  scope: {
    source: "hq",
    suffix: "intake-reveal",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};

export const hqAiKeyRequestFamily: FamilySpec<"hqAiKeyRequest"> = {
  family: "hqAiKeyRequest",
  authority: "hq",
  scope: {
    source: "hq",
    suffix: "ai-key-request",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};
