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
import {
  ArrowUpRightIcon,
  ChevronRightIcon,
  EllipsisIcon,
  GlobeIcon,
  PlusIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { Checkbox } from "../../ui/checkbox";
import { EmptyState } from "../../ui/empty";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../ui/menu";
import { Row } from "../../ui/row";
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
  GroupBody,
  guardPress,
  guardTitle,
  Journey,
  OthersList,
  SheetGroup,
  SheetSection,
  Stage,
  Trouble,
  useRevealed,
  WaitingNotice,
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
  // Our own add under way is drawn as a domain at once, and goes again where Zerops refuses it:
  // the place has a domain only once one is there, so the form it was typed into stays as it is.
  const none = place.domains.every((domain) => domain.routingId.startsWith("own:"));
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
            variant="secondary"
          >
            <PlusIcon />
            {none ? "Put it on your domain" : "Add a domain"}
          </Button>
        )
      }
      apart
      {...(none ? { caption: "Addresses you own, like yourshop.com. Each gets free https." } : {})}
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
      {place.domains.length === 0 && !adding ? (
        <EmptyState size="row">
          {!serves
            ? `Nothing in ${ctx.placeName} serves web pages yet.`
            : place.zerops.some((address) => address.on)
              ? `No domain yet. ${ctx.placeName} answers at its Zerops addresses.`
              : "No domain yet."}
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
  const live = domain.face === "live";
  const leads = target === undefined ? null : targetLabel(target, targets);
  return (
    <>
      {/* The app's own row for a thing with a face: the mark carries the domain's state, its
          words stand right under its name, and what can be done with it ends the row. */}
      <Row
        control={
          <>
            {live ? (
              <Button
                render={<a href={domain.url} rel="noreferrer" target="_blank" />}
                size="sm"
                variant="secondary"
              >
                Open
                <ArrowUpRightIcon />
              </Button>
            ) : null}
            {own || domain.face === "removing" ? (
              // The seat the other rows' menu fills, so every row ends on one edge.
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
                  <MenuItem onClick={() => void writeTextToClipboard(domain.domainName)}>
                    Copy {domain.domainName}
                  </MenuItem>
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
            )}
          </>
        }
        data-addresses-row={domain.domainName}
        lead={<DomainMark face={domain.face} />}
        line={
          <span data-face={face.tone}>
            {asking ? "Removing?" : domainStateWords(domain)}
            {leads === null ? null : (
              <>
                {" · "}
                {live ? "opens" : "will open"} <span className="real-name">{leads}</span>
              </>
            )}
          </span>
        }
        size="lg"
        strong
        title={domain.domainName}
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

/** A domain's state in a few words, under its name: "Live with https", "Waiting for your DNS". */
function domainStateWords(domain: AddressDomain): string {
  const { word } = domainFaceWords(domain.face);
  return domain.face === "live" && domain.sslEnabled ? `${word} with https` : word;
}

/**
 * A domain's mark, in the seat a Mate's face has in its row: a globe on its state's tint, a
 * spinner while Zerops works on it. The words under the name say the state; the mark lets a list
 * of domains be read at a glance.
 */
function DomainMark({ face }: { readonly face: AddressDomain["face"] }) {
  const { tone } = domainFaceWords(face);
  return (
    <span
      aria-hidden="true"
      className={`flex size-9 items-center justify-center rounded-full ${MARK_TONE[tone]}`}
    >
      {tone === "busy" ? (
        <Spinner size="sm" />
      ) : tone === "fail" ? (
        <TriangleAlertIcon className="size-4" />
      ) : (
        <GlobeIcon className="size-4" />
      )}
    </span>
  );
}

const MARK_TONE = {
  ok: "bg-status-ok-surface text-status-ok-text",
  warn: "bg-status-attention-surface text-status-attention-text",
  busy: "bg-status-busy-surface text-status-busy-text",
  fail: "bg-status-failed-surface text-status-failed-text",
} as const;

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
  // Every domain of the setup that does not answer yet: the last stage is theirs together.
  const onWay = [...waiting, ...certificate, ...(failed === undefined ? [] : [failed])];
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
      {failed !== undefined ? (
        <Stage
          action={
            // While records are still asked for, their own check is the one press.
            waiting.length > 0 ? null : (
              <CheckNow ctx={ctx} domain={first} label="Try again" variant="secondary" />
            )
          }
          state="failed"
          title={`Zerops couldn't get ${failed.domainName} its https certificate`}
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
          {waiting.length > 0 ? null : (
            <Trouble text={ctx.trouble.get(`check:${first.routingId}`)} />
          )}
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
  const { records, bothRequired, cnames, certificates } = recordsOf(domains, ips);
  const first = domains[0]!;
  const own = first.routingId.startsWith("own:");
  const beside = domains.map((domain) => domain.domainName);
  const root = namesWords([...new Set(beside.map((name) => registeredDomain(name, beside)))]);
  const provider = dnsProvider(first.nameServers);
  const elsewhere = domains.filter((domain) => domain.face === "elsewhere");
  const count = records.length + certificates.length;
  const found = recordsFound(domains, records);
  const busy = ctx.busy.has(`check:${first.routingId}`);
  const checked = checkedWords(first.checkedAt, ctx.nowMs);

  // One look of the platform's per shown setup, where its last is old: the person who added the
  // records and came back sees the answer without pressing. Never for a setup not looked up yet:
  // its first look is the platform's own, right after it is put in place. Asked quietly: nobody
  // pressed, so a refusal (a role that only reads) is not said under the control.
  const asked = useRef(false);
  const at = first.checkedAt === undefined ? Number.NaN : Date.parse(first.checkedAt);
  const stale = !Number.isNaN(at) && ctx.nowMs - at > CHECK_FRESH_MS;
  const { hold, onWrite, projectId } = ctx;
  const routingId = first.routingId;
  useEffect(() => {
    if (own || hold || !stale || asked.current) return;
    asked.current = true;
    void onWrite({ kind: "check-domain-dns", projectId, routingId }, { quiet: true });
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
      {records.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          {ctx.placeName}'s IP addresses aren't read yet.
        </p>
      ) : (
        <DnsRecords
          bothRequired={bothRequired}
          certificates={certificates}
          cloudflare={atCloudflare(provider)}
          cnames={cnames}
          found={found}
          records={records}
          {...(ips.ownV4 === undefined ? { ownIpv4: { onGet: onOwnIpv4 } } : {})}
        />
      )}
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
                    : // A wildcard's certificate record points at a name: no look-up tells it.
                      `${checked}: ${found.size} of ${records.length}${certificates.length === 0 ? "" : " A and AAAA"} found.`}
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
  // What the person chose among several services; nothing until they do.
  const [target, setTarget] = useState("");
  const [guarding, setGuarding] = useState(false);
  const name = normalizeDomain(typed);
  const problem = domainProblem(name, existing, ctx.placeName);
  const offered = wwwTwin(name);
  const domains = domainsToAdd(name, twin, existing);
  // One service to open, and it is the one; of several the person says which, never the first
  // by name: a domain put on the wrong service shows the wrong pages to everyone. Read from the
  // services as they are now, so one that left is no longer chosen and a lone one always is.
  const chosen =
    targets.length === 1 ? targets[0] : targets.find((each) => targetValue(each) === target);
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
        if (!taken) return;
        // Where the form stays, it is ready for the next domain.
        setTyped("");
        onTaken();
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
            ? "grid grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)] gap-3 max-sm:grid-cols-1"
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
              value={chosen === undefined ? null : targetValue(chosen)}
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
