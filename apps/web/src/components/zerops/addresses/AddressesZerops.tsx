/**
 * The sheet's *Zerops addresses*: the free zerops.app address of each service that serves the
 * web, one row a service: its name, its address while that is on, and the switch. Turning one
 * off asks first and says what keeps working.
 */
import type { AddressDomain, PlaceAddresses, ZeropsAddress } from "@t3tools/client-runtime/data";
import { ArrowUpRightIcon } from "lucide-react";

import { Spinner } from "../../ui/spinner";
import { Switch } from "../../ui/switch";
import { keepsWorking } from "./addresses.logic";
import {
  Confirm,
  GroupBody,
  RealName,
  SheetGroup,
  SheetRow,
  SheetSection,
  Trouble,
  type SheetContext,
} from "./AddressesSheetBits";
import type { WebMode } from "./AddressesDomains";

export function AddressesZerops({
  ctx,
  place,
  mode,
  setMode,
}: {
  readonly ctx: SheetContext;
  readonly place: PlaceAddresses;
  readonly mode: WebMode;
  readonly setMode: (mode: WebMode) => void;
}) {
  if (place.zerops.length === 0) return null;
  return (
    <SheetSection
      caption="A free address for each service, good for trying things out. Anyone with the link can open it."
      part="zerops"
      title="Zerops addresses"
    >
      {place.zerops.map((address) => (
        <ZeropsRow
          address={address}
          ctx={ctx}
          domains={place.domains}
          key={address.serviceId}
          mode={mode}
          setMode={setMode}
        />
      ))}
    </SheetSection>
  );
}

function ZeropsRow({
  ctx,
  address,
  domains,
  mode,
  setMode,
}: {
  readonly ctx: SheetContext;
  readonly address: ZeropsAddress;
  readonly domains: ReadonlyArray<AddressDomain>;
  readonly mode: WebMode;
  readonly setMode: (mode: WebMode) => void;
}) {
  const key = `zerops:${address.serviceId}`;
  const busy = ctx.busy.has(key);
  const asking = mode.kind === "close-zerops" && mode.serviceId === address.serviceId;
  const keeps = keepsWorking(domains, address.serviceId);
  const label = `${address.serviceName}'s Zerops address`;
  const first = address.hosts[0];
  const trouble = ctx.trouble.get(key);
  const on = address.on && first !== undefined;
  return (
    <SheetGroup data={`zerops:${address.serviceName}`}>
      <SheetRow
        data={`zerops:${address.serviceName}`}
        more={
          <>
            {busy ? <Spinner aria-hidden="true" size="xs" tone="muted" /> : null}
            <Switch
              aria-label={label}
              // Asked to close, or being opened: the switch already says where it goes.
              checked={address.on ? !asking : busy}
              disabled={busy || ctx.hold}
              onCheckedChange={(on) => {
                if (!on) setMode({ kind: "close-zerops", serviceId: address.serviceId });
                else
                  void ctx.onWrite({
                    kind: "enable-subdomain-access",
                    projectId: ctx.projectId,
                    serviceId: address.serviceId,
                  });
              }}
            />
          </>
        }
        name={
          on ? (
            <span className="flex min-w-0 flex-wrap gap-x-3 font-normal">
              {address.hosts.map((host) => (
                <a
                  className="inline-flex min-w-0 items-center gap-1 hover:underline"
                  href={host.url}
                  key={host.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  <HostName host={host.host} service={address.serviceName} />
                  <ArrowUpRightIcon aria-hidden="true" className="size-3.25 shrink-0 opacity-60" />
                </a>
              ))}
            </span>
          ) : (
            <>
              <RealName>{address.serviceName}</RealName>
              <span className="font-normal text-muted-foreground">
                {busy ? "Turning on" : "Off"}
              </span>
            </>
          )
        }
      />
      {trouble === undefined && !asking ? null : (
        <GroupBody>
          <Trouble text={trouble} />
          {asking ? (
            <Confirm
              busy={busy}
              disabled={ctx.hold}
              cancel="Keep it on"
              confirm="Turn it off"
              onCancel={() => setMode({ kind: "list" })}
              onConfirm={() => {
                void ctx
                  .onWrite({
                    kind: "disable-subdomain-access",
                    projectId: ctx.projectId,
                    serviceId: address.serviceId,
                  })
                  .then((taken) => {
                    if (taken) ctx.settle(mode);
                  });
              }}
              title={`Turn off ${first?.host ?? label}?`}
            >
              <p>
                Anyone using it gets nothing from now on.{" "}
                {keeps.length === 0 ? (
                  `${address.serviceName} then answers only inside ${ctx.placeName}, until you turn it on again.`
                ) : (
                  <>
                    {keeps.map((name, index) => (
                      <span key={name}>
                        {index === 0 ? "" : index === keeps.length - 1 ? " and " : ", "}
                        <b className="font-medium text-foreground">{name}</b>
                      </span>
                    ))}{" "}
                    {keeps.length === 1 ? "keeps" : "keep"} working.
                  </>
                )}
              </p>
            </Confirm>
          ) : null}
        </GroupBody>
      )}
    </SheetGroup>
  );
}

/**
 * A service's zerops.app address with the service's own name in ink at its head, where the
 * platform puts it, and the rest quieter: the row names its service without saying it twice. On
 * a phone the address reads whole a size down.
 */
function HostName({ host, service }: { readonly host: string; readonly service: string }) {
  const named = host.startsWith(`${service}-`) || host.startsWith(`${service}.`);
  return (
    <span className="real-name min-w-0 truncate max-sm:text-xs">
      <span className="font-medium">{named ? service : host}</span>
      {named ? <span className="text-muted-foreground">{host.slice(service.length)}</span> : null}
    </span>
  );
}
