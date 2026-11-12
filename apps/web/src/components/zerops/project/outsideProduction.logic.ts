/**
 * The form that says a project's production is deployed outside Mate and follows `main`: what its
 * optional Address field sends, and what it says of one HQ would not take.
 *
 * Pure: no React.
 */
import { HQ_OUTSIDE_ADDRESS_MAX } from "@t3tools/shared/hqOutsideProduction";

/** What the Address field holds, as Save reads it. */
export type OutsideAddress =
  /** Empty is none given: the field is optional. */
  | { readonly kind: "ok"; readonly address: string | null }
  | { readonly kind: "invalid"; readonly why: string };

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//iu;

/**
 * The address as HQ takes it, by HQ's own rule: an absolute `http(s)` URL with a host, at most
 * `HQ_OUTSIDE_ADDRESS_MAX` characters, kept as sent. A bare host is read as `https://`, as a
 * person types an address, so the common mistake never reaches the write.
 */
export function outsideAddressOf(typed: string): OutsideAddress {
  const text = typed.trim();
  if (text === "") return { kind: "ok", address: null };
  const invalid: OutsideAddress = {
    kind: "invalid",
    why: "Give an address like https://example.com.",
  };
  const spelled = SCHEME.test(text) ? text : `https://${text}`;
  if (spelled.length > HQ_OUTSIDE_ADDRESS_MAX)
    return { kind: "invalid", why: "That address is too long." };
  let url: URL;
  try {
    url = new URL(spelled);
  } catch {
    return invalid;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.hostname === "")
    return invalid;
  return { kind: "ok", address: spelled };
}

/** An address as a row shows it: without its scheme, and without a bare trailing slash. */
export function outsideAddressShown(address: string): string {
  return address.replace(/^https?:\/\//iu, "").replace(/\/$/u, "");
}

/** Whether Save would change anything: a new statement, or another address. */
export function outsideSaveChanges(
  current: { readonly address: string | null } | null,
  typed: OutsideAddress,
): boolean {
  return typed.kind === "ok" && (current === null || current.address !== typed.address);
}
