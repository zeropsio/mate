/**
 * The sheet's *Web addresses*: the place's own domains, each with how far it is from answering and
 * — while it waits for the person's DNS — exactly the records it needs; each service's zerops.app
 * address and its switch; and *Add your domain*, the add flow inline (board "Mate Domain Doors",
 * option 2). Closing an address or removing a domain asks first, and a write that would put
 * somebody else's waiting change live names it before it does.
 */
import type {
  AddressDomain,
  PlaceAddresses,
  ServicePortChoice,
  WaitingChange,
  ZeropsAddress,
} from "@t3tools/client-runtime/data";
import { ArrowUpRightIcon, ChevronRightIcon, EllipsisIcon, PlusIcon } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "../../ui/button";
import { Checkbox } from "../../ui/checkbox";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { Spinner } from "../../ui/spinner";
import { Switch } from "../../ui/switch";
import {
  checkedWords,
  domainFaceWords,
  removeWaitsFor,
  domainProblem,
  domainsToAdd,
  keepsWorking,
  normalizeDomain,
  recordsOf,
  removeWrite,
  wwwTwin,
} from "./addresses.logic";
import {
  Confirm,
  Face,
  guardPress,
  guardTitle,
  OthersList,
  RowMeta,
  SheetEmpty,
  SheetRow,
  SheetSection,
  Trouble,
  useRevealed,
  type SheetContext,
} from "./AddressesSheetBits";
import { DnsRecords } from "./DnsRecords";

export type WebMode =
  | { readonly kind: "list" }
  | { readonly kind: "add-domain" }
  | { readonly kind: "remove"; readonly domainName: string }
  | { readonly kind: "close-zerops"; readonly serviceId: string };

/** The domains a routing holds, in the order the sheet lists them: by its first domain. */
function byRouting(domains: ReadonlyArray<AddressDomain>) {
  const groups = new Map<string, AddressDomain[]>();
  for (const domain of domains) {
    const group = groups.get(domain.routingId);
    if (group === undefined) groups.set(domain.routingId, [domain]);
    else group.push(domain);
  }
  return [...groups.values()].map((group) =>
    group.toSorted((left, right) => left.domainName.length - right.domainName.length),
  );
}

const targetWords = (domain: AddressDomain) => {
  const first = domain.targets[0];
  return first === undefined ? "" : `→ ${first.serviceName} · port ${first.port}`;
};

const NEEDS_RECORDS = new Set<AddressDomain["face"]>(["going-live", "dns", "elsewhere"]);

export function AddressesWeb({
  ctx,
  place,
  othersWaiting,
  mode,
  setMode,
  onOwnIpv4,
}: {
  readonly ctx: SheetContext;
  readonly place: PlaceAddresses;
  readonly othersWaiting: ReadonlyArray<WaitingChange>;
  readonly mode: WebMode;
  readonly setMode: (mode: WebMode) => void;
  /** Takes the person to *Get your own IPv4*, an "Other way" of a domain's records. */
  readonly onOwnIpv4: (() => void) | undefined;
}) {
  const oursUnderWay =
    ctx.busy.has("add-domain") ||
    ctx.busy.has("publish-domains") ||
    [...ctx.busy].some((key) => key.startsWith("remove:"));
  const adding = mode.kind === "add-domain";
  return (
    <SheetSection
      action={
        adding || place.webTargets.length === 0 ? null : (
          <Button
            disabled={ctx.hold}
            onClick={() => setMode({ kind: "add-domain" })}
            size="xs"
            variant="ghost-primary"
          >
            <PlusIcon />
            Add your domain
          </Button>
        )
      }
      after={
        adding ? (
          <AddDomainForm
            ctx={ctx}
            existing={place.domains.map((domain) => domain.domainName)}
            onDone={() => setMode({ kind: "list" })}
            onTaken={() => ctx.settle(mode)}
            othersWaiting={othersWaiting}
            targets={place.webTargets}
          />
        ) : (
          <Trouble text={ctx.trouble.get("add-domain")} />
        )
      }
      notice={
        othersWaiting.length > 0 ? (
          <WaitingNotice
            busy={ctx.busy.has("publish-domains")}
            held={ctx.hold}
            kind="domain"
            onPublish={
              oursUnderWay
                ? undefined
                : () => void ctx.onWrite({ kind: "publish-domains", projectId: ctx.projectId })
            }
            others={othersWaiting}
            placeName={ctx.placeName}
            trouble={ctx.trouble.get("publish-domains")}
          />
        ) : null
      }
      part="web"
      title="Web addresses"
    >
      {byRouting(place.domains).map((group) => (
        <RoutingRows
          ctx={ctx}
          group={group}
          ips={place.ips}
          key={group[0]!.routingId}
          mode={mode}
          onOwnIpv4={onOwnIpv4}
          othersWaiting={othersWaiting}
          setMode={setMode}
        />
      ))}
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
      {place.domains.length === 0 && place.zerops.length === 0 ? (
        <SheetEmpty>
          {place.webTargets.length === 0
            ? `Nothing in ${ctx.placeName} serves web pages yet.`
            : `${ctx.placeName} has no web address yet.`}
        </SheetEmpty>
      ) : null}
    </SheetSection>
  );
}

/** Changes made elsewhere that wait to go live, and the press that puts them live. */
export function WaitingNotice({
  others: waiting,
  kind,
  placeName,
  busy,
  held,
  trouble,
  onPublish,
}: {
  readonly others: ReadonlyArray<WaitingChange>;
  readonly kind: "domain" | "port";
  readonly placeName: string;
  readonly busy: boolean;
  /** The place is still being read: nothing is sent. */
  readonly held: boolean;
  readonly trouble: string | undefined;
  /** `undefined` while a change of ours is under way: they go live with it. */
  readonly onPublish: (() => void) | undefined;
}) {
  return (
    <div className="mb-2 grid gap-1.5 rounded-lg border border-border/60 px-3.5 py-3 text-sm">
      <div className="font-medium">
        {waiting.length === 1
          ? "A change made elsewhere waits to go live"
          : "Changes made elsewhere wait to go live"}
      </div>
      <ul className="grid gap-0.5 text-muted-foreground">
        {waiting.map((change) => (
          <li key={change.id}>{change.label}</li>
        ))}
      </ul>
      {onPublish === undefined ? (
        <p className="text-muted-foreground text-xs">
          {waiting.length === 1 ? "It goes" : "They go"} live with your change.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy || held} onClick={onPublish} size="sm" variant="outline">
            {busy ? <Spinner aria-hidden="true" /> : null}
            {waiting.length === 1 ? "Put it live" : "Put them live"}
          </Button>
          <span className="text-muted-foreground text-xs">
            Zerops puts every waiting {kind} change of {placeName} live together.
          </span>
        </div>
      )}
      <Trouble text={trouble} />
    </div>
  );
}

function RoutingRows({
  ctx,
  group,
  ips,
  mode,
  setMode,
  othersWaiting,
  onOwnIpv4,
}: {
  readonly ctx: SheetContext;
  readonly group: ReadonlyArray<AddressDomain>;
  readonly ips: PlaceAddresses["ips"];
  readonly mode: WebMode;
  readonly setMode: (mode: WebMode) => void;
  readonly othersWaiting: ReadonlyArray<WaitingChange>;
  readonly onOwnIpv4: (() => void) | undefined;
}) {
  const waiting = group.filter((domain) => NEEDS_RECORDS.has(domain.face));
  const certificate = group.find((domain) => domain.face === "certificate");
  const failed = group.find((domain) => domain.face === "certificate-failed");
  const first = group[0]!;
  return (
    <>
      {group.map((domain) => (
        <DomainRow
          ctx={ctx}
          domain={domain}
          group={group}
          key={domain.domainName}
          mode={mode}
          othersWaiting={othersWaiting}
          setMode={setMode}
        />
      ))}
      {waiting.length > 0 ? (
        <Records ctx={ctx} domains={waiting} ips={ips} onOwnIpv4={onOwnIpv4} />
      ) : null}
      {certificate === undefined ? null : (
        <p className="pb-3 text-muted-foreground text-xs">
          The records are right. Zerops is getting {certificate.domainName} a free certificate,
          which usually takes a few minutes.
        </p>
      )}
      {failed === undefined ? null : (
        <div className="grid gap-2 pb-3 text-xs">
          <p className="text-muted-foreground">
            Zerops couldn't get {failed.domainName} a certificate
            {failed.sslError === undefined ? "." : `: ${failed.sslError}`}
          </p>
          <CheckAgain ctx={ctx} domain={first} />
        </div>
      )}
    </>
  );
}

function DomainRow({
  ctx,
  domain,
  group,
  mode,
  setMode,
  othersWaiting,
}: {
  readonly ctx: SheetContext;
  readonly domain: AddressDomain;
  /** The domains of its routing, itself among them. */
  readonly group: ReadonlyArray<AddressDomain>;
  readonly mode: WebMode;
  readonly setMode: (mode: WebMode) => void;
  readonly othersWaiting: ReadonlyArray<WaitingChange>;
}) {
  const waitsFor = removeWaitsFor(domain, group);
  const face = domainFaceWords(domain.face);
  const key = `remove:${domain.domainName}`;
  const asking = mode.kind === "remove" && mode.domainName === domain.domainName;
  const own = domain.routingId.startsWith("own:");
  return (
    <>
      <SheetRow
        data={domain.domainName}
        end={asking ? <Face tone="warn" word="Removing?" /> : <Face {...face} />}
        more={
          own || domain.face === "removing" ? null : (
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    aria-label={`More for ${domain.domainName}`}
                    size="icon-sm"
                    variant="ghost-muted"
                  />
                }
              >
                <EllipsisIcon />
              </MenuTrigger>
              <MenuPopup align="end">
                {domain.face === "live" ? (
                  <MenuItem render={<a href={domain.url} rel="noreferrer" target="_blank" />}>
                    Open {domain.domainName}
                  </MenuItem>
                ) : null}
                {waitsFor === null ? (
                  <MenuItem
                    disabled={ctx.hold}
                    onClick={() => setMode({ kind: "remove", domainName: domain.domainName })}
                    variant="destructive"
                  >
                    Remove {domain.domainName}
                  </MenuItem>
                ) : (
                  <MenuItem disabled>Wait until {waitsFor} is removed</MenuItem>
                )}
              </MenuPopup>
            </Menu>
          )
        }
        name={
          <>
            {domain.face === "live" ? (
              <a
                className="inline-flex min-w-0 items-center gap-1 hover:underline"
                href={domain.url}
                rel="noreferrer"
                target="_blank"
              >
                <span className="truncate">{domain.domainName}</span>
                <ArrowUpRightIcon aria-hidden="true" className="size-3.25 shrink-0 opacity-60" />
              </a>
            ) : (
              <span className="truncate">{domain.domainName}</span>
            )}
            <RowMeta>{targetWords(domain)}</RowMeta>
          </>
        }
      />
      <Trouble text={ctx.trouble.get(key)} />
      {asking ? (
        <Confirm
          busy={ctx.busy.has(key)}
          disabled={ctx.hold}
          cancel="Cancel"
          confirm={
            othersWaiting.length === 0
              ? `Remove ${domain.domainName}`
              : guardPress("Remove", othersWaiting.length)
          }
          destructive
          onCancel={() => setMode({ kind: "list" })}
          onConfirm={() => {
            const removing = group.filter((each) => each.face === "removing");
            void ctx.onWrite(removeWrite(domain, ctx.projectId, removing)).then((taken) => {
              if (taken) ctx.settle(mode);
            });
          }}
          title={
            othersWaiting.length === 0
              ? `Remove ${domain.domainName}?`
              : guardTitle(`Removing ${domain.domainName}`, othersWaiting.length)
          }
        >
          <p>
            It stops answering right away. Its DNS records can stay; remove them at your DNS
            provider when you like.
          </p>
          {othersWaiting.length === 0 ? null : (
            <OthersList kind="domain" others={othersWaiting} placeName={ctx.placeName} />
          )}
        </Confirm>
      ) : null}
    </>
  );
}

/** The records a routing's waiting domains need, to copy to the person's DNS provider. */
function Records({
  ctx,
  domains,
  ips,
  onOwnIpv4,
}: {
  readonly ctx: SheetContext;
  readonly domains: ReadonlyArray<AddressDomain>;
  readonly ips: PlaceAddresses["ips"];
  readonly onOwnIpv4: (() => void) | undefined;
}) {
  const [ways, setWays] = useState(false);
  const { records, bothRequired, cnames, certificates } = recordsOf(domains, ips);
  const first = domains[0]!;
  const elsewhere = domains.filter((domain) => domain.face === "elsewhere");
  const nameServers = first.nameServers;
  return (
    <div className="grid gap-2.5 pb-3.5 text-sm" data-addresses-records={first.routingId}>
      {elsewhere.map((domain) => (
        <p className="text-xs" key={domain.domainName}>
          {domain.domainName} points at {domain.resolvedIps.join(", ")}, which isn't {ctx.placeName}
          . Change its records to these.
        </p>
      ))}
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 font-medium">Add these records at your DNS provider</span>
        {nameServers.length === 0 ? null : <RowMeta>{nameServers[0]}</RowMeta>}
      </div>
      {records.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          {ctx.placeName}'s IP addresses aren't read yet.
        </p>
      ) : (
        <DnsRecords
          bothRequired={bothRequired}
          certificates={certificates}
          cnames={cnames}
          records={records}
        />
      )}
      <div>
        <div className="-ms-2">
          <Button
            aria-expanded={ways}
            onClick={() => setWays((open) => !open)}
            size="xs"
            variant="ghost-muted"
          >
            <ChevronRightIcon className={ways ? "rotate-90" : undefined} />
            Other ways
          </Button>
        </div>
        {ways ? (
          <div className="grid gap-1.5 pt-1.5 text-muted-foreground text-xs">
            {ips.ownV4 === undefined ? (
              <p>
                <b className="font-medium text-foreground">Your own IPv4:</b> then the A record
                alone is enough.{" "}
                {onOwnIpv4 === undefined ? null : (
                  <Button onClick={onOwnIpv4} size="xs" variant="link">
                    Get your own IPv4
                  </Button>
                )}
              </p>
            ) : null}
            <p>
              <b className="font-medium text-foreground">Behind Cloudflare's proxy:</b> keep only
              the AAAA, proxied, and set SSL to Full (strict).
            </p>
          </div>
        ) : null}
      </div>
      {first.routingId.startsWith("own:") ? null : <CheckAgain ctx={ctx} domain={first} />}
    </div>
  );
}

function CheckAgain({
  ctx,
  domain,
}: {
  readonly ctx: SheetContext;
  readonly domain: AddressDomain;
}) {
  const key = `check:${domain.routingId}`;
  const busy = ctx.busy.has(key);
  const checked = checkedWords(domain.checkedAt, ctx.nowMs);
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-muted-foreground text-xs">
        <span className="min-w-0">
          {checked === null ? "" : `${checked} · `}Changes show within about 10 minutes.
        </span>
        <Button
          disabled={busy || ctx.hold}
          onClick={() =>
            void ctx.onWrite({
              kind: "check-domain-dns",
              projectId: ctx.projectId,
              routingId: domain.routingId,
            })
          }
          size="xs"
          variant="outline"
        >
          {busy ? <Spinner aria-hidden="true" /> : null}
          {busy ? "Checking…" : "Check again"}
        </Button>
      </div>
      <Trouble text={ctx.trouble.get(key)} />
    </div>
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
  return (
    <>
      <SheetRow
        data={`zerops:${address.serviceName}`}
        end={
          <span className="inline-flex items-center gap-2">
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
          </span>
        }
        name={
          address.on && first !== undefined ? (
            <span className="flex min-w-0 flex-wrap gap-x-3">
              {address.hosts.map((host) => (
                <a
                  className="inline-flex min-w-0 items-center gap-1 hover:underline"
                  href={host.url}
                  key={host.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  <span className="truncate">{host.host}</span>
                  <ArrowUpRightIcon aria-hidden="true" className="size-3.25 shrink-0 opacity-60" />
                </a>
              ))}
            </span>
          ) : (
            <>
              <span className="truncate text-muted-foreground">{address.serviceName}</span>
              <RowMeta>zerops.app address</RowMeta>
            </>
          )
        }
      />
      <Trouble text={ctx.trouble.get(key)} />
      {asking ? (
        <Confirm
          busy={busy}
          disabled={ctx.hold}
          cancel="Keep it open"
          confirm="Close it"
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
          title={`Close ${first?.host ?? label}?`}
        >
          <p>
            Anyone using it gets nothing from now on.{" "}
            {keeps.length === 0 ? (
              `${address.serviceName} then answers only inside ${ctx.placeName}, until you open it again.`
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
    </>
  );
}

/** *Add your domain*: the domain, where it leads, its www twin; then the add, or the ask first. */
function AddDomainForm({
  ctx,
  existing,
  targets,
  othersWaiting,
  onDone,
  onTaken,
}: {
  readonly ctx: SheetContext;
  readonly existing: ReadonlyArray<string>;
  readonly targets: ReadonlyArray<ServicePortChoice>;
  readonly othersWaiting: ReadonlyArray<WaitingChange>;
  readonly onDone: () => void;
  readonly onTaken: () => void;
}) {
  const revealed = useRevealed<HTMLFormElement>();
  const id = useId();
  const [typed, setTyped] = useState("");
  const [twin, setTwin] = useState(true);
  const [target, setTarget] = useState(() => targetValue(targets[0]));
  const [guarding, setGuarding] = useState(false);
  const name = normalizeDomain(typed);
  const problem = domainProblem(name, existing, ctx.placeName);
  const offered = wwwTwin(name);
  const domains = domainsToAdd(name, twin, existing);
  const chosen = targets.find((each) => targetValue(each) === target) ?? targets[0];
  const busy = ctx.busy.has("add-domain");
  const ready = name !== "" && problem === null && chosen !== undefined;
  const add = () => {
    if (!ready) return;
    if (othersWaiting.length > 0 && !guarding) {
      setGuarding(true);
      return;
    }
    void ctx
      .onWrite({
        kind: "add-domain",
        projectId: ctx.projectId,
        domains,
        serviceId: chosen.serviceId,
        port: chosen.port,
      })
      .then((taken) => {
        setGuarding(false);
        if (taken) onTaken();
      });
  };
  const named = domains.join(" and ");
  return (
    <form
      className="grid gap-3 rounded-xl border border-border/70 bg-card px-3.5 py-3"
      data-addresses-form="add-domain"
      ref={revealed}
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-domain`}>Your domain</Label>
          <Input
            aria-invalid={problem === null ? undefined : true}
            autoComplete="off"
            autoFocus
            id={`${id}-domain`}
            onChange={(event) => {
              setTyped(event.target.value);
              setGuarding(false);
            }}
            placeholder="yourshop.com, or *.yourshop.com"
            spellCheck={false}
            value={typed}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Points to</Label>
          <Select
            items={targets.map((each) => ({ value: targetValue(each), label: targetLabel(each) }))}
            onValueChange={(value) => {
              if (typeof value === "string") setTarget(value);
            }}
            value={target}
          >
            <SelectTrigger aria-label="Points to">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {targets.map((each) => (
                <SelectItem key={targetValue(each)} value={targetValue(each)}>
                  {targetLabel(each)}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      </div>
      {problem === null ? null : (
        <p className="text-destructive-foreground text-xs" role="alert">
          {problem}
        </p>
      )}
      {offered === null || existing.includes(offered) ? null : (
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={twin} onCheckedChange={(on) => setTwin(on === true)} />
          Also {offered}
        </label>
      )}
      <Trouble text={ctx.trouble.get("add-domain")} />
      {guarding && othersWaiting.length > 0 ? (
        <Confirm
          busy={busy}
          disabled={ctx.hold}
          cancel="Cancel"
          confirm={guardPress(null, othersWaiting.length)}
          onCancel={() => setGuarding(false)}
          onConfirm={add}
          title={guardTitle(`Adding ${named}`, othersWaiting.length)}
        >
          <OthersList kind="domain" others={othersWaiting} placeName={ctx.placeName} />
        </Confirm>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!ready || busy || ctx.hold} size="sm" type="submit">
            {busy ? <Spinner aria-hidden="true" /> : null}
            {name === "" ? "Add" : `Add ${name}`}
          </Button>
          <Button onClick={onDone} size="sm" type="button" variant="ghost">
            Cancel
          </Button>
          <span className="text-muted-foreground text-xs">
            Then this shows the records to add at your DNS provider.
          </span>
        </div>
      )}
    </form>
  );
}

const targetValue = (target: ServicePortChoice | undefined) =>
  target === undefined ? "" : `${target.serviceId}:${target.port}`;

const targetLabel = (target: ServicePortChoice) => `${target.serviceName} · port ${target.port}`;
