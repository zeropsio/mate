/**
 * HQ as the owner of the settings' writes for automated Mates. HQ keeps no request id for them: a
 * lost intake answer is read in HQ's navigation (`setIntake`, `stopIntake`); a lost key answer is
 * read in the organization's key list once it is read again. A key's value comes from the screen
 * it was typed into, for its own request only, and is gone once sent: it is never retried.
 */
import * as Effect from "effect/Effect";
import type { HqIntakeView } from "@t3tools/shared/hqIntake";
import { HqError, type HqApi } from "../../../zerops/hq/client.ts";
import type { OperationExecutor } from "../coordinator.ts";

export type AutomationWrites = Pick<HqApi, "setIntake" | "stopIntake" | "setAiKey" | "removeAiKey">;

const UPDATE_HQ = "Update HQ to set up automated Mates.";

export function makeAutomationExecutor(options: {
  readonly api: AutomationWrites;
  readonly current: () => boolean;
  /** The key typed for this request, moved out: `undefined` once it was taken, or never given. */
  readonly takeValue: (requestId: string) => string | undefined;
  /** HQ's answer to an intake set: the webhook it made, or what the person pastes. */
  readonly revealed: (requestId: string, view: HqIntakeView) => void;
}): OperationExecutor {
  const refused = (message: string) => ({ outcome: "definitive-refusal" as const, message });
  return {
    isCurrent: options.current,
    submit: (requestId, intent) =>
      Effect.gen(function* () {
        if (!options.current())
          return yield* Effect.fail(refused("This Zerops sign-in has ended."));
        const call = (): Promise<{ readonly result?: unknown; readonly handle: string }> | null => {
          const { api } = options;
          switch (intent.kind) {
            case "set-intake":
              return api.setIntake === undefined
                ? null
                : api
                    .setIntake(intent.appId, {
                      repo: intent.repo,
                      label: intent.label,
                      ...(intent.public === true ? { public: true } : {}),
                    })
                    .then((view) => {
                      options.revealed(requestId, view);
                      return { result: { hook: view.hook.kind }, handle: intent.appId };
                    });
            case "stop-intake":
              return api.stopIntake === undefined
                ? null
                : api.stopIntake(intent.appId).then(() => ({ handle: intent.appId }));
            case "set-ai-key": {
              const value = options.takeValue(requestId);
              if (api.setAiKey === undefined) return null;
              if (value === undefined) return Promise.reject(refused("Enter the key again."));
              return api.setAiKey(intent.provider, value).then(
                (view) => ({ result: view, handle: intent.provider }),
                (cause: unknown) => {
                  // HQ's refusal is said, never words that may echo what was typed.
                  if (cause instanceof HqError && cause.message.includes(value))
                    throw new HqError({
                      kind: cause.kind,
                      code: cause.code,
                      message: "HQ did not take this key.",
                    });
                  throw cause;
                },
              );
            }
            case "remove-ai-key":
              return api.removeAiKey === undefined
                ? null
                : api.removeAiKey(intent.provider).then(() => ({ handle: intent.provider }));
            default:
              return Promise.reject(refused("This action is unavailable."));
          }
        };
        const pending = call();
        if (pending === null) return yield* Effect.fail(refused(UPDATE_HQ));
        const answer = yield* Effect.tryPromise({
          try: () => pending,
          catch: (cause) =>
            typeof cause === "object" && cause !== null && "outcome" in cause
              ? (cause as ReturnType<typeof refused>)
              : cause instanceof HqError && cause.kind === "refused"
                ? refused(cause.message)
                : {
                    outcome: "uncertain-acceptance" as const,
                    message: "HQ may have taken this change. Check it before trying again.",
                  },
        });
        if (!options.current())
          return yield* Effect.fail({
            outcome: "uncertain-acceptance",
            message: "The account changed before HQ answered.",
          } as const);
        return {
          requestId,
          operationId: requestId,
          executor: "hq",
          handles: [answer.handle],
          affected: [],
          acceptance: {
            kind: "accepted",
            ...(answer.result === undefined ? {} : { result: answer.result as never }),
          },
          outcome: { kind: "succeeded", evidence: "HQ answered this change." },
        };
      }),
  };
}
