/**
 * The organization's API keys its automated Mates run on: one per OpenCode key provider
 * (`OPENCODE_KEY_PROVIDERS`), sealed under HQ's key (`deployKeys.ts`), kept by an owner or admin of
 * the organization (`keep_ai_key`), never answered back to a person — only whether one is kept, and
 * when.
 *
 * An automated Mate's link brings them down at once and on each change (`provider-keys`,
 * `framesFor`); any Mate of the organization may ask for one (`POST /api/mate/ai-key`), so its zcp
 * puts it in its project's vault for an application that calls the provider — never through a
 * conversation.
 *
 * @module orgAiKeys
 */
import type { HqAiKeyView, HqMateAiKey } from "@t3tools/shared/hqIntake";
import type { MateLinkDown } from "@t3tools/shared/mateLink";
import { OPENCODE_KEY_PROVIDERS } from "@t3tools/shared/openCodeKeyProviders";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import { AutomationRefused } from "./automationRefused.ts";
import { DeployKeys } from "./deployKeys.ts";
import { Leader, type NotLeader } from "./leader.ts";
import { can } from "./permissions.ts";
import { Roles, confirmingRefusal } from "./roles.ts";
import type { ZeropsError } from "./zerops/api.ts";

/** A key as a provider's API takes it: printable, no spaces, at most 1 KiB. */
const KEY_VALUE = /^[\x21-\x7e]{1,1024}$/u;

type KeepError = AutomationRefused | NotLeader | SqlError | ZeropsError;

export class OrgAiKeys extends Context.Service<
  OrgAiKeys,
  {
    /** Each provider, and whether the organization keeps its key and since when. */
    readonly list: Effect.Effect<ReadonlyArray<HqAiKeyView>, SqlError>;
    readonly keep: (
      userId: string,
      provider: string,
      value: Redacted.Redacted,
    ) => Effect.Effect<HqAiKeyView, KeepError>;
    readonly forget: (userId: string, provider: string) => Effect.Effect<void, KeepError>;
    /** The key of `provider` (the first provider's when none is named), for a Mate. */
    readonly forMate: (
      provider: string | undefined,
    ) => Effect.Effect<HqMateAiKey, AutomationRefused | SqlError>;
    /**
     * The `provider-keys` frames of an automated Mate's link: the keys now, then again each time
     * one changes. None for an ordinary Mate.
     */
    readonly framesFor: (projectId: string) => Stream.Stream<string, SqlError>;
  }
>()("@t3tools/hq/orgAiKeys") {}

const providerOf = (id: string) => OPENCODE_KEY_PROVIDERS.find((provider) => provider.id === id);

const encodeDown = (message: MateLinkDown) => JSON.stringify(message);

export const orgAiKeysLayer = Layer.effect(
  OrgAiKeys,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const leader = yield* Leader;
    const roles = yield* Roles;
    const keys = yield* DeployKeys;
    const ticks = yield* SubscriptionRef.make(0);
    const changed = SubscriptionRef.update(ticks, (tick) => tick + 1);

    const rows = sql<{
      readonly provider: string;
      readonly sealed: Uint8Array;
      readonly key_id: string;
      readonly set_at: string;
    }>`
      SELECT provider, sealed, key_id,
        to_char(set_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS set_at
      FROM hq_org_ai_key`;

    /** A write by an owner or admin of the organization, of a provider HQ knows. */
    const authorized = (userId: string, provider: string) =>
      Effect.gen(function* () {
        if (providerOf(provider) === undefined)
          return yield* new AutomationRefused({ code: "not_found", reason: "unknown_provider" });
        const verdict = can({ kind: "person", userId }, "keep_ai_key", null, yield* roles.forWrite);
        if (!verdict.allow)
          return yield* new AutomationRefused({ code: "forbidden", reason: verdict.reason });
      });

    const viewOf = (provider: string, setAt: string | null): HqAiKeyView => ({
      provider,
      set: setAt !== null,
      setAt,
    });

    /** The keys kept that open under HQ's key, by provider. */
    const opened = Effect.map(rows, (kept) =>
      kept.flatMap((row) => {
        const value = keys.openAiKey(row.provider, { sealed: row.sealed, keyId: row.key_id });
        const provider = providerOf(row.provider);
        return value === undefined || provider === undefined ? [] : [{ provider, value }];
      }),
    );

    return OrgAiKeys.of({
      list: Effect.map(rows, (kept) =>
        OPENCODE_KEY_PROVIDERS.map((provider) =>
          viewOf(provider.id, kept.find((row) => row.provider === provider.id)?.set_at ?? null),
        ),
      ),
      keep: (userId, provider, value) =>
        confirmingRefusal(
          Effect.gen(function* () {
            yield* authorized(userId, provider);
            if (!KEY_VALUE.test(Redacted.value(value)))
              return yield* new AutomationRefused({ code: "invalid", reason: "key_value" });
            const sealed = keys.sealAiKey(provider, value);
            if (sealed === undefined)
              return yield* new AutomationRefused({ code: "conflict", reason: "no_key_secret" });
            const [row] = yield* leader.write(sql<{ readonly set_at: string }>`
              INSERT INTO hq_org_ai_key (provider, sealed, key_id, set_by, set_at)
              VALUES (${provider}, ${sealed.sealed}, ${sealed.keyId}, ${userId}, now())
              ON CONFLICT (provider) DO UPDATE SET sealed = EXCLUDED.sealed,
                key_id = EXCLUDED.key_id, set_by = EXCLUDED.set_by, set_at = EXCLUDED.set_at
              RETURNING to_char(set_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS set_at`);
            yield* changed;
            return viewOf(provider, row?.set_at ?? null);
          }),
        ),
      forget: (userId, provider) =>
        confirmingRefusal(
          Effect.gen(function* () {
            yield* authorized(userId, provider);
            yield* leader.write(sql`DELETE FROM hq_org_ai_key WHERE provider = ${provider}`);
            yield* changed;
          }),
        ),
      forMate: (named) =>
        Effect.gen(function* () {
          const provider = providerOf(named ?? OPENCODE_KEY_PROVIDERS[0]?.id ?? "");
          if (provider === undefined)
            return yield* new AutomationRefused({ code: "not_found", reason: "unknown_provider" });
          const found = (yield* opened).find((key) => key.provider.id === provider.id);
          if (found === undefined)
            return yield* new AutomationRefused({ code: "no_key", reason: "no_key" });
          return {
            provider: provider.id,
            env: provider.variable,
            value: Redacted.value(found.value),
            baseUrl: provider.baseUrl,
          };
        }),
      framesFor: (projectId) =>
        SubscriptionRef.changes(ticks).pipe(
          Stream.mapEffect(() =>
            Effect.gen(function* () {
              const [mate] = yield* sql<{ readonly automated: boolean }>`
                SELECT automated FROM hq_mate WHERE project_id = ${projectId}`;
              if (mate?.automated !== true) return undefined;
              return encodeDown({
                type: "provider-keys",
                keys: (yield* opened).map(({ provider, value }) => ({
                  env: provider.variable,
                  value: Redacted.value(value),
                })),
              });
            }),
          ),
          Stream.filter((frame): frame is string => frame !== undefined),
          Stream.changes,
        ),
    });
  }),
);
