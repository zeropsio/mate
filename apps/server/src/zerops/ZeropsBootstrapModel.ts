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
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { isAgentWithoutSignInReady } from "@t3tools/shared/zeropsAgentAuth";

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
