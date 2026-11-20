/** A public port routing as the Zerops REST API takes it:
 * one resource of `../api.ts`'s client. */

/**
 * A port opened straight to the internet, as a write sends it: on the project's own IPv6 (free)
 * or IPv4 (the paid add-on; refused as `publicIpTypeNotSupported` without one), to a port the
 * service may open (`portRouting`; else `portNotSupported`), never 80 or 443
 * (`publicPortRoutingReservedPort`) and only in 10–65435 (`portOutOfRange`). The firewall's ranges
 * are CIDRs of the port's own IP version, each with its mask: an IPv6 port refuses an IPv4 range
 * or a bare address as `publicPortRoutingInvalidIpFormat` (all read 2026-10-14).
 */
export interface ZeropsPortRoutingWrite {
  readonly publicIpType: "IP_V6" | "IP_V4";
  readonly publicPort: number;
  readonly internalPort: number;
  /** Lowercase: `TCP` is refused. */
  readonly internalProtocol: "tcp" | "udp";
  /** `WHITELIST`: only the ranges may connect; `BLACKLIST` with none: everyone may. */
  readonly firewallPolicy: "WHITELIST" | "BLACKLIST";
  readonly firewallIpRanges: ReadonlyArray<string>;
}
