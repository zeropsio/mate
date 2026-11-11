/**
 * When a Mate's ZCP is authorized to observe without being asked, and to whom Authorize is
 * offered. Observation uses the Zerops permissions of the person HQ records; a Mate made before
 * observation existed has nobody recorded until someone authorizes it.
 *
 * @module data/projections/observeAuthorization
 */
import type { ObserveCredentialRead } from "./observeCredential.ts";

type Metadata = ObserveCredentialRead["metadata"];

/**
 * Only the Mate's own person (HQ's `mine`), on a current read that says not authorized, once a
 * session: a last known state or a colleague's Mate never records anybody by itself.
 */
export function authorizesObserveByItself(input: {
  readonly mine: boolean | undefined;
  readonly metadata: Metadata;
  /** This session asked for this Mate already, whatever HQ answered. */
  readonly asked: boolean;
}): boolean {
  const { metadata } = input;
  return (
    input.mine === true &&
    !input.asked &&
    metadata.state === "known" &&
    !metadata.value.authorized &&
    !metadata.stale
  );
}

/** To a viewer who operates the Mate (its `observe_mate` offer) while it reads not authorized. */
export function offersObserveAuthorize(input: {
  readonly operates: boolean;
  readonly metadata: Metadata;
}): boolean {
  const { metadata } = input;
  return input.operates && metadata.state === "known" && !metadata.value.authorized;
}

/** The one request a session makes by itself for a Mate: a second open finds it held. */
export const automaticObserveRequestId = (orgId: string, projectId: string) =>
  `observe-authorization:${orgId}:${projectId}`;
