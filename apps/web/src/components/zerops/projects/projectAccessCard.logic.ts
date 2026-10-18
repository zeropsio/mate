/**
 * A project page's Access card: every public address of its places with where it lands — a
 * service and its port — production first, then each stage; each place's own domains before its
 * zerops.app addresses, one not answering yet saying how far it is. Read from the addresses
 * sheet's projection (`addresses`), never a read of its own.
 */
import { lacksOwnDomain, type PlaceAddresses } from "@t3tools/client-runtime/data";

import { domainFaceWords } from "../addresses/addresses.logic";

export type AccessTier = "production" | "stage";

export interface AccessRow {
  readonly key: string;
  readonly host: string;
  readonly url: string;
  readonly service: string;
  readonly port: number;
  readonly tier: AccessTier;
  /** It answers now. */
  readonly live: boolean;
  /** How far a domain not answering yet is, in the addresses sheet's words. */
  readonly word?: string | undefined;
  /** The place it belongs to, whose addresses sheet it opens. */
  readonly projectId?: string | undefined;
}

export interface AccessCardModel {
  /** `reading` while any place's addresses are; its rows are held at their size meanwhile. */
  readonly state: "ready" | "reading" | "failed";
  readonly rows: ReadonlyArray<AccessRow>;
  /** Production runs something and has no domain of its own: "Put it on your domain". */
  readonly offerDomain: boolean;
}

export function accessCard(
  places: ReadonlyArray<{
    readonly tier: AccessTier;
    readonly projectId?: string | undefined;
    /** Something runs there: a release on production, a deploy on a stage. */
    readonly runs: boolean;
    readonly place: PlaceAddresses;
  }>,
): AccessCardModel {
  const ordered = [
    ...places.filter((entry) => entry.tier === "production"),
    ...places.filter((entry) => entry.tier !== "production"),
  ];
  const rows = ordered.flatMap(({ tier, place, projectId }): ReadonlyArray<AccessRow> => {
    if (place.state !== "ready") return [];
    const own = place.domains.flatMap((domain) => {
      const target = domain.targets[0];
      if (target === undefined) return [];
      return [
        {
          key: `${tier}:${domain.domainName}`,
          host: domain.domainName,
          url: domain.url,
          service: target.serviceName,
          port: target.port,
          tier,
          live: domain.face === "live",
          word: domain.face === "live" ? undefined : domainFaceWords(domain.face).word,
          projectId,
        },
      ];
    });
    const zerops = place.zerops.flatMap((address) =>
      address.hosts.map((host) => ({
        key: `${tier}:${host.host}`,
        host: host.host,
        url: host.url,
        service: address.serviceName,
        port: host.port,
        tier,
        live: true,
        projectId,
      })),
    );
    // Live domains first, then those on their way, then the zerops.app addresses.
    return [...own.filter((row) => row.live), ...own.filter((row) => !row.live), ...zerops];
  });
  const production = ordered.find((entry) => entry.tier === "production");
  return {
    state: places.some((entry) => entry.place.state === "reading")
      ? "reading"
      : places.some((entry) => entry.place.state === "failed") && rows.length === 0
        ? "failed"
        : "ready",
    rows,
    offerDomain:
      production !== undefined &&
      production.runs &&
      lacksOwnDomain(production.place) &&
      production.place.zerops.length > 0,
  };
}
