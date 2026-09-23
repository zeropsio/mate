/**
 * Opening a Mate without handing it anything of yours.
 *
 * The app used to send the person's own Zerops token to each container's door,
 * and again every fifteen minutes — a credential that reaches every org they
 * belong to and never expires, into a container its owner, its agent and the
 * code that agent runs can all change.
 *
 * Now it mints a throwaway instead: an integration token with no rights at
 * all, named `mate-door:{projectId}:{nonce}`, presented once, and deleted the
 * moment the door has answered — admitted, refused, or the network gone
 * (`authorization/zeropsThrowaway.ts`). The Mate reads who made it and looks
 * that person's role up with its own key, and from then on re-checks by itself
 * (server `ZeropsMembershipWatch`), so nothing is ever re-sent.
 *
 * ## The value is never kept
 *
 * It exists as an argument and a local. {@link connectThroughThrowaway} hands
 * it to one callback and to nothing else; no caller stores it, returns it, or
 * writes it anywhere.
 *
 * ## The sweep
 *
 * `withThrowaway` deletes in `finally`, but a tab closed mid-flight, a crashed
 * renderer or a killed process leaves a row behind — and Zerops refuses to
 * remove a member who still holds tokens (measured 2026-09-15), so the rows
 * are not harmless. At start-up the app therefore deletes the person's own
 * `mate-door:*` and `gitea-signin:*` tokens older than five minutes.
 * {@link planThrowawaySweep} decides which; five minutes is the same window
 * the door itself allows, so a throwaway another tab is mid-flight with is
 * never swept out from under it.
 *
 * @module doorThrowaway
 */

import {
  GITEA_THROWAWAY_PREFIX,
  doorThrowawayName,
  isThrowawayName,
  withThrowaway,
  type ZeropsThrowawayPlatform,
} from "../authorization/zeropsThrowaway.ts";
import type { ZeropsApiClient } from "./api.ts";
import { diagnosticFailure, mateDiagnostics } from "./diagnostics.ts";

/** Nothing older than this is still anybody's live throwaway. */
export const THROWAWAY_SWEEP_AGE_MS = 5 * 60 * 1000;

/**
 * The two platform calls a throwaway is, backed by the signed-in account's own
 * API client.
 *
 * `mintThrowaway` mints `NO_ACCESS` with no projects and refuses to set a
 * flag of any kind, which is what makes what it mints a throwaway rather than
 * something a door has to argue with. It waits for a closed account window
 * rather than refusing, and `signal` ends that wait and the mint.
 */
export function zeropsThrowawayPlatform(
  client: ZeropsApiClient,
  signal?: AbortSignal,
): ZeropsThrowawayPlatform {
  return {
    mint: (input) => {
      const diagnostic = {
        kind: "throwaway",
        action: "mint",
        purpose: input.name.startsWith(`${GITEA_THROWAWAY_PREFIX}:`) ? "gitea" : "door",
        clientId: input.clientId,
      } as const;
      return client.mintThrowaway({ clientId: input.clientId, name: input.name }, signal).then(
        (minted) => {
          mateDiagnostics.record({ ...diagnostic, outcome: "ok", tokenId: minted.id });
          return minted;
        },
        (cause: unknown) => {
          mateDiagnostics.record({
            ...diagnostic,
            outcome: "failed",
            ...diagnosticFailure(cause),
          });
          throw cause;
        },
      );
    },
    remove: (input) => {
      const diagnostic = {
        kind: "throwaway",
        action: "delete",
        clientId: input.clientId,
        tokenId: input.tokenId,
      } as const;
      return client
        .deleteIntegrationToken({ clientId: input.clientId, tokenId: input.tokenId }, signal)
        .then(
          () => mateDiagnostics.record({ ...diagnostic, outcome: "ok" }),
          (cause: unknown) => {
            mateDiagnostics.record({
              ...diagnostic,
              outcome: "failed",
              ...diagnosticFailure(cause),
            });
            throw cause;
          },
        );
    },
  };
}

export interface ConnectThroughThrowawayInput<T> {
  readonly platform: ZeropsThrowawayPlatform;
  /** The org that owns the Mate's project — where the token is minted. */
  readonly clientId: string;
  /** The Mate's project, which the door checks the name against. */
  readonly projectId: string;
  /** Tells this throwaway apart from another minted in the same second. */
  readonly nonce: string;
  /** The one place the value is ever seen. */
  readonly connect: (doorToken: string) => Promise<T>;
  /** Told when the token could not be taken back; never fails the connect. */
  readonly onOrphaned?: ((cause: unknown) => void) | undefined;
}

/**
 * Mints a throwaway for one Mate, hands its value to the connect, and deletes
 * it whatever happened.
 */
export function connectThroughThrowaway<T>(input: ConnectThroughThrowawayInput<T>): Promise<T> {
  return withThrowaway({
    platform: input.platform,
    clientId: input.clientId,
    name: doorThrowawayName(input.projectId, input.nonce),
    ...(input.onOrphaned === undefined ? {} : { onOrphaned: input.onOrphaned }),
    use: input.connect,
  });
}

/** A token as the account's token list describes it — no value, ever. */
export interface AccountTokenRow {
  readonly id: string;
  readonly name?: string | undefined;
  readonly created?: string | undefined;
}

/**
 * Which of the account's tokens are throwaways left behind by a crash.
 *
 * A row whose `created` does not parse is left alone: a token nobody can date
 * is a token nobody can call stale, and deleting one on a guess would take out
 * a live sign-in.
 */
export function planThrowawaySweep(input: {
  readonly tokens: ReadonlyArray<AccountTokenRow>;
  readonly nowEpochMs: number;
  readonly maxAgeMs?: number;
}): ReadonlyArray<string> {
  const maxAgeMs = input.maxAgeMs ?? THROWAWAY_SWEEP_AGE_MS;
  const stale: Array<string> = [];
  for (const token of input.tokens) {
    if (token.name === undefined || !isThrowawayName(token.name)) continue;
    if (token.created === undefined) continue;
    const createdMs = Date.parse(token.created);
    if (!Number.isFinite(createdMs)) continue;
    if (input.nowEpochMs - createdMs > maxAgeMs) stale.push(token.id);
  }
  return stale;
}
