/**
 * ZeropsBootstrapModel - which provider the auto-bootstrapped first thread
 * opens on inside a Zerops project container.
 *
 * Upstream hardcodes Codex for the thread the server creates from the CWD on
 * first boot. That holds on a laptop, where Codex is the CLI most users have
 * logged in. It does not hold in a Zerops container: the image ships several
 * agent CLIs and the one the user actually signed into is usually Claude Code,
 * so the very first screen greets them with "Codex is unauthenticated" and a
 * thread that cannot take a turn until they change the model by hand.
 *
 * The rule here is deliberately a pure function over the provider snapshots
 * the registry already publishes, so it is decided by observable state
 * (`status` / `auth` / `models`) rather than by guessing from the environment.
 * When nothing is ready it returns `undefined` and the caller keeps upstream's
 * value - the thread still exists and shows that provider's own sign-in
 * banner, which is a better landing than no thread at all.
 *
 * Scope: this module is only consulted inside a Zerops container
 * (`isZeropsEnvironment`). Everywhere else the upstream default is returned
 * byte-identical.
 *
 * @module ZeropsBootstrapModel
 */
import {
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  type ModelSelection,
  ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { isAgentWithoutSignInReady, isProviderReadyToRun } from "@t3tools/shared/zeropsAgentAuth";
import { selectionWithPreferredEffort } from "@t3tools/shared/zeropsEffort";

/**
 * Which driver the bootstrap thread prefers when more than one is ready.
 *
 * Claude first because it is the CLI a Zerops container is provisioned with a
 * subscription for; Codex second so a container where the user logged Codex in
 * instead lands where upstream would have put it. Any other ready driver is
 * still eligible - it just does not get to jump the queue.
 */
export const ZEROPS_BOOTSTRAP_DRIVER_PREFERENCE: ReadonlyArray<ProviderDriverKind> = [
  ProviderDriverKind.make("claudeAgent"),
  ProviderDriverKind.make("codex"),
];

/**
 * The model the bootstrap thread opens on for one instance.
 *
 * The manifest default wins when the live snapshot actually offers it, so a
 * Zerops container lands on the same model upstream would pick for that
 * provider. Otherwise the snapshot decides - its own `isDefault` flag first,
 * then whatever it lists first - because a slug the CLI does not serve is
 * worse than a second-choice one it does.
 */
export const resolveBootstrapModelSlug = (snapshot: ServerProvider): string => {
  const manifestDefault = DEFAULT_MODEL_BY_PROVIDER[snapshot.driver];
  if (manifestDefault !== undefined && snapshot.models.some((m) => m.slug === manifestDefault)) {
    return manifestDefault;
  }
  const flagged = snapshot.models.find((m) => m.isDefault === true);
  if (flagged !== undefined) {
    return flagged.slug;
  }
  return snapshot.models[0]?.slug ?? manifestDefault ?? DEFAULT_MODEL;
};

/**
 * Is this instance's very first probe still running?
 *
 * A managed provider publishes its snapshot synchronously at construction with
 * the CLI unexamined - `installed: false`, `status: "warning"` - and the real
 * result lands seconds later on a forked fibre. The same triple is what
 * `shouldRetainMissingProviderModels` in `Layers/ProviderRegistry.ts` calls
 * `isPendingInitialProbe`; this is that state named for the bootstrap's use.
 *
 * A disabled instance is never pending: nothing is going to probe it.
 */
export const isProbePendingProvider = (snapshot: ServerProvider): boolean =>
  snapshot.enabled && !snapshot.installed && snapshot.status === "warning";

/**
 * Does this registry reading carry enough truth to choose on?
 *
 * The bootstrap runs within a second of server start, well before the CLI
 * probes return, so the first reading is all-pending and picking from it lands
 * every container on the upstream fallback. The caller therefore polls until
 * this holds (or its bound elapses).
 *
 * Note what is deliberately NOT an exit: "some provider is already ready".
 * Probes finish in whatever order the CLIs happen to answer, so exiting on the
 * first ready snapshot would hand the container Codex simply because it
 * answered before Claude. The preference order in `pickBootstrapProvider` is
 * only meaningful against a complete picture, so the wait ends when no enabled
 * instance is still probing - not when the first one succeeds.
 *
 * An empty array is not decidable: no snapshot is not evidence of no provider,
 * it is the registry not yet populated.
 */
export const isBootstrapDecidable = (providers: ReadonlyArray<ServerProvider>): boolean =>
  providers.length > 0 && !providers.some(isProbePendingProvider);

/**
 * The instance the bootstrap thread opens on, or `undefined` when none of the
 * configured instances can serve a turn.
 */
export const pickBootstrapProvider = (
  providers: ReadonlyArray<ServerProvider>,
): ServerProvider | undefined => {
  const ready = providers.filter(isProviderReadyToRun);
  for (const driver of ZEROPS_BOOTSTRAP_DRIVER_PREFERENCE) {
    const preferred = ready.find((snapshot) => snapshot.driver === driver);
    if (preferred !== undefined) {
      return preferred;
    }
  }
  return ready[0];
};

/**
 * The ready instance of an agent Mate signs nobody in to — Cursor, OpenCode, Grok, Antigravity
 * (`isAgentWithoutSignInReady`): `current`, the conversation's own, when it is one of them, else
 * the first in the registry's order; `undefined` when none is. Claude Code and Codex never answer
 * here: on a Zerops project their sign-in is the feed's to say, and the person's (D6).
 */
export const pickReadyAgentWithoutSignIn = (
  providers: ReadonlyArray<ServerProvider>,
  current?: ProviderInstanceId,
): ServerProvider | undefined => {
  const ready = providers.filter(isAgentWithoutSignInReady);
  return ready.find((snapshot) => snapshot.instanceId === current) ?? ready[0];
};

/**
 * The bootstrap model selection for a Zerops container, or `undefined` when
 * the caller should keep upstream's hardcoded default. It is a new
 * conversation's, so it starts on the preferred effort (D10).
 */
export const resolveZeropsBootstrapModelSelection = (
  providers: ReadonlyArray<ServerProvider>,
): ModelSelection | undefined => {
  const chosen = pickBootstrapProvider(providers);
  return chosen === undefined
    ? undefined
    : selectionWithPreferredEffort([chosen], {
        instanceId: chosen.instanceId,
        model: resolveBootstrapModelSlug(chosen),
      });
};
