/**
 * Where an organization's billing is acted on: its page in Zerops's own account site (hq.zerops.io,
 * where Mate signs in; the copy calls it "Zerops", as "HQ" is Mate's own). One page holds its
 * balance, top-ups, automatic top-up, invoices, cards and billing details; no link opens a part
 * of it.
 */
import { zeropsHqOrigin } from "./signInMode";

/** The organization's billing page in Zerops. */
export function hqCreditUrl(organizationId: string, origin: string = zeropsHqOrigin()): string {
  return new URL(`/organizations/${encodeURIComponent(organizationId)}`, origin).toString();
}
