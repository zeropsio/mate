/**
 * The sheet's *Direct access*: the ports a place opens straight to the internet, for connections
 * that aren't web pages, each with who may connect in plain words; *Open a port* and *Change who
 * can connect* as one inline form, closing one asking first. Who may connect is checked before
 * anything is sent: an IPv6 port takes only IPv6 ranges, a bare address is that address alone.
 */
import type {
  DirectPort,
  PlaceAddresses,
  ServicePortChoice,
  WaitingChange,
} from "@t3tools/client-runtime/data";
import { EllipsisIcon, PlusIcon, ShieldIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "../../ui/button";
import { EmptyState } from "../../ui/empty";
import { Failure } from "../../ui/failure";
import { Input } from "../../ui/input";
import { Loading } from "../../ui/loading";
import { Label } from "../../ui/label";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../ui/menu";
import { Radio, RadioGroup } from "../../ui/radio-group";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { Spinner } from "../../ui/spinner";
import {
  firewallWords,
  normalizeRange,
  portFaceWords,
  portProblem,
  type IpType,
} from "./addresses.logic";
import {
  Confirm,
  Face,
  guardPress,
  guardTitle,
  OthersList,
  RowMeta,
  SheetRow,
  SheetSection,
  Trouble,
  useRevealed,
  type SheetContext,
} from "./AddressesSheetBits";
import { WaitingNotice } from "./AddressesWeb";

export type DirectMode =
  | { readonly kind: "list" }
  | { readonly kind: "open-port" }
  | { readonly kind: "change-port"; readonly portId: string }
  | { readonly kind: "close-port"; readonly portId: string };

type Who = "only" | "except" | "everyone";

const whoOf = (port: DirectPort): Who =>
  port.firewallPolicy === "WHITELIST" ? "only" : port.ranges.length === 0 ? "everyone" : "except";

export function AddressesDirect({
  ctx,
  place,
  othersWaiting,
  mode,
  setMode,
}: {
  readonly ctx: SheetContext;
  readonly place: PlaceAddresses;
  readonly othersWaiting: ReadonlyArray<WaitingChange>;
  readonly mode: DirectMode;
  readonly setMode: (mode: DirectMode) => void;
}) {
  const oursUnderWay =
    ctx.busy.has("open-port") ||
    ctx.busy.has("publish-ports") ||
    [...ctx.busy].some((key) => key.startsWith("port:"));
  const changing =
    mode.kind === "change-port" ? place.ports.find((port) => port.id === mode.portId) : undefined;
  const opening = mode.kind === "open-port";
  const read = place.portsState === "ready";
  return (
    <SheetSection
      action={
        !read || opening || place.portTargets.length === 0 ? null : (
          <Button
            disabled={ctx.hold}
            onClick={() => setMode({ kind: "open-port" })}
            size="sm"
            variant="ghost-primary"
          >
            <PlusIcon />
            Open a port
          </Button>
        )
      }
      after={
        opening ? (
          <PortForm
            ctx={ctx}
            onDone={() => setMode({ kind: "list" })}
            onTaken={() => ctx.settle(mode)}
            othersWaiting={othersWaiting}
            ownV4={place.ips.ownV4 !== undefined}
            port={undefined}
            ports={place.ports}
            targets={place.portTargets}
          />
        ) : (
          <Trouble text={ctx.trouble.get("open-port")} />
        )
      }
      notice={
        read && othersWaiting.length > 0 ? (
          <WaitingNotice
            busy={ctx.busy.has("publish-ports")}
            held={ctx.hold}
            kind="port"
            onPublish={
              oursUnderWay
                ? undefined
                : () => void ctx.onWrite({ kind: "publish-ports", projectId: ctx.projectId })
            }
            others={othersWaiting}
            placeName={ctx.placeName}
            trouble={ctx.trouble.get("publish-ports")}
          />
        ) : null
      }
      part="direct"
      title="Direct access"
    >
      {place.portsState === "failed" ? (
        <Failure cause={`You can't see ${ctx.placeName}'s open ports.`} />
      ) : place.portsState === "reading" ? (
        <Loading count={1} label={`${ctx.placeName}'s open ports`} shape="rows" />
      ) : (
        <>
          {place.ports.map((port) =>
            changing?.id === port.id ? (
              <PortForm
                ctx={ctx}
                key={port.id}
                onDone={() => setMode({ kind: "list" })}
                onTaken={() => ctx.settle(mode)}
                othersWaiting={othersWaiting}
                ownV4={place.ips.ownV4 !== undefined}
                port={port}
                ports={place.ports}
                targets={place.portTargets}
              />
            ) : (
              <PortRow
                ctx={ctx}
                key={port.id}
                mode={mode}
                othersWaiting={othersWaiting}
                port={port}
                setMode={setMode}
              />
            ),
          )}
          {place.ports.length > 0 || opening ? null : (
            <EmptyState size="row">
              {place.portTargets.length === 0
                ? `None of ${ctx.placeName}'s services can open a port directly.`
                : "No open ports. Open one to let a database client connect."}
            </EmptyState>
          )}
        </>
      )}
    </SheetSection>
  );
}

function PortRow({
  ctx,
  port,
  mode,
  setMode,
  othersWaiting,
}: {
  readonly ctx: SheetContext;
  readonly port: DirectPort;
  readonly mode: DirectMode;
  readonly setMode: (mode: DirectMode) => void;
  readonly othersWaiting: ReadonlyArray<WaitingChange>;
}) {
  const key = `port:${port.id}`;
  const asking = mode.kind === "close-port" && mode.portId === port.id;
  const own = port.id.startsWith("own:");
  const face = portFaceWords(port.face);
  const udp = port.internalProtocol === "udp" ? " · UDP" : "";
  return (
    <>
      <SheetRow
        data={`port:${port.publicPort}`}
        end={
          port.face === "live" ? (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-muted-foreground text-xs">
              <ShieldIcon aria-hidden="true" className="size-3.5" />
              {firewallWords(port.firewallPolicy, port.ranges)}
            </span>
          ) : (
            <Face {...face} />
          )
        }
        more={
          own || port.face === "removing" ? null : (
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    aria-label={`More for port ${port.publicPort}`}
                    size="icon-md"
                    variant="ghost-muted"
                  />
                }
              >
                <EllipsisIcon />
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuItem
                  disabled={ctx.hold}
                  onClick={() => setMode({ kind: "change-port", portId: port.id })}
                >
                  Change who can connect
                </MenuItem>
                <MenuItem
                  disabled={ctx.hold}
                  onClick={() => setMode({ kind: "close-port", portId: port.id })}
                  variant="destructive"
                >
                  Close port {port.publicPort}
                </MenuItem>
              </MenuPopup>
            </Menu>
          )
        }
        name={
          <>
            <span className="truncate font-mono">{port.address ?? `port ${port.publicPort}`}</span>
            <RowMeta>
              → {port.serviceName} · port {port.internalPort}
              {udp}
            </RowMeta>
          </>
        }
      />
      <Trouble text={ctx.trouble.get(key)} />
      {asking ? (
        <Confirm
          busy={ctx.busy.has(key)}
          disabled={ctx.hold}
          cancel="Keep it open"
          confirm={
            othersWaiting.length === 0
              ? `Close port ${port.publicPort}`
              : guardPress("Close", othersWaiting.length)
          }
          destructive
          onCancel={() => setMode({ kind: "list" })}
          onConfirm={() => {
            void ctx
              .onWrite({ kind: "close-port", projectId: ctx.projectId, portRoutingId: port.id })
              .then((taken) => {
                if (taken) ctx.settle(mode);
              });
          }}
          title={
            othersWaiting.length === 0
              ? `Close port ${port.publicPort}?`
              : guardTitle(`Closing port ${port.publicPort}`, othersWaiting.length)
          }
        >
          <p>Anything connecting through it gets nothing from now on.</p>
          {othersWaiting.length === 0 ? null : (
            <OthersList kind="port" others={othersWaiting} placeName={ctx.placeName} />
          )}
        </Confirm>
      ) : null}
    </>
  );
}

const targetValue = (target: Pick<ServicePortChoice, "serviceId" | "port"> | undefined) =>
  target === undefined ? "" : `${target.serviceId}:${target.port}`;

/** *Open a port*, or — given one — *Change who can connect* to it. */
function PortForm({
  ctx,
  port,
  ports,
  targets,
  ownV4,
  othersWaiting,
  onDone,
  onTaken,
}: {
  readonly ctx: SheetContext;
  readonly port: DirectPort | undefined;
  readonly ports: ReadonlyArray<DirectPort>;
  readonly targets: ReadonlyArray<ServicePortChoice>;
  readonly ownV4: boolean;
  readonly othersWaiting: ReadonlyArray<WaitingChange>;
  readonly onDone: () => void;
  readonly onTaken: () => void;
}) {
  const revealed = useRevealed<HTMLFormElement>();
  const id = useId();
  const [target, setTarget] = useState(() =>
    targetValue(
      port === undefined ? targets[0] : { serviceId: port.serviceId, port: port.internalPort },
    ),
  );
  const chosen = targets.find((each) => targetValue(each) === target) ?? targets[0];
  // A change keeps the port's own IP type: the form offers no other.
  const [ipType, setIpType] = useState<IpType>(
    port === undefined ? "IP_V6" : port.publicIpType === "IP_V4" ? "IP_V4" : "IP_V6",
  );
  // The service's own port where it is free on IPv6, else the person picks one.
  const [publicPort, setPublicPort] = useState(() => {
    const proposed = port?.publicPort ?? chosen?.port;
    return proposed === undefined || portProblem(String(proposed), "IP_V6", ports, port?.publicPort)
      ? ""
      : String(proposed);
  });
  const [who, setWho] = useState<Who>(port === undefined ? "only" : whoOf(port));
  const [ranges, setRanges] = useState<ReadonlyArray<string>>(
    port === undefined || port.ranges.length === 0 ? [""] : port.ranges,
  );
  const [problems, setProblems] = useState<ReadonlyArray<string>>([]);
  const [guarding, setGuarding] = useState(false);
  const key = port === undefined ? "open-port" : `port:${port.id}`;
  const busy = ctx.busy.has(key);

  const submit = () => {
    const found: string[] = [];
    const portWords = portProblem(publicPort, ipType, ports, port?.publicPort);
    if (portWords !== null) found.push(portWords);
    const typed = who === "everyone" ? [] : ranges.filter((range) => range.trim() !== "");
    const read = typed.map((range) => normalizeRange(range, ipType));
    for (const each of read) if (!each.ok) found.push(each.problem);
    if (who === "only" && typed.length === 0)
      found.push("Add at least one address, or choose Everyone.");
    const internal = port?.internalPort ?? chosen?.port;
    const serviceId = port?.serviceId ?? chosen?.serviceId;
    if (internal === undefined || serviceId === undefined) found.push("Choose a service.");
    setProblems(found);
    if (found.length > 0 || internal === undefined || serviceId === undefined) return;
    if (othersWaiting.length > 0 && !guarding) {
      setGuarding(true);
      return;
    }
    const write = {
      projectId: ctx.projectId,
      serviceId,
      publicIpType: ipType,
      publicPort: Number(publicPort.trim()),
      internalPort: internal,
      internalProtocol:
        (port?.internalProtocol ?? chosen?.protocol ?? "tcp") === "udp"
          ? ("udp" as const)
          : ("tcp" as const),
      firewallPolicy: who === "only" ? ("WHITELIST" as const) : ("BLACKLIST" as const),
      firewallIpRanges: read.flatMap((each) => (each.ok ? [each.range] : [])),
    };
    void ctx
      .onWrite(
        port === undefined
          ? { kind: "open-port", ...write }
          : { kind: "change-port", portRoutingId: port.id, ...write },
      )
      .then((taken) => {
        setGuarding(false);
        if (taken) onTaken();
      });
  };

  // Who is named sits under the choice that names them: only them, or everyone but them.
  const rangesList = (
    <div className="grid gap-1.5 ps-6">
      {ranges.map((range, index) => (
        // The list is the person's own, edited in place: its order is its identity.
        // oxlint-disable-next-line react/no-array-index-key
        <div className="flex items-center gap-1.5" key={index}>
          <Input
            aria-label={`Address ${index + 1}`}
            font="mono"
            onChange={(event) => {
              const next = [...ranges];
              next[index] = event.target.value;
              setRanges(next);
              setGuarding(false);
            }}
            placeholder={ipType === "IP_V6" ? "e.g. 2001:db8::1" : "e.g. 198.51.100.20"}
            spellCheck={false}
            value={range}
          />
          <Button
            aria-label={`Remove address ${index + 1}`}
            onClick={() => setRanges(ranges.filter((_, at) => at !== index))}
            size="icon-md"
            type="button"
            variant="ghost-muted"
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <div>
        <Button onClick={() => setRanges([...ranges, ""])} size="sm" type="button" variant="ghost">
          <PlusIcon />
          Add an address
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        {ipType === "IP_V6"
          ? "IPv6 addresses only. A bare address means that address alone (/128)."
          : "IPv4 addresses only. A bare address means that address alone (/32)."}
      </p>
    </div>
  );
  const number = publicPort.trim() === "" ? "" : ` ${publicPort.trim()}`;
  const press = port === undefined ? `Open port${number}` : "Save";
  return (
    <form
      className={
        port === undefined
          ? "grid gap-3 rounded-xl border border-border/70 bg-card px-3.5 py-3 text-sm"
          : "grid gap-3 border-t border-border/60 py-3 text-sm first:border-t-0"
      }
      data-addresses-form={port === undefined ? "open-port" : "change-port"}
      ref={revealed}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="font-medium">
        {port === undefined ? "Open a port" : `Who can connect to port ${port.publicPort}`}
      </div>
      {port === undefined ? (
        <div className="grid grid-cols-[minmax(0,1fr)_auto_7rem] items-end gap-3">
          <div className="grid gap-1.5">
            <Label>Service</Label>
            <Select
              items={targets.map((each) => ({
                value: targetValue(each),
                label: `${each.serviceName} · port ${each.port}`,
              }))}
              onValueChange={(value) => {
                if (typeof value !== "string") return;
                setTarget(value);
                const next = targets.find((each) => targetValue(each) === value);
                if (next !== undefined) setPublicPort(String(next.port));
              }}
              value={target}
            >
              <SelectTrigger aria-label="Service">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {targets.map((each) => (
                  <SelectItem key={targetValue(each)} value={targetValue(each)}>
                    {each.serviceName} · port {each.port}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>On</Label>
            <RadioGroup
              aria-label="On"
              className="flex-row"
              onValueChange={(value) => setIpType(value === "IP_V4" ? "IP_V4" : "IP_V6")}
              value={ipType}
            >
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm h-8">
                <Radio value="IP_V6" />
                IPv6 · free
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm h-8">
                <Radio disabled={!ownV4} value="IP_V4" />
                IPv4 · needs your own
              </label>
            </RadioGroup>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-port`}>Public port</Label>
            <Input
              id={`${id}-port`}
              inputMode="numeric"
              onChange={(event) => setPublicPort(event.target.value)}
              value={publicPort}
            />
          </div>
        </div>
      ) : null}
      {port === undefined ? (
        <p className="text-muted-foreground text-xs">
          {ipType === "IP_V6" ? "An IPv6 port is reachable only from networks with IPv6. " : ""}
          {ownV4 ? "" : `IPv4 needs ${ctx.placeName}'s own IPv4. `}
          80 and 443 are kept for web addresses.
        </p>
      ) : null}
      <div className="grid gap-2">
        <Label>Who can connect</Label>
        <RadioGroup
          aria-label="Who can connect"
          onValueChange={(value) =>
            setWho(value === "except" ? "except" : value === "everyone" ? "everyone" : "only")
          }
          value={who}
        >
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
            <Radio value="only" />
            <span>
              <b className="font-medium">Only these addresses</b>{" "}
              <span className="text-muted-foreground text-xs">Recommended for a database.</span>
            </span>
          </label>
          {who === "only" ? rangesList : null}
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
            <Radio value="except" />
            <b className="font-medium">Everyone except these addresses</b>
          </label>
          {who === "except" ? rangesList : null}
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
            <Radio value="everyone" />
            <span>
              <b className="font-medium">Everyone</b>{" "}
              <span className="text-muted-foreground text-xs">
                Anyone on the internet can try to connect.
              </span>
            </span>
          </label>
        </RadioGroup>
      </div>
      {problems.length === 0 ? null : (
        <ul className="grid gap-0.5 text-destructive-foreground text-xs" role="alert">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      <Trouble text={ctx.trouble.get(key)} />
      {guarding && othersWaiting.length > 0 ? (
        <Confirm
          busy={busy}
          disabled={ctx.hold}
          cancel="Cancel"
          confirm={guardPress(null, othersWaiting.length)}
          onCancel={() => setGuarding(false)}
          onConfirm={submit}
          title={guardTitle(
            port === undefined
              ? `Opening port ${publicPort.trim()}`
              : `Changing port ${port.publicPort}`,
            othersWaiting.length,
          )}
        >
          <OthersList kind="port" others={othersWaiting} placeName={ctx.placeName} />
        </Confirm>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy || ctx.hold} size="md" type="submit">
            {busy ? <Spinner aria-hidden="true" /> : null}
            {press}
          </Button>
          <Button onClick={onDone} size="md" type="button" variant="ghost">
            Cancel
          </Button>
        </div>
      )}
    </form>
  );
}
