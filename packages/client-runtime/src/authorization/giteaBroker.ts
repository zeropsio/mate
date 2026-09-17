/**
 * The app's one call to the org's broker: a person's own Gitea sign-in.
 *
 * `POST /oidc/complete`, as the person, proved by a `gitea-signin` throwaway
 * (`zeropsThrowaway.ts`) — a token with no rights at all, minted for this call
 * and deleted after it. The broker answers where to send the browser to finish
 * signing in to Gitea (guide 3.6).
 *
 * **No endpoint of the broker's takes a Zerops key**, and this sends none.
 * That is the whole reason a browser may talk to a service sitting in the
 * Gitea project beside runners that execute other people's code.
 *
 * A Mate's own Gitea access is asked for nowhere in the app: the broker's
 * rights loop delivers it to every registered Mate with the token the app
 * granted it (D20, `zerops/brokerGrant.ts` in the web app).
 *
 * @module authorization/giteaBroker
 */

import { withThrowaway, type ZeropsThrowawayPlatform } from "./zeropsThrowaway.ts";
import { giteaThrowawayName } from "./zeropsThrowaway.ts";

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
 * The person is proved by a throwaway with no rights, minted for this one
 * Gitea, presented once and deleted whatever the broker answered. What comes
 * back is where to send the browser next — Gitea's own callback, with the
 * code the broker just issued.
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
