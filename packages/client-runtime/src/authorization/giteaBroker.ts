/**
 * The app's two calls to the org's broker: a Mate's Gitea access, and a
 * person's own Gitea sign-in.
 *
 * `POST /mate/credential`, as the person, proved by a `gitea-signin` throwaway
 * (`zeropsThrowaway.ts`). The broker checks the project is a `mate` entry of
 * the registry and that the caller may — its owner, or an org owner or admin —
 * makes the Mate's bot if it is missing, and answers with the bot's Gitea
 * token, or with nothing new when a live one already exists.
 *
 * `POST /oidc/complete` proves the same person the same way, and answers where
 * to send the browser to finish signing in to Gitea (guide 3.6).
 *
 * **No endpoint of the broker's takes a Zerops key**, and this sends none: the
 * bearer is a token with no rights at all, minted for this call and deleted
 * after it. That is the whole reason a browser may talk to a service sitting
 * in the Gitea project beside runners that execute other people's code.
 *
 * What comes back is written onto the Mate's `zcp` service
 * (`zerops/giteaCredential.ts` decides exactly what); the token is present
 * only when the broker minted one, and it goes straight from this answer into
 * a sensitive service variable.
 *
 * @module authorization/giteaBroker
 */

import { withThrowaway, type ZeropsThrowawayPlatform } from "./zeropsThrowaway.ts";
import { giteaThrowawayName } from "./zeropsThrowaway.ts";

/**
 * `ensure` never rotates: a Mate that already has a live token gets nothing
 * new. `rotate` is its own action — a compromised Mate, a leaver, a schedule —
 * and the broker mints the next generation, leaving the old one live until the
 * rights loop revokes it ten minutes later, so a crash between mint and write
 * never leaves a dead Mate.
 */
export type MateCredentialMode = "ensure" | "rotate";

export interface MateCredentialAnswer {
  /** Gitea's public origin. */
  readonly url: string;
  /** The group's Gitea org. */
  readonly org: string;
  /** The Mate's bot login, `mate-{projectId}`. */
  readonly bot: string;
  readonly generation: number;
  /** Whether a token was minted — and so whether `token` is present. */
  readonly minted: boolean;
  readonly token?: string | undefined;
}

export interface RequestMateCredentialInput {
  /** The broker's public origin. */
  readonly brokerUrl: string;
  /** Gitea's public origin — the throwaway is named after its host. */
  readonly giteaUrl: string;
  readonly clientId: string;
  readonly projectId: string;
  readonly mode: MateCredentialMode;
  /** Distinguishes this throwaway from another minted in the same second. */
  readonly nonce: string;
  readonly platform: ZeropsThrowawayPlatform;
  readonly fetch: typeof globalThis.fetch;
  readonly signal?: AbortSignal | undefined;
  readonly onOrphanedThrowaway?: ((cause: unknown) => void) | undefined;
}

export class MateCredentialError extends Error {
  /** The broker's own `error` code, when it named one. */
  readonly code: string | undefined;
  readonly status: number | undefined;

  constructor(message: string, code: string | undefined, status: number | undefined) {
    super(message);
    this.name = "MateCredentialError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Asks the broker for this Mate's Gitea access, as the person.
 *
 * The throwaway is minted, presented and deleted inside this call; neither it
 * nor the Gitea token it returns is stored here.
 */
export async function requestMateCredential(
  input: RequestMateCredentialInput,
): Promise<MateCredentialAnswer> {
  const url = `${input.brokerUrl.replace(/\/+$/u, "")}/mate/credential`;
  return withThrowaway({
    platform: input.platform,
    clientId: input.clientId,
    name: giteaThrowawayName(input.giteaUrl, input.nonce),
    ...(input.onOrphanedThrowaway === undefined ? {} : { onOrphaned: input.onOrphanedThrowaway }),
    use: async (token) => {
      const response = await input.fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ project: input.projectId, mode: input.mode }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const error = readBrokerError(body);
        throw new MateCredentialError(
          error.message ?? "The broker refused to hand this Mate its Gitea access.",
          error.code,
          response.status,
        );
      }
      const answer = readCredential(body);
      if (answer === null) {
        throw new MateCredentialError(
          "The broker's answer did not describe a Gitea credential.",
          undefined,
          response.status,
        );
      }
      return answer;
    },
  });
}

function readBrokerError(body: unknown): {
  readonly code: string | undefined;
  readonly message: string | undefined;
} {
  if (typeof body !== "object" || body === null) return { code: undefined, message: undefined };
  const record = body as { readonly error?: unknown; readonly message?: unknown };
  return {
    code: typeof record.error === "string" ? record.error : undefined,
    message: typeof record.message === "string" ? record.message : undefined,
  };
}

function readCredential(body: unknown): MateCredentialAnswer | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  if (
    typeof record.url !== "string" ||
    typeof record.org !== "string" ||
    typeof record.bot !== "string" ||
    typeof record.generation !== "number" ||
    typeof record.minted !== "boolean"
  ) {
    return null;
  }
  // `token` is present only when `minted`, and a broker that says it minted
  // one without sending it has handed over nothing usable.
  if (record.minted && typeof record.token !== "string") return null;
  return {
    url: record.url,
    org: record.org,
    bot: record.bot,
    generation: record.generation,
    minted: record.minted,
    ...(record.minted ? { token: record.token as string } : {}),
  };
}

export interface CompleteGiteaSignInInput {
  /** The broker's public origin — already matched against the person's own. */
  readonly brokerUrl: string;
  /** Gitea's public origin; the throwaway is named after its host. */
  readonly giteaUrl: string;
  readonly clientId: string;
  /** The request id the broker put in the consent URL. */
  readonly rid: string;
  readonly nonce: string;
  readonly platform: ZeropsThrowawayPlatform;
  readonly fetch: typeof globalThis.fetch;
  readonly signal?: AbortSignal | undefined;
  readonly onOrphanedThrowaway?: ((cause: unknown) => void) | undefined;
}

/**
 * Completes a Gitea sign-in the broker started (guide 3.6).
 *
 * The person is proved the same way a Mate's credential request proves them:
 * a throwaway with no rights, minted for this one Gitea, presented once and
 * deleted whatever the broker answered. What comes back is where to send the
 * browser next — Gitea's own callback, with the code the broker just issued.
 *
 * The `redirect` is the broker's to compose and the browser's to follow; this
 * neither builds it nor keeps it.
 */
export async function completeGiteaSignIn(
  input: CompleteGiteaSignInInput,
): Promise<{ readonly redirect: string }> {
  const url = `${input.brokerUrl.replace(/\/+$/u, "")}/oidc/complete`;
  return withThrowaway({
    platform: input.platform,
    clientId: input.clientId,
    name: giteaThrowawayName(input.giteaUrl, input.nonce),
    ...(input.onOrphanedThrowaway === undefined ? {} : { onOrphaned: input.onOrphanedThrowaway }),
    use: async (token) => {
      const response = await input.fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ rid: input.rid }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const error = readBrokerError(body);
        throw new MateCredentialError(
          error.message ?? "The broker could not complete this sign-in.",
          error.code,
          response.status,
        );
      }
      const redirect =
        typeof body === "object" && body !== null
          ? (body as { readonly redirect?: unknown }).redirect
          : undefined;
      if (typeof redirect !== "string" || redirect.length === 0) {
        throw new MateCredentialError(
          "The broker did not say where to continue the sign-in.",
          undefined,
          response.status,
        );
      }
      return { redirect };
    },
  });
}
