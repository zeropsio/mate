/**
 * The addresses sheet fed from the account, mounted once above every view (`AddressesSheetHost`):
 * whichever door opened it (`useAddressesSheet`), it shows that place as the `addresses`
 * projection reads it, holding what the projection needs that nothing else holds — the project's
 * own routings listing where the organization's are refused to the viewer, and billing's add-ons
 * for the own IPv4's price — while it is open.
 *
 * Each write is one of the account's operations. Ours in flight are kept per place for as long as
 * they run, so a sheet closed and opened again still shows them under way, and drawn on the place
 * at once (`withOwnWrites`): the organization's search finds a write seconds after Zerops took it.
 */
import {
  addresses,
  PROJECT_ROUTINGS_LISTING,
  type PlaceAddresses,
  type Projection,
} from "@t3tools/client-runtime/data";
import { zeropsProjectUrl } from "@t3tools/client-runtime/zerops/serviceMap";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { Atom } from "effect/reactivity";
import { useCallback, useEffect, useMemo, useState } from "react";
import { create } from "zustand";

import { sameValue } from "~/lib/sameValue";
import { captureAccountLifetime } from "~/zerops/accountLifetime";
import { useAccountOperations, type AccountOperations } from "~/zerops/accountOperations";
import { useAddressesSheet, type AddressesSheetTarget } from "~/zerops/addressesSheet";
import { useProjectSitesOfGroup } from "~/zerops/projectPartsShown";
import { useDetailDemand, useProjection } from "~/zerops/ZeropsAccountData";
import { writeTrouble } from "~/zerops/zeropsWrite";

import { Dialog, DialogPopup } from "../../ui/dialog";
import {
  addressPlaces,
  addressTrouble,
  othersWaiting,
  withOwnWrites,
  writeKey,
  type AddressWrite,
} from "./addresses.logic";
import { AddressesSheetBody, type OwnIpv4Offer } from "./AddressesSheet";

interface PlaceKey {
  readonly orgId: string;
  readonly projectId: string;
}

const placeKeyOf = ({ orgId, projectId }: PlaceKey) => `${orgId}/${projectId}`;

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
            ? { state: "unavailable" }
            : {
                state: "known",
                price: offer.unitPrice,
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
});
const NO_FACTS = Atom.make<PlaceFacts>({ name: undefined, ipv4: { state: "reading" } });

/** Our writes in flight, by place and by the control they hold busy (`writeKey`). */
const useFlights = create<{
  readonly byPlace: Readonly<Record<string, Readonly<Record<string, AddressWrite>>>>;
  readonly start: (place: string, key: string, write: AddressWrite) => void;
  readonly end: (place: string, key: string) => void;
}>((set) => ({
  byPlace: {},
  start: (place, key, write) =>
    set((state) => ({
      byPlace: { ...state.byPlace, [place]: { ...state.byPlace[place], [key]: write } },
    })),
  end: (place, key) =>
    set((state) => {
      const { [key]: _ended, ...rest } = state.byPlace[place] ?? {};
      return { byPlace: { ...state.byPlace, [place]: rest } };
    }),
}));

const NO_FLIGHTS: Readonly<Record<string, AddressWrite>> = {};

type Intent = Parameters<AccountOperations["submit"]>[0];

/** What the person is told of a write Zerops did not take, or that ended failed. */
function troubleOf(progress: Parameters<typeof writeTrouble>[0], evidence: string | null) {
  if (progress.stage === "refused") return addressTrouble(progress.code) ?? progress.reason;
  return writeTrouble(progress, evidence);
}

/** One place's writes: each submitted, followed to its end, its trouble kept for its control. */
function useAddressWriter(place: PlaceKey) {
  const operations = useAccountOperations();
  const key = placeKeyOf(place);
  const flights = useFlights((state) => state.byPlace[key] ?? NO_FLIGHTS);
  const [trouble, setTrouble] = useState<ReadonlyMap<string, string>>(new Map());
  const say = useCallback((control: string, text: string | null) => {
    setTrouble((was) => {
      const next = new Map(was);
      if (text === null) next.delete(control);
      else next.set(control, text);
      return next;
    });
  }, []);
  const write = useCallback(
    async (write: AddressWrite): Promise<boolean> => {
      const control = writeKey(write);
      const { start, end, byPlace } = useFlights.getState();
      if (byPlace[key]?.[control] !== undefined) return false;
      // A sign-out mid-flight must not write state back onto the next account.
      const isCurrent = captureAccountLifetime();
      start(key, control, write);
      say(control, null);
      try {
        const { requestId, progress, evidence } = await operations.submit({
          ...write,
          orgId: place.orgId,
        } as Intent);
        const refused = troubleOf(progress, evidence);
        if (refused !== null) {
          end(key, control);
          if (isCurrent()) say(control, refused);
          return false;
        }
        void operations.untilEnd(requestId, place.orgId).then(
          (ended) => {
            end(key, control);
            if (isCurrent() && ended.stage !== "unobserved") say(control, troubleOf(ended, null));
          },
          (cause: unknown) => {
            end(key, control);
            if (isCurrent()) say(control, zeropsErrorMessage(cause));
          },
        );
        return true;
      } catch (cause) {
        end(key, control);
        if (isCurrent()) say(control, zeropsErrorMessage(cause));
        return false;
      }
    },
    [key, operations, place.orgId, say],
  );
  const own = useMemo(() => Object.values(flights), [flights]);
  const busy = useMemo(() => new Set(Object.keys(flights)), [flights]);
  return { own, busy, trouble, write };
}

/** How often "Checked 3 minutes ago" moves on. */
const CLOCK_MS = 30_000;

function useMinuteClock(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function AddressesSheetContainer({
  target,
  onClose,
}: {
  readonly target: AddressesSheetTarget;
  readonly onClose: () => void;
}) {
  const { orgId, projectId, groupId } = target;
  const key = useMemo(() => ({ orgId, projectId }), [orgId, projectId]);
  const read = useProjection(addresses, key, NOT_READ);
  useDetailDemand("publicRouting", PROJECT_ROUTINGS_LISTING, read.readsProject ? projectId : null);
  useDetailDemand("projectAddons", undefined, orgId);
  const facts = useProjection(placeFacts, key, NO_FACTS);
  const sites = useProjectSitesOfGroup(groupId);
  const nowMs = useMinuteClock();
  const places = useMemo(
    () => (sites === undefined ? [] : addressPlaces(sites, nowMs)),
    [nowMs, sites],
  );
  const { own, busy, trouble, write } = useAddressWriter(key);
  const place = useMemo(() => withOwnWrites(read, own), [own, read]);
  const others = useMemo(
    () => ({
      domains: othersWaiting(read.waitingDomains, own),
      ports: othersWaiting(read.waitingPorts, own),
    }),
    [own, read.waitingDomains, read.waitingPorts],
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
        zeropsUrl={zeropsProjectUrl(projectId)}
      />
    </DialogPopup>
  );
}

/**
 * The one addresses sheet, over whatever is on screen: the place the last door opened, until the
 * person closes it. The place stays drawn while the sheet leaves.
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
      open={target !== null}
    >
      {shown === null ? null : (
        <AddressesSheetContainer
          key={`${shown.orgId}/${shown.projectId}/${shown.intent ?? ""}`}
          onClose={close}
          target={shown}
        />
      )}
    </Dialog>
  );
}
