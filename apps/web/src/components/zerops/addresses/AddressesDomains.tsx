/**
 * The sheet's *Your domains*: the place's own domains, each with where it leads and how far it is
 * from answering. One that is not live yet carries its way there under it, stage by stage: the
 * records to add at the person's DNS provider as that provider's form takes them, ticked off as
 * the platform finds them; the https certificate Zerops gets next; and going live. A place with
 * no domain yet shows the field to type one into, with the same three steps pictured. Removing a
 * domain asks first, and a write that would put somebody else's waiting change live names it
 * before it does.
 */
import type {
  AddressDomain,
  PlaceAddresses,
  ServicePortChoice,
  WaitingChange,
} from "@t3tools/client-runtime/data";
import { ArrowUpRightIcon, ChevronRightIcon, EllipsisIcon, PlusIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { Checkbox } from "../../ui/checkbox";
import { EmptyState } from "../../ui/empty";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { Spinner } from "../../ui/spinner";
import {
  atCloudflare,
  checkedWords,
  dnsProvider,
  domainFaceWords,
  domainProblem,
  domainsToAdd,
  namesWords,
  normalizeDomain,
  recordsFound,
  recordsOf,
  registeredDomain,
  removeWaitsFor,
  removeWrite,
  wwwTwin,
} from "./addresses.logic";
import {
  Confirm,
  Face,
  GroupBody,
  guardPress,
  guardTitle,
  Journey,
  OthersList,
  RowMeta,
  SheetGroup,
  SheetRow,
  SheetSection,
  Stage,
  Trouble,
  useRevealed,
  WaitingNotice,
  type SheetContext,
} from "./AddressesSheetBits";
import { DnsRecords, RecordTable } from "./DnsRecords";

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

/** The service a target names, with its port only where the service serves the web on several. */
function targetLabel(
  target: Pick<ServicePortChoice, "serviceId" | "serviceName" | "port">,
  targets: ReadonlyArray<ServicePortChoice>,
) {
  const several = targets.filter((each) => each.serviceId === target.serviceId).length > 1;
  return several ? `${target.serviceName} · port ${target.port}` : target.serviceName;
}

const NEEDS_RECORDS = new Set<AddressDomain["face"]>(["going-live", "dns", "elsewhere"]);

export function AddressesDomains({
  ctx,
  place,
  othersWaiting,
  mode,
  setMode,
  onOwnIpv4,
  inviting,
}: {
  readonly ctx: SheetContext;
  readonly place: PlaceAddresses;
  readonly othersWaiting: ReadonlyArray<WaitingChange>;
  readonly mode: WebMode;
  readonly setMode: (mode: WebMode) => void;
  /** Takes the person to *Get your own IPv4*, an "Other way" of a domain's records. */
  readonly onOwnIpv4: (() => void) | undefined;
  /**
   * With no domain yet, the place shows the field to type one into at once: production, or a
   * project that stands alone. A stage or a Mate's own workspace offers it as a press instead.
   */
  readonly inviting: boolean;
}) {
  const oursUnderWay =
    ctx.busy.has("add-domain") ||
    ctx.busy.has("publish-domains") ||
    [...ctx.busy].some((key) => key.startsWith("remove:"));
  const asked = mode.kind === "add-domain";
  const none = place.domains.length === 0;
  const serves = place.webTargets.length > 0;
  // Where a domain is what the place is for, one with none yet shows the field at once.
  const first = none && inviting;
  const adding = serves && (asked || first);
  return (
    <SheetSection
      action={
        adding || !serves ? null : (
          <Button
            disabled={ctx.hold}
            onClick={() => setMode({ kind: "add-domain" })}
            size="sm"
            variant="ghost"
          >
            <PlusIcon />
            {none ? "Put it on your domain" : "Add a domain"}
          </Button>
        )
      }
      caption="Addresses you own, like yourshop.com. Each gets free https."
      lead={
        adding ? (
          <AddDomainForm
            ctx={ctx}
            existing={place.domains.map((domain) => domain.domainName)}
            first={none}
            focused={asked}
            onDone={first ? undefined : () => setMode({ kind: "list" })}
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
      part="domains"
      title="Your domains"
    >
      {byRouting(place.domains).map((group) => (
        <RoutingGroup
          ctx={ctx}
          group={group}
          ips={place.ips}
          key={group[0]!.routingId}
          mode={mode}
          onOwnIpv4={onOwnIpv4}
          othersWaiting={othersWaiting}
          setMode={setMode}
          targets={place.webTargets}
        />
      ))}
      {none && !adding ? (
        <EmptyState size="row">
          {serves
            ? `No domain yet. ${ctx.placeName} answers at its Zerops addresses.`
            : `Nothing in ${ctx.placeName} serves web pages yet.`}
        </EmptyState>
      ) : null}
    </SheetSection>
  );
}

/** One domain setup: its domains, then their way to answering while any is not live. */
function RoutingGroup({
  ctx,
  group,
  ips,
  targets,
  mode,
  setMode,
  othersWaiting,
  onOwnIpv4,
}: {
  readonly ctx: SheetContext;
  readonly group: ReadonlyArray<AddressDomain>;
  readonly ips: PlaceAddresses["ips"];
  readonly targets: ReadonlyArray<ServicePortChoice>;
  readonly mode: WebMode;
  readonly setMode: (mode: WebMode) => void;
  readonly othersWaiting: ReadonlyArray<WaitingChange>;
  readonly onOwnIpv4: (() => void) | undefined;
}) {
  const waiting = group.filter((domain) => NEEDS_RECORDS.has(domain.face));
  const certificate = group.filter((domain) => domain.face === "certificate");
  const failed = group.find((domain) => domain.face === "certificate-failed");
  const first = group[0]!;
  const onWay = waiting.length > 0 || certificate.length > 0 || failed !== undefined;
  // A setup the person just added is brought to the top of the sheet's view: it may land under
  // another's records, below the fold.
  const added = useRef<HTMLDivElement>(null);
  const own = first.routingId.startsWith("own:");
  useEffect(() => {
    if (own) added.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [own]);
  return (
    <SheetGroup data={first.routingId} ref={added}>
      {group.map((domain) => (
        <DomainRow
          ctx={ctx}
          domain={domain}
          group={group}
          key={domain.domainName}
          mode={mode}
          othersWaiting={othersWaiting}
          setMode={setMode}
          targets={targets}
        />
      ))}
      {onWay ? (
        <GroupBody>
          <div
            className="pt-1 pb-1.5"
            data-addresses-records={waiting.length > 0 ? first.routingId : undefined}
          >
            <DomainJourney
              certificate={certificate}
              ctx={ctx}
              failed={failed}
              first={first}
              ips={ips}
              onOwnIpv4={onOwnIpv4}
              waiting={waiting}
            />
          </div>
        </GroupBody>
      ) : null}
    </SheetGroup>
  );
}

function DomainRow({
  ctx,
  domain,
  group,
  targets,
  mode,
  setMode,
  othersWaiting,
}: {
  readonly ctx: SheetContext;
  readonly domain: AddressDomain;
  /** The domains of its routing, itself among them. */
  readonly group: ReadonlyArray<AddressDomain>;
  readonly targets: ReadonlyArray<ServicePortChoice>;
  readonly mode: WebMode;
  readonly setMode: (mode: WebMode) => void;
  readonly othersWaiting: ReadonlyArray<WaitingChange>;
}) {
  const waitsFor = removeWaitsFor(domain, group);
  const face = domainFaceWords(domain.face);
  const key = `remove:${domain.domainName}`;
  const asking = mode.kind === "remove" && mode.domainName === domain.domainName;
  const own = domain.routingId.startsWith("own:");
  const target = domain.targets[0];
  const trouble = ctx.trouble.get(key);
  // A phone's row has no room for where a domain leads beside it: said under it, both read whole.
  const phone = useMediaQuery("max-sm");
  const leads =
    target === undefined ? null : (
      <RowMeta>
        → <span className="real-name">{targetLabel(target, targets)}</span>
      </RowMeta>
    );
  return (
    <>
      <SheetRow
        data={domain.domainName}
        end={asking ? <Face tone="warn" word="Removing?" /> : <Face {...face} />}
        more={
          own || domain.face === "removing" ? (
            // The seat the other rows' menu fills, so every row's state ends on one edge.
            <span aria-hidden="true" className="size-7" />
          ) : (
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    aria-label={`More for ${domain.domainName}`}
                    size="icon-sm"
                    variant="ghost"
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
            {phone ? null : leads}
          </>
        }
        sub={phone ? leads : undefined}
      />
      {trouble === undefined && !asking ? null : (
        <GroupBody>
          <Trouble text={trouble} />
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
        </GroupBody>
      )}
    </>
  );
}

/** How long the platform's own look counts as the answer still: older, and the sheet asks again. */
const CHECK_FRESH_MS = 10 * 60_000;

/**
 * A domain setup's way to answering, as three stages on one rail: the records at the person's
 * DNS provider, the https certificate, live. The one it stands at carries what it needs: the
 * records and the check that finds them, the wait for the certificate, or why that was refused.
 */
function DomainJourney({
  ctx,
  first,
  waiting,
  certificate,
  failed,
  ips,
  onOwnIpv4,
}: {
  readonly ctx: SheetContext;
  /** The routing's first domain: the one a check is asked for. */
  readonly first: AddressDomain;
  /** Its domains whose records are not found yet. */
  readonly waiting: ReadonlyArray<AddressDomain>;
  /** Its domains whose certificate is on its way. */
  readonly certificate: ReadonlyArray<AddressDomain>;
  readonly failed: AddressDomain | undefined;
  readonly ips: PlaceAddresses["ips"];
  readonly onOwnIpv4: (() => void) | undefined;
}) {
  const onWay = waiting.length > 0 ? waiting : failed === undefined ? certificate : [failed];
  const names = namesWords(onWay.map((domain) => domain.domainName));
  const one = onWay.length === 1;
  const cloudflare = atCloudflare(dnsProvider((failed ?? first).nameServers));
  return (
    <Journey>
      {waiting.length > 0 ? (
        <RecordsStage ctx={ctx} domains={waiting} ips={ips} onOwnIpv4={onOwnIpv4} />
      ) : (
        <Stage state="done" title="DNS records found" />
      )}
      {failed !== undefined && waiting.length === 0 ? (
        <Stage
          action={<CheckNow ctx={ctx} domain={first} label="Try again" variant="secondary" />}
          state="failed"
          title="Zerops couldn't get its https certificate"
        >
          {failed.sslError === undefined ? null : (
            <p className="text-muted-foreground text-xs">{failed.sslError}</p>
          )}
          {cloudflare ? (
            <p className="text-muted-foreground text-xs">
              On Cloudflare, set each record's Proxy status to DNS only, or SSL/TLS to Full
              (strict).
            </p>
          ) : null}
          <Trouble text={ctx.trouble.get(`check:${first.routingId}`)} />
        </Stage>
      ) : waiting.length === 0 ? (
        <Stage state="busy" title="Zerops is getting its free https certificate">
          <p className="text-muted-foreground text-xs">This usually takes a few minutes.</p>
        </Stage>
      ) : (
        <Stage state="next" title="Zerops adds free https" />
      )}
      <Stage
        state="next"
        title={
          <>
            {names} {one ? "goes" : "go"} live
          </>
        }
      />
    </Journey>
  );
}

/**
 * The stage that waits for the person: where the domain's DNS is kept, the records to add there,
 * and the check that finds them. Shown for a setup the platform has not looked up for a while,
 * it asks for that look once by itself.
 */
function RecordsStage({
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
  const own = first.routingId.startsWith("own:");
  const root = namesWords([
    ...new Set(domains.map((domain) => registeredDomain(domain.domainName))),
  ]);
  const provider = dnsProvider(first.nameServers);
  const elsewhere = domains.filter((domain) => domain.face === "elsewhere");
  // A CNAME that leaves IPv4 visitors out is no way to offer.
  const oneRecord = cnames.filter((cname) => cname.ipv4);
  const count = records.length + certificates.length;
  const found = recordsFound(domains, records);
  const busy = ctx.busy.has(`check:${first.routingId}`);
  const checked = checkedWords(first.checkedAt, ctx.nowMs);

  // One look of the platform's per shown setup, where its last is old: the person who added the
  // records and came back sees the answer without pressing.
  const asked = useRef(false);
  const at = first.checkedAt === undefined ? Number.NaN : Date.parse(first.checkedAt);
  const stale = Number.isNaN(at) || ctx.nowMs - at > CHECK_FRESH_MS;
  const { hold, onWrite, projectId } = ctx;
  const routingId = first.routingId;
  useEffect(() => {
    if (own || hold || !stale || asked.current) return;
    asked.current = true;
    void onWrite({ kind: "check-domain-dns", projectId, routingId });
  }, [hold, onWrite, own, projectId, routingId, stale]);

  return (
    <Stage
      action={
        provider.kind === "known" ? (
          <Button
            render={<a href={provider.url} rel="noreferrer" target="_blank" />}
            size="sm"
            variant="secondary"
          >
            Open {provider.name}
            <ArrowUpRightIcon />
          </Button>
        ) : null
      }
      state="you"
      title={
        count === 1
          ? `Add this record to ${root}'s DNS`
          : `Add these ${count} records to ${root}'s DNS`
      }
    >
      <p className="text-muted-foreground text-xs" data-addresses-provider={provider.kind}>
        {provider.kind === "known" ? (
          <>
            Its DNS is at {provider.name}. Sign in there and open {root}'s DNS records.
          </>
        ) : provider.kind === "other" ? (
          <>
            You do this where {root}'s DNS is kept (its name server is{" "}
            <span className="real-name text-foreground">{provider.host}</span>).
          </>
        ) : provider.kind === "registry" ? (
          <>
            {root} has no DNS provider yet. If you haven't bought it, do that first: any domain
            registrar works.
          </>
        ) : (
          <>You do this where you bought {root}, in its DNS settings.</>
        )}
      </p>
      {elsewhere.map((domain) => (
        <p className="text-status-attention-text text-xs" key={domain.domainName}>
          {domain.domainName} points at {domain.resolvedIps.join(", ")} now, which isn't{" "}
          {ctx.placeName}. Replace the records it has with these.
        </p>
      ))}
      {count === 0 ? (
        <p className="text-muted-foreground text-xs">
          {ctx.placeName}'s IP addresses aren't read yet.
        </p>
      ) : (
        <DnsRecords
          bothRequired={bothRequired}
          certificates={certificates}
          cloudflare={atCloudflare(provider)}
          found={found}
          records={records}
        />
      )}
      <div>
        <div className="-ms-2">
          <Button
            aria-expanded={ways}
            onClick={() => setWays((was) => !was)}
            size="sm"
            variant="ghost"
          >
            <ChevronRightIcon className={ways ? "rotate-90" : undefined} />
            Other ways
          </Button>
        </div>
        {ways ? (
          <div className="grid gap-2.5 pt-1.5 text-muted-foreground text-xs">
            {oneRecord.length === 0 ? null : (
              <div className="grid gap-1.5" data-dns-way="cname">
                <p>
                  <b className="font-medium text-foreground">One CNAME instead:</b> for www and
                  other subdomains, or a whole domain where your provider flattens CNAMEs.
                </p>
                <RecordTable records={oneRecord} />
              </div>
            )}
            <p>
              <b className="font-medium text-foreground">Behind Cloudflare's proxy:</b> add only the
              AAAA, proxied, and set SSL/TLS to Full (strict).
            </p>
            {ips.ownV4 === undefined ? (
              <p>
                <b className="font-medium text-foreground">With your own IPv4</b> the A record alone
                is enough.{" "}
                {onOwnIpv4 === undefined ? null : (
                  <Button onClick={onOwnIpv4} size="sm" variant="link">
                    Get your own IPv4
                  </Button>
                )}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      {own ? null : (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border/60 pt-3">
          <div className="grid min-w-0 flex-1 basis-64 gap-0.5 text-xs">
            <p className="text-foreground" data-addresses-checked="">
              {busy
                ? "Looking them up…"
                : checked === null
                  ? "Not looked up yet."
                  : found.size === 0
                    ? `${checked}: not found yet.`
                    : `${checked}: ${found.size} of ${records.length} found.`}
            </p>
            <p className="text-muted-foreground">
              New records usually show within 10 minutes, sometimes up to a day.
            </p>
          </div>
          <CheckNow ctx={ctx} domain={first} label="Check now" />
        </div>
      )}
      <Trouble text={ctx.trouble.get(`check:${first.routingId}`)} />
    </Stage>
  );
}

/** The press that has the platform look a routing's domains up again. */
function CheckNow({
  ctx,
  domain,
  label,
  variant = "primary",
}: {
  readonly ctx: SheetContext;
  readonly domain: AddressDomain;
  readonly label: string;
  readonly variant?: "primary" | "secondary";
}) {
  const busy = ctx.busy.has(`check:${domain.routingId}`);
  return (
    <Button
      disabled={busy || ctx.hold}
      onClick={() =>
        void ctx.onWrite({
          kind: "check-domain-dns",
          projectId: ctx.projectId,
          routingId: domain.routingId,
        })
      }
      size="sm"
      variant={variant}
    >
      {busy ? <Spinner aria-hidden="true" /> : null}
      {busy ? "Checking…" : label}
    </Button>
  );
}

/** What putting a place on a domain takes, pictured before the first one is added. */
const WAY = [
  "Enter your domain",
  "Add its DNS records where you bought it",
  "Live with free https",
];

/** *Put it on your domain*: the domain, what it opens, its www twin; then the add, or the ask first. */
function AddDomainForm({
  ctx,
  existing,
  targets,
  othersWaiting,
  first,
  focused,
  onDone,
  onTaken,
}: {
  readonly ctx: SheetContext;
  readonly existing: ReadonlyArray<string>;
  readonly targets: ReadonlyArray<ServicePortChoice>;
  readonly othersWaiting: ReadonlyArray<WaitingChange>;
  /** The place's first domain: the form says what it is for and what follows. */
  readonly first: boolean;
  /** Opened by a press: the field takes the caret, and the form comes into view. */
  readonly focused: boolean;
  /** Leaves the form; absent where it is all the section holds. */
  readonly onDone: (() => void) | undefined;
  readonly onTaken: () => void;
}) {
  const revealed = useRevealed<HTMLFormElement>();
  const id = useId();
  const [typed, setTyped] = useState("");
  const [twin, setTwin] = useState(true);
  // One service to open, and it is the one; of several the person says which, never the first
  // by name: a domain put on the wrong service shows the wrong pages to everyone.
  const [target, setTarget] = useState(() => (targets.length === 1 ? targetValue(targets[0]) : ""));
  const [guarding, setGuarding] = useState(false);
  const name = normalizeDomain(typed);
  const problem = domainProblem(name, existing, ctx.placeName);
  const offered = wwwTwin(name);
  const domains = domainsToAdd(name, twin, existing);
  const chosen = targets.find((each) => targetValue(each) === target);
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
    <Card
      data-addresses-form="add-domain"
      render={
        <form
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
          ref={focused ? revealed : undefined}
        />
      }
      size="md"
      variant="flat"
    >
      {first ? (
        <div className="grid gap-1.5">
          <div className="font-semibold text-foreground text-sm">Put it on your domain</div>
          <ol className="m-0 flex list-none flex-wrap items-center gap-x-2 gap-y-1 p-0 text-muted-foreground text-xs">
            {WAY.map((words, index) => (
              <li className="inline-flex items-center gap-1.5" key={words}>
                {index === 0 ? null : (
                  <ChevronRightIcon aria-hidden="true" className="size-3 opacity-60" />
                )}
                <span className="flex size-4 items-center justify-center rounded-full bg-foreground/8 font-medium text-2xs text-foreground tabular-nums">
                  {index + 1}
                </span>
                {words}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <div
        className={
          targets.length > 1
            ? "grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)] gap-3"
            : "grid max-w-md gap-3"
        }
      >
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-domain`}>Your domain</Label>
          <Input
            aria-invalid={problem === null ? undefined : true}
            autoComplete="off"
            autoFocus={focused}
            id={`${id}-domain`}
            onChange={(event) => {
              setTyped(event.target.value);
              setGuarding(false);
            }}
            placeholder="yourshop.com"
            spellCheck={false}
            value={typed}
          />
        </div>
        {targets.length > 1 ? (
          <div className="grid gap-1.5">
            <Label>Opens</Label>
            <Select
              items={targets.map((each) => ({
                value: targetValue(each),
                label: targetLabel(each, targets),
              }))}
              onValueChange={(value) => {
                if (typeof value === "string") setTarget(value);
              }}
              value={target === "" ? null : target}
            >
              <SelectTrigger aria-label="Opens">
                <SelectValue placeholder="Choose a service" />
              </SelectTrigger>
              <SelectPopup>
                {targets.map((each) => (
                  <SelectItem key={targetValue(each)} value={targetValue(each)}>
                    {targetLabel(each, targets)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        ) : null}
      </div>
      {problem !== null ? (
        <p className="text-destructive-foreground text-xs" role="alert">
          {problem}
        </p>
      ) : offered === null || existing.includes(offered) ? null : (
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
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <Button disabled={!ready || busy || ctx.hold} size="sm" type="submit">
            {busy ? <Spinner aria-hidden="true" /> : null}
            {name === "" || problem !== null ? "Add domain" : `Add ${name}`}
          </Button>
          {onDone === undefined ? null : (
            <Button onClick={onDone} size="sm" type="button" variant="ghost">
              Cancel
            </Button>
          )}
          {first ? null : (
            <span className="ms-1 text-muted-foreground text-xs">
              Next you get the records to add where you bought it.
            </span>
          )}
        </div>
      )}
    </Card>
  );
}

const targetValue = (target: ServicePortChoice | undefined) =>
  target === undefined ? "" : `${target.serviceId}:${target.port}`;
