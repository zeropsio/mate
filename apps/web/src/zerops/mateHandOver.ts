/**
 * The Mates whose own view handed over to their conversation in this session
 * (`ZeropsMateComingPage`): their empty conversation paints the frame the view last showed — its
 * coming words' room kept in the headline's box, faded — so the route changing under the person
 * moves nothing (`MateEmptyStateView`'s `coming: "past"`). In memory only: a reload paints the
 * conversation as it always does.
 */
import type { EnvironmentId } from "@t3tools/contracts";

const handedOver = new Set<EnvironmentId>();

export function markMateHandedOver(environmentId: EnvironmentId): void {
  handedOver.add(environmentId);
}

export function mateHandedOver(environmentId: EnvironmentId): boolean {
  return handedOver.has(environmentId);
}
