/**
 * The settings for automated Mates, as the account holds them: the organization's API keys, read
 * while a screen demands them (supervised by the common retry and refusal policy) and again after
 * each write of ours; the writes themselves, through their own coordinator; and an application's
 * intake answer, held while the screen that set it is open — a secret to paste is shown once, so
 * closing that screen forgets it, and nothing else ever holds it.
 */
import * as Effect from "effect/Effect";
import type { HqIntakeView } from "@t3tools/shared/hqIntake";
import type { HqApi } from "../../zerops/hq/client.ts";
import {
  aiKeyRequestScope,
  aiKeysId,
  aiKeysLink,
  aiKeysScope,
  intakeId,
  intakeRevealScope,
  type AiKeysKey,
  type IntakeKey,
} from "../families/hqAutomation.ts";
import { makeOperations } from "../operations/coordinator.ts";
import {
  makeAutomationExecutor,
  type AutomationWrites,
} from "../operations/executors/hqAutomation.ts";
import type { AccountStore } from "../store.ts";
import { commitOwn, makeSettingsReads, type SettingRead } from "./hqSettingsReads.ts";

type AutomationApi = AutomationWrites & Pick<HqApi, "aiKeys">;

const UPDATE_HQ = "Update HQ to set up automated Mates.";

export function makeAutomationSettings(options: {
  readonly store: AccountStore;
  readonly api: AutomationApi;
  readonly makeId: () => string;
}) {
  const { store, api } = options;
  let closed = false;
  // ── the organization's keys, read on demand ────────────────────────────────────────────────
  const reads = makeSettingsReads(store);
  const keysRead = (key: AiKeysKey): SettingRead<"hqAiKeys"> => ({
    family: "hqAiKeys",
    id: aiKeysId(key),
    scope: aiKeysScope(key),
    link: aiKeysLink(key),
    read: () => api.aiKeys?.(),
    unsupported: UPDATE_HQ,
  });
  const demandKeys = (key: AiKeysKey): (() => void) =>
    closed ? () => {} : reads.demand(keysRead(key));
  const againKeys = (key: AiKeysKey) => {
    if (!closed) reads.again(keysRead(key));
  };

  /** The keys' read a write is made after: its revision's sequence, `null` before any. */
  const keysSequence = (key: AiKeysKey): number | null => {
    const revision = store.state().facts.get(`hqAiKeys:${aiKeysId(key)}`)?.revision;
    return revision?.kind === "mate-link" ? revision.sequence : null;
  };

  // ── an intake's answer, held while its screen is open ─────────────────────────────────────
  const views = new Map<string, number>();
  const epochs = new Map<string, number>();
  const revealedFor = new Map<string, { readonly key: IntakeKey; readonly epoch: number }>();
  const commit = <F extends "hqIntakeReveal" | "hqAiKeyRequest">(
    family: F,
    scope: ReturnType<typeof intakeRevealScope>,
    id: string,
    value: import("../model.ts").FamilyValues[F],
  ) => {
    if (!closed) commitOwn(store, family, scope, id, value);
  };
  const publish = (key: IntakeKey, requestId: string, view: HqIntakeView | null) =>
    commit("hqIntakeReveal", intakeRevealScope(key), intakeId(key), { requestId, view });
  // ── the writes ────────────────────────────────────────────────────────────────────────────
  const values = new Map<string, string>();
  const operations = makeOperations({
    store,
    makeId: options.makeId,
    executors: {
      hq: makeAutomationExecutor({
        api,
        current: () => !closed,
        takeValue: (requestId) => {
          const value = values.get(requestId);
          values.delete(requestId);
          return value;
        },
        revealed: (requestId, view) => {
          const held = revealedFor.get(requestId);
          if (
            held !== undefined &&
            (views.get(intakeId(held.key)) ?? 0) > 0 &&
            held.epoch === (epochs.get(intakeId(held.key)) ?? 0)
          )
            publish(held.key, requestId, view);
        },
      }),
    },
  });
  const run = (intent: Parameters<typeof operations.submit>[0], requestId: string) =>
    Effect.runPromise(operations.submit(intent, requestId)).then(() => requestId);

  return {
    demandKeys,
    againKeys,
    /** Keeps the organization's key for a provider; its value goes to the executor alone. */
    setKey: async (key: AiKeysKey, provider: string, value: string): Promise<string> => {
      const requestId = options.makeId();
      values.set(requestId, value);
      commit("hqAiKeyRequest", aiKeyRequestScope(key), aiKeysId(key), {
        requestId,
        after: keysSequence(key),
      });
      try {
        return await run({ kind: "set-ai-key", orgId: key.orgId, provider }, requestId);
      } finally {
        values.delete(requestId);
        if (!closed) reads.readAfterWrite(keysRead(key));
      }
    },
    removeKey: async (key: AiKeysKey, provider: string): Promise<string> => {
      const requestId = options.makeId();
      commit("hqAiKeyRequest", aiKeyRequestScope(key), aiKeysId(key), {
        requestId,
        after: keysSequence(key),
      });
      try {
        return await run({ kind: "remove-ai-key", orgId: key.orgId, provider }, requestId);
      } finally {
        if (!closed) reads.readAfterWrite(keysRead(key));
      }
    },
    /** While a screen shows an application's intake: what HQ answered from it stays shown. */
    holdIntake: (key: IntakeKey): (() => void) => {
      const id = intakeId(key);
      views.set(id, (views.get(id) ?? 0) + 1);
      return () => {
        const count = (views.get(id) ?? 1) - 1;
        views.set(id, count);
        if (count > 0 || closed) return;
        epochs.set(id, (epochs.get(id) ?? 0) + 1);
        const fact = store.state().facts.get(`hqIntakeReveal:${id}`);
        if (fact?.content.kind === "value") {
          const held = fact.content.value as { readonly requestId: string };
          publish(key, held.requestId, null);
        }
      };
    },
    /** `takesPublic`: it takes a public repository's issues, which anyone can open. */
    setIntake: async (
      key: IntakeKey,
      repo: string,
      label: string,
      takesPublic = false,
    ): Promise<string> => {
      const requestId = options.makeId();
      const id = intakeId(key);
      revealedFor.set(requestId, { key, epoch: epochs.get(id) ?? 0 });
      publish(key, requestId, null);
      try {
        return await run(
          { kind: "set-intake", ...key, repo, label, ...(takesPublic ? { public: true } : {}) },
          requestId,
        );
      } finally {
        revealedFor.delete(requestId);
      }
    },
    stopIntake: async (key: IntakeKey): Promise<string> => {
      const requestId = options.makeId();
      publish(key, requestId, null);
      return run({ kind: "stop-intake", ...key }, requestId);
    },
    close: () => {
      if (closed) return;
      for (const id of views.keys()) {
        const fact = store.state().facts.get(`hqIntakeReveal:${id}`);
        if (fact?.content.kind === "value") {
          const [orgId, appId] = JSON.parse(id) as [string, string];
          const held = fact.content.value as { readonly requestId: string };
          publish({ orgId, appId }, held.requestId, null);
        }
      }
      closed = true;
      values.clear();
      revealedFor.clear();
      views.clear();
      epochs.clear();
      reads.close();
    },
  };
}

export type AutomationSettings = ReturnType<typeof makeAutomationSettings>;
