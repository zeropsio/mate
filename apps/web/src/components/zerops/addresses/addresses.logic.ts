/**
 * The addresses sheet's words and checks: a typed domain read the way a person means it, its www
 * twin, what a port's firewall may take, the platform's refusals as sentences, and our own writes
 * shown before the organization's search finds them (it lags a write by seconds).
 *
 * Pure: no clock, no platform globals.
 */
import {
  dnsAdvice,
  type AddressDomain,
  type DirectPort,
  type DnsRecord,
  type DomainFace,
  type PlaceAddresses,
  type PlaceIps,
  type WaitingChange,
} from "@t3tools/client-runtime/data";

import type { ZeropsWrite } from "~/zerops/zeropsWrite";

import { environmentTitle } from "../place/place.logic";

/** A write the sheet asks for, in the open organization. */
export type AddressWrite = Extract<
  ZeropsWrite,
  {
    readonly kind:
      | "add-domain"
      | "remove-domain"
      | "check-domain-dns"
      | "publish-domains"
      | "publish-ports"
      | "enable-subdomain-access"
      | "disable-subdomain-access"
      | "open-port"
      | "change-port"
      | "close-port"
      | "request-ipv4";
  }
>;

/** What one write holds busy: one control's press, so the same press takes no second one. */
export function writeKey(write: AddressWrite): string {
  switch (write.kind) {
    case "add-domain":
      return "add-domain";
    case "remove-domain":
      return `remove:${write.domainName}`;
    case "check-domain-dns":
      return `check:${write.routingId}`;
    case "enable-subdomain-access":
    case "disable-subdomain-access":
      return `zerops:${write.serviceId}`;
    case "open-port":
      return "open-port";
    case "change-port":
    case "close-port":
      return `port:${write.portRoutingId}`;
    case "publish-domains":
    case "publish-ports":
    case "request-ipv4":
      return write.kind;
  }
}

/** A domain as typed, the way it is meant: no scheme, path, port or trailing dot, lowercase. */
export function normalizeDomain(typed: string): string {
  return typed
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//u, "")
    .replace(/[/?#].*$/u, "")
    .replace(/:\d*$/u, "")
    .replace(/\.+$/u, "");
}

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

/** A domain name, or a wildcard over one (`*.shop.com`, every subdomain of shop.com). */
function isDomainName(name: string): boolean {
  if (name.startsWith("*.")) return isDomainName(name.slice(2));
  const labels = name.split(".");
  return (
    name.length <= 253 &&
    labels.length >= 2 &&
    labels.every((label) => LABEL.test(label)) &&
    /^(?:[a-z]{2,63}|xn--[a-z0-9-]+)$/u.test(labels.at(-1) ?? "")
  );
}

/** `www.` and the domain, offered for a domain of two labels (`shop.com`), else nothing. */
export function wwwTwin(name: string): string | null {
  return isDomainName(name) && name.split(".").length === 2 ? `www.${name}` : null;
}

/** Why a typed domain cannot be added, or `null`; nothing to say while the field is empty. */
export function domainProblem(
  name: string,
  existing: ReadonlyArray<string>,
  placeName: string,
): string | null {
  if (name === "") return null;
  if (!isDomainName(name)) return "Enter a full domain name, like shop.com.";
  if (existing.includes(name)) return `${name} is already one of ${placeName}'s addresses.`;
  return null;
}

/** The domains one add puts on one routing: the domain, and its www twin where asked. */
export function domainsToAdd(
  name: string,
  withTwin: boolean,
  existing: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const twin = withTwin ? wwwTwin(name) : null;
  return twin === null || existing.includes(twin) ? [name] : [name, twin];
}

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/u;

function isIpv6(address: string): boolean {
  if (!address.includes(":") || !/^[0-9a-f:.]+$/u.test(address)) return false;
  try {
    return new URL(`http://[${address}]/`).hostname.length > 0;
  } catch {
    return false;
  }
}

export type IpType = "IP_V6" | "IP_V4";

/**
 * One address a port's firewall names, as Zerops takes it: a range with its mask. A bare address
 * is that address alone (/128, /32). An IPv6 port takes only IPv6 ranges, an IPv4 port IPv4 ones.
 */
export function normalizeRange(
  typed: string,
  ipType: IpType,
):
  | { readonly ok: true; readonly range: string }
  | { readonly ok: false; readonly problem: string } {
  const text = typed.trim().toLowerCase();
  const [address = "", mask, extra] = text.split("/");
  const notIp = { ok: false, problem: `${typed.trim()} isn't an IP address.` } as const;
  if (extra !== undefined || (mask !== undefined && !/^\d{1,3}$/u.test(mask))) return notIp;
  const v4 = IPV4.test(address);
  const v6 = !v4 && isIpv6(address);
  if (!v4 && !v6) return notIp;
  const bits = mask === undefined ? (v4 ? 32 : 128) : Number(mask);
  if (bits > (v4 ? 32 : 128)) return notIp;
  if (ipType === "IP_V6" && v4)
    return {
      ok: false,
      problem: `${address} is an IPv4 address: an IPv6 port can't allow it. Use an IPv6 address, or open the port on IPv4.`,
    };
  if (ipType === "IP_V4" && v6)
    return { ok: false, problem: `${address} is an IPv6 address: an IPv4 port can't allow it.` };
  return { ok: true, range: `${address}/${bits}` };
}

/** Who may connect, in a few words: "Only 2 addresses", "Everyone except 192.0.2.0/24". */
export function firewallWords(policy: string, ranges: ReadonlyArray<string>): string {
  const which = ranges.length === 1 ? ranges[0] : `${ranges.length} addresses`;
  if (policy === "WHITELIST") return ranges.length === 0 ? "Nobody" : `Only ${which}`;
  return ranges.length === 0 ? "Everyone" : `Everyone except ${which}`;
}

/** The port numbers Zerops keeps for web addresses. */
const RESERVED = new Set([80, 443]);
const RESERVED_WORDS = "80 and 443 are kept for web addresses. Pick another port.";
const RANGE_WORDS = "Pick a public port from 10 to 65435.";

/** Why a typed public port cannot be opened, or `null`. */
export function portProblem(
  typed: string,
  ipType: IpType,
  open: ReadonlyArray<Pick<DirectPort, "publicIpType" | "publicPort">>,
  /** The port being changed, which may keep its number. */
  self?: number,
): string | null {
  if (!/^\d+$/u.test(typed.trim())) return "Enter a port number.";
  const port = Number(typed.trim());
  if (RESERVED.has(port)) return RESERVED_WORDS;
  if (port < 10 || port > 65435) return RANGE_WORDS;
  if (
    port !== self &&
    open.some((each) => each.publicIpType === ipType && each.publicPort === port)
  )
    return `Port ${port} is already open on ${ipType === "IP_V6" ? "IPv6" : "IPv4"}.`;
  return null;
}

/** The platform's refusals the sheet can meet, as a person is told them. */
const TROUBLE: Readonly<Record<string, string>> = {
  publicHttpRoutingInvalidDomainNameFQDN: "Enter a full domain name, like shop.com.",
  publicHttpRoutingServiceStackDoesNotSupportHttp:
    "That service doesn't serve web pages. Point the domain at another one.",
  portNotSupported: "That service can't open this port directly.",
  publicPortRoutingReservedPort: RESERVED_WORDS,
  portOutOfRange: RANGE_WORDS,
  publicIpTypeNotSupported:
    "A port on IPv4 needs your own IPv4. Get one under IP addresses, or open it on IPv6.",
  publicPortRoutingInvalidIpFormat:
    "Zerops didn't take one of the addresses. Give each with its mask, like 2001:db8::1/128.",
};

/**
 * A refusal's sentence by its code, naming what the write named; `undefined` for a code the sheet
 * does not know.
 */
export function addressTrouble(code: string | undefined, write?: AddressWrite): string | undefined {
  if (code === "publicHttpRoutingDuplicateDomainNameInAnotherRouting") {
    const named = write?.kind === "add-domain" ? write.domains.join(" or ") : "That domain";
    return `${named} is already in use on Zerops.`;
  }
  return code === undefined ? undefined : TROUBLE[code];
}

export type FaceTone = "ok" | "warn" | "busy";

const DOMAIN_FACE: Readonly<Record<DomainFace, { word: string; tone: FaceTone }>> = {
  "going-live": { word: "Going live", tone: "busy" },
  changing: { word: "Changing", tone: "busy" },
  removing: { word: "Removing", tone: "busy" },
  dns: { word: "Waiting for your DNS", tone: "warn" },
  elsewhere: { word: "Points elsewhere", tone: "warn" },
  certificate: { word: "Getting a certificate", tone: "busy" },
  "certificate-failed": { word: "Couldn't get a certificate", tone: "warn" },
  live: { word: "Live", tone: "ok" },
};

export function domainFaceWords(face: DomainFace): { word: string; tone: FaceTone } {
  return DOMAIN_FACE[face];
}

const PORT_FACE: Readonly<Record<DirectPort["face"], { word: string; tone: FaceTone }>> = {
  "going-live": { word: "Opening", tone: "busy" },
  changing: { word: "Changing", tone: "busy" },
  removing: { word: "Closing", tone: "busy" },
  live: { word: "Open", tone: "ok" },
};

export function portFaceWords(face: DirectPort["face"]): { word: string; tone: FaceTone } {
  return PORT_FACE[face];
}

/**
 * The records the given domains need at the person's DNS provider, each domain's A and AAAA in
 * turn, and the one-CNAME way for each where the project's zone offers it.
 */
export function recordsOf(
  domains: ReadonlyArray<Pick<AddressDomain, "domainName">>,
  ips: PlaceIps,
): {
  readonly records: ReadonlyArray<DnsRecord>;
  readonly bothRequired: boolean;
  /** The one-record way for each, and whether it reaches IPv4 yet (`dnsAdvice`). */
  readonly cnames: ReadonlyArray<DnsRecord & { readonly ipv4: boolean }>;
  /** What each wildcard's certificate needs, whichever way it points. */
  readonly certificates: ReadonlyArray<DnsRecord>;
} {
  const advice = domains.map((domain) => dnsAdvice(domain.domainName, ips));
  return {
    records: advice.flatMap((each) => each.records),
    bothRequired: advice.some((each) => each.bothRequired),
    cnames: advice.flatMap((each) => (each.cname === undefined ? [] : [each.cname])),
    certificates: advice.flatMap((each) =>
      each.certificate === undefined ? [] : [each.certificate],
    ),
  };
}

/** The live domains that lead to a service: what keeps answering when its zerops.app closes. */
export function keepsWorking(
  domains: ReadonlyArray<AddressDomain>,
  serviceId: string,
): ReadonlyArray<string> {
  return domains
    .filter(
      (domain) =>
        domain.face === "live" && domain.targets.some((target) => target.serviceId === serviceId),
    )
    .map((domain) => domain.domainName);
}

/** Domain names a waiting change's label names (`"a.com, www.a.com → app · port 3000"`). */
const namesIn = (change: WaitingChange) =>
  change.label
    .replace(/^Removing /u, "")
    .split(" → ")[0]!
    .split(", ")
    .map((name) => name.trim());

/**
 * The waiting changes that are not ours: what putting ours live would put live with it. Ours are
 * the routings and ports our writes in flight touch, and the domains they add.
 */
export function othersWaiting(
  waiting: ReadonlyArray<WaitingChange>,
  own: ReadonlyArray<AddressWrite>,
  /** The place's ports, which say what a waiting port change opens. */
  ports: ReadonlyArray<Pick<DirectPort, "id" | "publicIpType" | "publicPort">> = [],
): ReadonlyArray<WaitingChange> {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const write of own) {
    if (write.kind === "remove-domain") ids.add(write.routingId);
    if (write.kind === "change-port" || write.kind === "close-port") ids.add(write.portRoutingId);
    if (write.kind === "add-domain") for (const name of write.domains) names.add(name);
  }
  const opening = own.filter((write) => write.kind === "open-port");
  return waiting.filter(
    (change) =>
      !ids.has(change.id) &&
      !namesIn(change).some((name) => names.has(name)) &&
      !opening.some((write) => {
        const port = ports.find((each) => each.id === change.id);
        return (
          port !== undefined &&
          port.publicPort === write.publicPort &&
          port.publicIpType === write.publicIpType
        );
      }),
  );
}

const byName = (left: AddressDomain, right: AddressDomain) =>
  left.domainName.localeCompare(right.domainName, "en");

/**
 * The place with our writes in flight shown on it: a domain or port being added appears at once,
 * one being removed or changed says so. The organization's search catches up seconds later.
 */
export function withOwnWrites(
  place: PlaceAddresses,
  own: ReadonlyArray<AddressWrite>,
): PlaceAddresses {
  if (own.length === 0) return place;
  let domains = [...place.domains];
  let ports = [...place.ports];
  let zerops = [...place.zerops];
  const serviceName = (serviceId: string) =>
    [...place.webTargets, ...place.portTargets].find((each) => each.serviceId === serviceId)
      ?.serviceName ?? serviceId;
  for (const write of own) {
    switch (write.kind) {
      case "add-domain":
        for (const name of write.domains) {
          if (domains.some((domain) => domain.domainName === name)) continue;
          domains.push({
            routingId: `own:${write.domains[0]}`,
            domainName: name,
            routingDomains: write.domains,
            targets: [
              {
                serviceId: write.serviceId,
                serviceName: serviceName(write.serviceId),
                port: write.port,
                path: "/",
              },
            ],
            sslEnabled: true,
            face: "going-live",
            url: `https://${name}`,
            resolvedIps: [],
            nameServers: [],
          });
        }
        break;
      case "remove-domain":
        domains = domains.map((domain) =>
          domain.domainName === write.domainName ? { ...domain, face: "removing" } : domain,
        );
        break;
      case "open-port":
        if (
          ports.some(
            (port) =>
              port.publicPort === write.publicPort && port.publicIpType === write.publicIpType,
          )
        )
          break;
        ports.push({
          id: `own:${write.publicIpType}:${write.publicPort}`,
          serviceId: write.serviceId,
          serviceName: serviceName(write.serviceId),
          publicIpType: write.publicIpType,
          publicPort: write.publicPort,
          internalPort: write.internalPort,
          internalProtocol: write.internalProtocol,
          firewallPolicy: write.firewallPolicy,
          ranges: write.firewallIpRanges,
          face: "going-live",
        });
        break;
      case "disable-subdomain-access":
        zerops = zerops.map((address) =>
          address.serviceId === write.serviceId ? { ...address, on: false, hosts: [] } : address,
        );
        break;
      case "change-port":
      case "close-port":
        ports = ports.map((port) =>
          port.id === write.portRoutingId
            ? { ...port, face: write.kind === "close-port" ? "removing" : "changing" }
            : port,
        );
        break;
      default:
        break;
    }
  }
  return {
    ...place,
    domains: domains.toSorted(byName),
    zerops,
    ports: ports.toSorted((left, right) => left.publicPort - right.publicPort),
  };
}

/** The own IPv4's price as said: "$3", "$2.50"; `undefined` while it is not known. */
export function priceWords(price: number | undefined): string | undefined {
  if (price === undefined) return undefined;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(price) ? 0 : 2,
  }).format(price);
}

const MINUTE = 60_000;

/** When the platform last looked a domain up, as said beside *Check again*; `null` unknown. */
export function checkedWords(checkedAt: string | undefined, nowMs: number): string | null {
  if (checkedAt === undefined) return null;
  const at = Date.parse(checkedAt);
  if (Number.isNaN(at)) return null;
  const minutes = Math.floor(Math.max(0, nowMs - at) / MINUTE);
  if (minutes < 1) return "Checked just now";
  if (minutes < 2) return "Checked a minute ago";
  if (minutes < 60) return `Checked ${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "Checked an hour ago" : `Checked ${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Checked a day ago" : `Checked ${days} days ago`;
}

/**
 * Removing one domain: its routing keeps the others, sent again as it reads; none, and it goes.
 * A domain whose own removal is under way is never kept: keeping it would put it back.
 */
export function removeWrite(
  domain: AddressDomain,
  projectId: string,
  removing: ReadonlyArray<Pick<AddressDomain, "domainName">> = [],
): AddressWrite {
  const gone = new Set(removing.map((each) => each.domainName));
  return {
    kind: "remove-domain",
    projectId,
    routingId: domain.routingId,
    domainName: domain.domainName,
    keep: domain.routingDomains.filter((name) => name !== domain.domainName && !gone.has(name)),
    locations: domain.targets.map((target) => ({
      path: target.path,
      port: target.port,
      serviceStackId: target.serviceId,
    })),
    sslEnabled: domain.sslEnabled,
  };
}

/** One of the application's places the sheet's switch offers. */
export interface PlaceChoice {
  readonly projectId: string;
  /** A shared environment, or a Mate's own project. */
  readonly kind: "production" | "stage" | "mate";
  /**
   * In the switch: "Production", a stage by its title ("Client demo"), a Mate by its name — a
   * colleague's with its owner beside it ("Filip · Lukas's"), never "Filip's own project".
   */
  readonly label: string;
  /** In sentences: "Production", a stage's title, "Fen". */
  readonly name: string;
  /** Whose it is, where it is a colleague's Mate's: their first name. */
  readonly owner?: string;
}

/** A place's row as the menu's globe reads it (`ProjectSitesInput`). */
interface MenuPlaces {
  readonly stops: ReadonlyArray<{ readonly projectId: string | undefined; readonly name: string }>;
}

/**
 * The application's places, as the menu's globe lists them: production, each stage, then each
 * Mate's own project in the menu's order. A place still being set up has no project yet and is
 * left out; a Mate with no address yet stays, since its addresses are what the sheet adds.
 */
export function addressPlaces(
  input: {
    readonly production: ((nowMs: number) => MenuPlaces) | undefined;
    readonly stages: ((nowMs: number) => MenuPlaces) | undefined;
    readonly mates: ReadonlyArray<{
      readonly candidate: { readonly project: { readonly id: string } };
      readonly name: string;
      readonly owner: { readonly name: string; readonly isViewer: boolean } | undefined;
    }>;
  },
  nowMs: number,
): ReadonlyArray<PlaceChoice> {
  const stops = (menu: MenuPlaces | undefined, production: boolean) =>
    (menu?.stops ?? []).flatMap((stop): ReadonlyArray<PlaceChoice> => {
      if (stop.projectId === undefined) return [];
      const kind = production ? "production" : "stage";
      const name = environmentTitle(kind, stop.name);
      return [{ projectId: stop.projectId, kind, label: name, name }];
    });
  const seen = new Set<string>();
  return [
    ...stops(input.production?.(nowMs), true),
    ...stops(input.stages?.(nowMs), false),
    ...input.mates.map((mate) => {
      const owner =
        mate.owner === undefined || mate.owner.isViewer
          ? undefined
          : mate.owner.name.trim().split(/\s+/u)[0];
      return {
        projectId: mate.candidate.project.id,
        kind: "mate" as const,
        label: mate.name,
        name: mate.name,
        ...(owner === undefined ? {} : { owner }),
      };
    }),
  ].filter((place) => {
    if (seen.has(place.projectId)) return false;
    seen.add(place.projectId);
    return true;
  });
}

/**
 * The domain of the same routing whose removal a remove must wait for: two removes of one routing
 * at once would each send the other back. `null` when nothing of its routing is being removed.
 */
export function removeWaitsFor(
  domain: AddressDomain,
  domains: ReadonlyArray<AddressDomain>,
): string | null {
  return (
    domains.find(
      (each) =>
        each.routingId === domain.routingId &&
        each.domainName !== domain.domainName &&
        each.face === "removing",
    )?.domainName ?? null
  );
}
