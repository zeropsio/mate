/**
 * Where an organization's credit is added: its page in HQ, the Zerops app Mate signs in at, which
 * shows its balance and takes a top-up from whoever manages its billing.
 */
import { zeropsConsentOrigin } from "./deviceLogin";

/** HQ's origin where the build names none of its own. */
const HQ_ORIGIN = "https://hq.zerops.io";

/** The organization's page in HQ, where its credit is added. */
export function hqCreditUrl(
  organizationId: string,
  origin: string = zeropsConsentOrigin() ?? HQ_ORIGIN,
): string {
  return new URL(`/organizations/${encodeURIComponent(organizationId)}`, origin).toString();
}
