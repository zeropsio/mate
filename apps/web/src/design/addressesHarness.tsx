/**
 * The addresses sheet over the window at the owner's size, from the board's sample world
 * (`addressesFixture.ts`): `?task=` opens it on a flow — `add` (Put it on your domain), `own`
 * (the project has its own IPv4), `settled` (one live domain,
 * a service on two web ports, no open port), `fresh` (no domain yet, one
 * Zerops address off), `faces` (a domain in each state short of live: its DNS at Cloudflare, at
 * nobody, pointing elsewhere, a wildcard, a certificate on its way, one refused, and a name whose
 * registered domain cannot be told). Writes are answered after 600 ms, and a domain added shows in
 * the routings 3 s later, waiting for its DNS; `?fail=1` refuses each. `?theme=dark` for dark.
 *
 * Served by the dev server at `/design-addresses.html`. Fixtures only: nothing here ships, and no
 * route imports this module.
 */
import type { AddressDomain, PlaceAddresses } from "@t3tools/client-runtime/data";
import { StrictMode, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  addressTrouble,
  withOwnWrites,
  writeKey,
  type AddressWrite,
} from "~/components/zerops/addresses/addresses.logic";
import { AddressesSheetBody } from "~/components/zerops/addresses/AddressesSheet";
import { ADDRESSES_FIXTURE } from "~/components/zerops/addresses/addressesFixture";
import { Dialog, DialogPopup } from "~/components/ui/dialog";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const TASK = params.get("task") ?? "";
const FAIL = params.get("fail") === "1";

const waiting = (
  routingId: string,
  domainName: string,
  face: AddressDomain["face"],
  more: Partial<AddressDomain> = {},
): AddressDomain => ({
  routingId,
  domainName,
  routingDomains: [domainName],
  targets: [{ serviceId: "svc-app", serviceName: "app", port: 3000, path: "/" }],
  sslEnabled: true,
  face,
  url: `https://${domainName}`,
  resolvedIps: [],
  nameServers: ["ns1.dns-provider.example"],
  checkedAt: "2026-10-14T11:58:00Z",
  ...more,
});

/** A domain in each state short of live, each a setup of its own. */
const FACES: ReadonlyArray<AddressDomain> = [
  waiting("rt-a", "atlas-shop.com", "dns", {
    nameServers: ["dana.ns.cloudflare.com", "rob.ns.cloudflare.com"],
  }),
  waiting("rt-b", "birch-shop.com", "dns", { nameServers: ["l.gtld-servers.net"] }),
  waiting("rt-c", "cedar-shop.com", "elsewhere", { resolvedIps: ["203.0.113.9"] }),
  waiting("rt-d", "*.dune-shop.com", "dns", { nameServers: [] }),
  waiting("rt-e", "ember-shop.com", "certificate"),
  // A name whose registered domain its shape cannot tell: its records stand in full.
  waiting("rt-g", "garnet.me.uk", "dns", { nameServers: ["ns3-l2.nic.ru"] }),
  waiting("rt-f", "fjord-shop.com", "certificate-failed", {
    sslError: "the challenge at /.well-known/acme-challenge/ answered 403",
    nameServers: ["dana.ns.cloudflare.com"],
  }),
];

const PLACE: PlaceAddresses = {
  ...ADDRESSES_FIXTURE,
  ips: TASK === "own" ? { ...ADDRESSES_FIXTURE.ips, ownV4: "203.0.113.24" } : ADDRESSES_FIXTURE.ips,
  // `?task=empty`: production set up with nothing deployed there.
  nothingDeployed: TASK === "empty",
  ...(TASK === "faces" ? { domains: FACES } : {}),
  ...(TASK === "settled"
    ? {
        domains: [waiting("rt-s", "shop.example", "live", { nameServers: [] })],
        ports: [],
        zerops: [
          ADDRESSES_FIXTURE.zerops[0]!,
          {
            ...ADDRESSES_FIXTURE.zerops[1]!,
            hosts: [
              ...ADDRESSES_FIXTURE.zerops[1]!.hosts,
              {
                port: 8081,
                url: "https://api-4c1e-8081.prg1.zerops.app",
                host: "api-4c1e-8081.prg1.zerops.app",
              },
            ],
          },
        ],
      }
    : {}),
  ...(TASK === "fresh"
    ? {
        domains: [],
        ports: [],
        zerops: ADDRESSES_FIXTURE.zerops.map((address) =>
          address.serviceName === "api" ? { ...address, on: false, hosts: [] } : address,
        ),
      }
    : {}),
};

/** A domain added, as the routings list it once they hold it: waiting for the person's DNS. */
const landed = (write: Extract<AddressWrite, { kind: "add-domain" }>) =>
  write.domains.map((name) =>
    waiting(`rt-${write.domains[0]}`, name, "dns", {
      routingDomains: write.domains,
      nameServers: ["ns1.dns-provider.example"],
    }),
  );

function Harness() {
  const [own, setOwn] = useState<ReadonlyArray<AddressWrite>>([]);
  const [added, setAdded] = useState<ReadonlyArray<AddressDomain>>([]);
  const [trouble, setTrouble] = useState<ReadonlyMap<string, string>>(new Map());
  const onWrite = async (write: AddressWrite) => {
    setOwn((was) => [...was, write]);
    await new Promise((resolve) => setTimeout(resolve, 600));
    if (FAIL) {
      setOwn((was) => was.filter((each) => each !== write));
      setTrouble(
        new Map([
          [
            writeKey(write),
            addressTrouble("publicHttpRoutingDuplicateDomainNameInAnotherRouting", write)!,
          ],
        ]),
      );
      return false;
    }
    setTimeout(() => {
      if (write.kind === "add-domain") setAdded((was) => [...was, ...landed(write)]);
      setOwn((was) => was.filter((each) => each !== write));
    }, 3_000);
    return true;
  };
  // In name order, as the `addresses` projection lists them.
  const place = {
    ...PLACE,
    domains: [...PLACE.domains, ...added].toSorted((left, right) =>
      left.domainName.localeCompare(right.domainName, "en"),
    ),
  };
  const forget = useCallback(
    (key: string) =>
      setTrouble((was) => {
        if (!was.has(key)) return was;
        const next = new Map(was);
        next.delete(key);
        return next;
      }),
    [],
  );
  return (
    <Dialog onOpenChange={() => {}} open>
      <DialogPopup
        className="max-h-[min(55.5rem,calc(100dvh-3rem))] max-w-[48.75rem]"
        placement="center"
        showCloseButton={false}
      >
        <AddressesSheetBody
          busy={new Set(own.map(writeKey))}
          forget={forget}
          ipv4={{ state: "known", price: 3, enabled: false }}
          nowMs={Date.parse("2026-10-14T12:00:00Z")}
          onClose={() => {}}
          onPlace={() => {}}
          onWrite={onWrite}
          place={withOwnWrites(place, own)}
          placeName="Production"
          places={[
            { projectId: "p1", kind: "production", label: "Production", name: "Production" },
            { projectId: "p2", kind: "stage", label: "Stage", name: "Stage" },
            { projectId: "p3", kind: "mate", label: "Fen", name: "Fen", owner: "Karlos" },
          ]}
          projectId="p1"
          projectName="Shop"
          startAdding={TASK === "add"}
          trouble={trouble}
          unsure={new Set()}
          zeropsUrl="https://app.zerops.io/project/p1"
        />
      </DialogPopup>
    </Dialog>
  );
}

document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);
createRoot(document.getElementById("design")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
