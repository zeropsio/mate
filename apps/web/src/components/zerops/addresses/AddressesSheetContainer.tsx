/**
 * The addresses sheet fed from the account, mounted once above every view (`AddressesSheetHost`):
 * whichever door opened it (`useAddressesSheet`), it shows that place as the `addresses`
 * projection reads it, holding what the projection needs that nothing else holds — the project's
 * own routings listing where the organization's are refused to the viewer, and billing's add-ons
 * for the own IPv4's price — only while it is open.
 *
 * Each write is one of the account's operations (`runAddressWrite`). Ours in flight, and why the
 * last of each failed, are kept per place for as long as the session runs, so a sheet closed,
 * opened again or moved to another place still shows them, and drawn on the place at once
 * (`withOwnWrites`): the organization's search finds a write seconds after Zerops took it.
 */
import {
  addresses,
  PROJECT_ROUTINGS_LISTING,
  type PlaceAddresses,
  type Projection,
} from "@t3tools/client-runtime/data";
import { zeropsProjectUrl } from "@t3tools/client-runtime/zerops/serviceMap";
import { Atom } from "effect/reactivity";
import { useCallback, useEffect, useMemo, useState } from "react";

import { sameValue } from "~/lib/sameValue";
import { captureAccountLifetime } from "~/zerops/accountLifetime";
import { useAccountOperations } from "~/zerops/accountOperations";
import { useAddressesSheet, type AddressesSheetTarget } from "~/zerops/addressesSheet";
import { useProjectSitesOfGroup } from "~/zerops/projectPartsShown";
import { useDetailDemand, useProjection } from "~/zerops/ZeropsAccountData";

import { Dialog, DialogPopup } from "../../ui/dialog";
import { addressPlaces, othersWaiting, withOwnWrites, type AddressWrite } from "./addresses.logic";
import { AddressesSheetBody, type OwnIpv4Offer } from "./AddressesSheet";
import {
  NO_PLACE_FLIGHTS,
  placeKeyOf,
  runAddressWrite,
  useAddressFlights,
  type PlaceKey,
} from "./addressFlights";

interface PlaceFacts {
  /** The Zerops project's own name; `undefined` while its row is not read. */
  readonly name: string | undefined;
  readonly ipv4: OwnIpv4Offer;
}

/** The place's name and its own IPv4's offer, from its row and billing's add-ons. */
const placeFacts: Projection<PlaceKey, PlaceFacts> = {
  name: "addressesPlaceFacts",
  keyOf: placeKeyOf,
  derive: (read, { orgId, projectId }) => {
    const project = read.fact("project", projectId);
    const addons = read.fact("projectAddons", orgId);
    let ipv4: OwnIpv4Offer;
    switch (addons.kind) {
      case "known": {
        const offer = addons.value.ipv4.find((each) => each.projectId === projectId);
        ipv4 =
          offer?.unitPrice === undefined
            ? { state: "unavailable", enabled: offer?.enabled === true }
            : {
                state: "known",
                price: offer.unitPrice,
                enabled: offer.enabled,
                ...(offer.validTill === undefined ? {} : { validTill: offer.validTill }),
              };
        break;
      }
      case "unknown":
        ipv4 = { state: "reading" };
        break;
      case "withheld":
      case "deleted":
        ipv4 = { state: "unavailable" };
        break;
    }
    switch (project.kind) {
      case "known":
        return { name: project.value.name, ipv4 };
      case "unknown":
      case "withheld":
      case "deleted":
        return { name: undefined, ipv4 };
    }
  },
  equals: sameValue,
};

const NOT_READ = Atom.make<PlaceAddresses>({
  state: "reading",
  domains: [],
  zerops: [],
  ips: { zoneHasSharedV4: false },
  portsState: "reading",
  ports: [],
  webTargets: [],
  portTargets: [],
  waitingDomains: [],
  waitingPorts: [],
  readsProject: false,
  nothingDeployed: false,
});
const NO_FACTS = Atom.make<PlaceFacts>({ name: undefined, ipv4: { state: "reading" } });

/** One place's writes, as the sheet shows them and asks for them. */
function useAddressWriter(place: PlaceKey) {
  const operations = useAccountOperations();
  const held = useAddressFlights((state) => state.byPlace[placeKeyOf(place)] ?? NO_PLACE_FLIGHTS);
  const write = useCallback(
    async (write: AddressWrite): Promise<boolean> => {
      // A sign-out mid-flight must not write state back onto the next account.
      const { taken } = await runAddressWrite(operations, place, write, captureAccountLifetime());
      return taken;
    },
    [operations, place],
  );
  return useMemo(
    () => ({
      own: Object.values(held.flights),
      busy: new Set(Object.keys(held.flights)),
      trouble: new Map(Object.entries(held.trouble)),
      unsure: new Set(Object.keys(held.unsure)),
      write,
    }),
    [held, write],
  );
}

/** How often "Checked 3 minutes ago" moves on. */
const CLOCK_MS = 30_000;

/** Now, moving on while `running`; still while the sheet is leaving. */
function useMinuteClock(running: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

export function AddressesSheetContainer({
  target,
  open,
  onClose,
}: {
  readonly target: AddressesSheetTarget;
  /** `false` while the sheet leaves: it holds nothing and its clock stands still. */
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const { orgId, projectId, groupId } = target;
  const key = useMemo(() => ({ orgId, projectId }), [orgId, projectId]);
  const read = useProjection(addresses, key, NOT_READ);
  useDetailDemand(
    "publicRouting",
    PROJECT_ROUTINGS_LISTING,
    open && read.readsProject ? projectId : null,
  );
  useDetailDemand("projectAddons", undefined, open ? orgId : null);
  const facts = useProjection(placeFacts, key, NO_FACTS);
  const sites = useProjectSitesOfGroup(groupId);
  const nowMs = useMinuteClock(open);
  const places = useMemo(
    () => (sites === undefined ? [] : addressPlaces(sites, nowMs)),
    [nowMs, sites],
  );
  const { own, busy, trouble, unsure, write } = useAddressWriter(key);
  const place = useMemo(() => withOwnWrites(read, own), [own, read]);
  const others = useMemo(
    () => ({
      domains: othersWaiting(read.waitingDomains, own),
      ports: othersWaiting(read.waitingPorts, own, read.ports),
    }),
    [own, read.ports, read.waitingDomains, read.waitingPorts],
  );
  const here = places.find((each) => each.projectId === projectId);
  const placeName = here?.name ?? facts.name ?? "This project";
  const projectName = sites?.projectName ?? placeName;
  return (
    <DialogPopup
      aria-label={`${projectName}'s addresses`}
      className="h-[min(55.5rem,100%)] max-w-[48.75rem]"
      data-zerops-surface="addresses-sheet"
      showCloseButton={false}
    >
      <AddressesSheetBody
        busy={busy}
        ipv4={facts.ipv4}
        nowMs={nowMs}
        onClose={onClose}
        onPlace={(next) =>
          useAddressesSheet
            .getState()
            .open({ orgId, projectId: next, ...(groupId === undefined ? {} : { groupId }) })
        }
        onWrite={write}
        othersWaiting={others}
        place={place}
        placeName={placeName}
        places={places}
        projectId={projectId}
        projectName={projectName}
        startAdding={target.intent === "add-domain"}
        trouble={trouble}
        unsure={unsure}
        zeropsUrl={zeropsProjectUrl(projectId)}
      />
    </DialogPopup>
  );
}

/**
 * The one addresses sheet, over whatever is on screen: the place the last door opened, until the
 * person closes it. The place stays drawn while the sheet leaves, holding nothing, and goes once
 * it has left.
 */
export function AddressesSheetHost() {
  const target = useAddressesSheet((state) => state.target);
  const close = useAddressesSheet((state) => state.close);
  const [shown, setShown] = useState(target);
  if (target !== null && target !== shown) setShown(target);
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) close();
      }}
      onOpenChangeComplete={(open) => {
        if (!open && useAddressesSheet.getState().target === null) setShown(null);
      }}
      open={target !== null}
    >
      {shown === null ? null : (
        <AddressesSheetContainer
          key={`${shown.orgId}/${shown.projectId}/${shown.intent ?? ""}`}
          onClose={close}
          open={target !== null}
          target={shown}
        />
      )}
    </Dialog>
  );
}
