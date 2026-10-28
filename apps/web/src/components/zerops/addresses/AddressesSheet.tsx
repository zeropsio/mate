/**
 * One place's addresses (board "Mate Addresses Sheet", layout (a) "By kind", the owner,
 * 2026-10-14): every way the internet reaches one Zerops project — production, a stage or a
 * Mate's own — in three sections, *Web addresses*, *IP addresses* and *Direct access*, each change
 * asked or filled in inline. The switch at its top moves between the application's places.
 *
 * Presentational: the place as the `addresses` projection reads it, with our writes in flight
 * already shown on it (`withOwnWrites`), and one callback that writes. The container holds the
 * reads and the operations (`AddressesSheetContainer`).
 */
import type { PlaceAddresses, WaitingChange } from "@t3tools/client-runtime/data";
import { ChevronDownIcon, CreditCardIcon, XIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "../../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../ui/menu";
import { Spinner } from "../../ui/spinner";
import { ZeropsMark } from "../../ZeropsMark";
import { priceWords, type AddressWrite, type PlaceChoice } from "./addresses.logic";
import { AddressesDirect, type DirectMode } from "./AddressesDirect";
import {
  Confirm,
  CopyButton,
  Face,
  RowKind,
  RowMeta,
  SheetRow,
  SheetSection,
  Trouble,
  type SheetContext,
} from "./AddressesSheetBits";
import { AddressesWeb, type WebMode } from "./AddressesWeb";

/** The project's own IPv4 as billing offers it. */
export type OwnIpv4Offer =
  | { readonly state: "reading" }
  /** Billing refuses the viewer, or names no price for the project. */
  | { readonly state: "unavailable"; readonly enabled?: boolean }
  | {
      readonly state: "known";
      /** Its price for 30 days. */
      readonly price: number;
      /** When the period it is paid for ends. */
      readonly validTill?: string;
      /** Billing has it on: it is the project's, or on its way. */
      readonly enabled: boolean;
    };

export interface AddressesSheetBodyProps {
  /** The application's name, or the place's own outside one: "Shop". */
  readonly projectName: string;
  readonly placeName: string;
  readonly projectId: string;
  /** The application's places; one or none, and there is no switch. */
  readonly places: ReadonlyArray<PlaceChoice>;
  readonly onPlace: (projectId: string) => void;
  readonly place: PlaceAddresses;
  /** Changes waiting to go live that are not ours, by kind. */
  readonly othersWaiting: {
    readonly domains: ReadonlyArray<WaitingChange>;
    readonly ports: ReadonlyArray<WaitingChange>;
  };
  readonly ipv4: OwnIpv4Offer;
  readonly busy: ReadonlySet<string>;
  readonly trouble: ReadonlyMap<string, string>;
  /** Writes whose answer was lost, by `writeKey`: they may have landed. */
  readonly unsure: ReadonlySet<string>;
  /** Opened to add a domain: the sheet starts in its field. */
  readonly startAdding: boolean;
  /** The place in Zerops, where what Mate cannot do here is done. */
  readonly zeropsUrl: string;
  readonly onWrite: (write: AddressWrite) => Promise<boolean>;
  readonly onClose: () => void;
  readonly nowMs: number;
}

type IpMode = { readonly kind: "list" } | { readonly kind: "ipv4" };

/** One change asked or filled in at a time, wherever in the sheet it is. */
type Mode = WebMode | DirectMode | IpMode;

export function AddressesSheetBody(props: AddressesSheetBodyProps) {
  const [mode, setMode] = useState<Mode>(
    props.startAdding ? { kind: "add-domain" } : { kind: "list" },
  );
  const ctx: SheetContext = {
    projectId: props.projectId,
    placeName: props.placeName,
    projectName: props.projectName,
    busy: props.busy,
    trouble: props.trouble,
    onWrite: props.onWrite,
    settle: (asked) => setMode((current) => (current === asked ? LIST : current)),
    hold: props.place.state !== "ready",
    nowMs: props.nowMs,
  };
  const web = isWeb(mode) ? mode : LIST;
  const direct = isDirect(mode) ? mode : LIST;
  // Production or a stage that runs nothing deployed has no address to manage yet: no own IPv4 to
  // buy, no port to open. A Mate's own project is left as it is: its workspace runs without one.
  const kind = props.places.find((place) => place.projectId === props.projectId)?.kind;
  const runsNothing = props.place.nothingDeployed && (kind === "production" || kind === "stage");
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-addresses-sheet={props.projectId}>
      <SheetHeader {...props} />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-1.5 pb-10">
        {props.place.state === "failed" ? (
          <p className="py-6 text-muted-foreground text-sm">
            You can't see {props.placeName}'s addresses.
          </p>
        ) : runsNothing ? (
          <p className="py-6 text-muted-foreground text-sm">
            Nothing runs in {props.placeName} yet.
          </p>
        ) : props.place.state === "reading" && props.place.domains.length === 0 ? (
          <p className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
            <Spinner aria-hidden="true" size="sm" tone="muted" />
            Reading {props.placeName}'s addresses…
          </p>
        ) : (
          <div className="grid gap-7">
            {ctx.hold ? (
              <p className="flex items-center gap-2 text-muted-foreground text-sm">
                <Spinner aria-hidden="true" size="sm" tone="muted" />
                Still reading {props.placeName}'s addresses. Changes wait until it's read.
              </p>
            ) : null}
            <AddressesWeb
              ctx={ctx}
              mode={web}
              onOwnIpv4={
                props.place.ips.ownV4 === undefined ? () => setMode({ kind: "ipv4" }) : undefined
              }
              othersWaiting={props.othersWaiting.domains}
              place={props.place}
              setMode={setMode}
            />
            <IpSection
              ctx={ctx}
              ipv4={props.ipv4}
              mode={mode}
              place={props.place}
              setMode={setMode}
              unsure={props.unsure.has("request-ipv4")}
              zeropsUrl={props.zeropsUrl}
            />
            <AddressesDirect
              ctx={ctx}
              mode={direct}
              othersWaiting={props.othersWaiting.ports}
              place={props.place}
              setMode={setMode}
            />
          </div>
        )}
      </div>
    </div>
  );
}

const LIST = { kind: "list" } as const;

const isWeb = (mode: Mode): mode is WebMode =>
  mode.kind === "add-domain" || mode.kind === "remove" || mode.kind === "close-zerops";

const isDirect = (mode: Mode): mode is DirectMode =>
  mode.kind === "open-port" || mode.kind === "change-port" || mode.kind === "close-port";

function SheetHeader({
  projectName,
  placeName,
  projectId,
  places,
  onPlace,
  onClose,
}: AddressesSheetBodyProps) {
  const current = places.find((place) => place.projectId === projectId)?.label ?? placeName;
  return (
    <div className="flex shrink-0 items-center gap-2.5 py-4 ps-6 pe-4">
      <h2 className="truncate font-semibold text-lg">{projectName}'s addresses</h2>
      {places.length > 1 ? (
        <Menu>
          <MenuTrigger
            render={<Button aria-label={`Place: ${current}`} size="sm" variant="secondary" />}
          >
            {current}
            <ChevronDownIcon />
          </MenuTrigger>
          <MenuPopup align="start">
            {places.map((place) => (
              <MenuItem
                disabled={place.projectId === projectId}
                key={place.projectId}
                onClick={() => onPlace(place.projectId)}
              >
                {place.label}
                {place.owner === undefined ? null : (
                  <span className="text-muted-foreground text-xs">· {place.owner}'s</span>
                )}
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      ) : current === projectName ? null : (
        <span className="truncate text-muted-foreground text-sm">{current}</span>
      )}
      <span className="grow" />
      <Button aria-label="Close" onClick={onClose} size="icon-sm" variant="ghost">
        <XIcon />
      </Button>
    </div>
  );
}

function IpSection({
  ctx,
  place,
  ipv4,
  mode,
  setMode,
  unsure,
  zeropsUrl,
}: {
  readonly ctx: SheetContext;
  readonly place: PlaceAddresses;
  readonly ipv4: OwnIpv4Offer;
  readonly mode: Mode;
  /** Our purchase's answer was lost: it may have landed. */
  readonly unsure: boolean;
  readonly setMode: (mode: Mode) => void;
  readonly zeropsUrl: string;
}) {
  const { ips } = place;
  const price = ipv4.state === "known" ? priceWords(ipv4.price) : undefined;
  const every = price === undefined ? "" : ` · ${price} every 30 days`;
  const perPeriod = price === undefined ? "" : ` · ${price} / 30 days`;
  const asking = mode.kind === "ipv4";
  // Billing has it on, or our purchase is under way: the address is on its way, never offered again.
  const assigning =
    ips.ownV4 === undefined &&
    (ctx.busy.has("request-ipv4") || (ipv4.state !== "reading" && ipv4.enabled === true));
  const maybe = ips.ownV4 === undefined && !assigning && unsure;
  return (
    <SheetSection
      after={
        <>
          {ips.ownV4 === undefined ? null : (
            <p className="flex flex-wrap items-center gap-x-2 text-muted-foreground text-xs">
              Your own IPv4 renews on its own; turn it off in Zerops to stop it.
              <OpenInZerops url={zeropsUrl} />
            </p>
          )}
        </>
      }
      part="ip"
      title="IP addresses"
    >
      {ips.v6 === undefined ? null : (
        <SheetRow
          data="ipv6"
          end={
            <>
              <RowMeta>Free</RowMeta>
              <CopyButton value={ips.v6} />
            </>
          }
          name={
            <>
              <RowKind>IPv6</RowKind>
              <span className="truncate font-mono">{ips.v6}</span>
            </>
          }
        />
      )}
      {ips.ownV4 === undefined ? null : (
        <SheetRow
          data="own-ipv4"
          end={
            <>
              <RowMeta>{`Yours${perPeriod}${paidUntil(ipv4.state === "known" ? ipv4.validTill : undefined)}`}</RowMeta>
              <CopyButton value={ips.ownV4} />
            </>
          }
          name={
            <>
              <RowKind>IPv4</RowKind>
              <span className="truncate font-mono">{ips.ownV4}</span>
            </>
          }
        />
      )}
      {ips.sharedV4 === undefined ? null : (
        <SheetRow
          data="shared-ipv4"
          end={
            <>
              <RowMeta>Shared across Zerops · web only</RowMeta>
              <CopyButton value={ips.sharedV4} />
            </>
          }
          name={
            <>
              <RowKind>IPv4</RowKind>
              <span className="truncate font-mono">{ips.sharedV4}</span>
            </>
          }
        />
      )}
      {ips.ownV4 !== undefined ? null : (
        <SheetRow
          data="get-ipv4"
          end={
            assigning ? (
              <Face tone="busy" word="Assigning" />
            ) : maybe ? (
              <OpenInZerops url={zeropsUrl} />
            ) : asking ? (
              <Face tone="warn" word="Confirm below" />
            ) : (
              <>
                {price === undefined ? null : <RowMeta>{`${price} / 30 days`}</RowMeta>}
                <Button
                  disabled={ctx.hold}
                  onClick={() => setMode({ kind: "ipv4" })}
                  size="sm"
                  variant="secondary"
                >
                  Get one
                </Button>
              </>
            )
          }
          name={
            <>
              <RowKind>IPv4</RowKind>
              <span className="truncate">Your own</span>
              {assigning ? (
                <RowMeta>{`On its way${perPeriod}`}</RowMeta>
              ) : maybe ? (
                <RowMeta>It may be on its way: Zerops's answer was lost.</RowMeta>
              ) : (
                <RowMeta>For direct IPv4 access</RowMeta>
              )}
            </>
          }
        />
      )}
      <Trouble text={ctx.trouble.get("request-ipv4")} />
      {asking && ips.ownV4 === undefined && !assigning && !maybe ? (
        <Confirm
          busy={ctx.busy.has("request-ipv4")}
          cancel="Cancel"
          confirm={price === undefined ? "Get it" : `Get it for ${price}`}
          disabled={price === undefined || ctx.hold}
          icon={<CreditCardIcon />}
          onCancel={() => setMode({ kind: "list" })}
          onConfirm={() => {
            void ctx.onWrite({ kind: "request-ipv4", projectId: ctx.projectId }).then((taken) => {
              if (taken) ctx.settle(mode);
            });
          }}
          title={`Get your own IPv4 for ${ctx.placeName}${every}`}
          tone="default"
        >
          {ipv4.state === "reading" ? (
            <p>Reading its price…</p>
          ) : price === undefined ? (
            <p>
              Its price can't be read here. Check it in Zerops before you buy.{" "}
              <OpenInZerops url={zeropsUrl} />
            </p>
          ) : (
            <p>
              It renews on its own every 30 days and can't be refunded. It's paid from purchased
              credit; promo credit doesn't count. To stop renewing it, turn it off in Zerops.
            </p>
          )}
          <p className="text-xs">Only admins can buy it.</p>
        </Confirm>
      ) : null}
    </SheetSection>
  );
}

const paidUntil = (validTill: string | undefined) => {
  if (validTill === undefined) return "";
  const at = new Date(validTill);
  if (Number.isNaN(at.getTime())) return "";
  return ` · paid until ${at.toLocaleDateString("en", { month: "short", day: "numeric" })}`;
};

function OpenInZerops({ url }: { readonly url: string }): ReactNode {
  return (
    <Button render={<a href={url} rel="noreferrer" target="_blank" />} size="sm" variant="link">
      <ZeropsMark className="size-3.25" />
      Open in Zerops
    </Button>
  );
}
