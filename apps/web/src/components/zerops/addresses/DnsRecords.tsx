/**
 * The records a domain needs at the person's DNS provider, as that provider's own form asks for
 * them: each record's type, its name the way the *Name* field takes it (`@`, `www`), and the value
 * to copy. A record the platform's last look-up already found is ticked, so what is still missing
 * shows. What a person can get wrong is said under the table, one short line each. The addresses
 * sheet and an approved domain's card draw the same block.
 */
import type { DnsRecord } from "@t3tools/client-runtime/data";
import { CheckIcon } from "lucide-react";

import { namesWords, recordHost, recordKey, registeredDomain } from "./addresses.logic";
import { CopyButton } from "./AddressesSheetBits";

const NONE_FOUND: ReadonlySet<string> = new Set();

export function DnsRecords({
  records,
  bothRequired,
  certificates,
  cloudflare = false,
  found = NONE_FOUND,
}: {
  readonly records: ReadonlyArray<DnsRecord>;
  /** The A points at the shared IPv4: it works only with the AAAA beside it. */
  readonly bothRequired: boolean;
  /** What each wildcard's certificate needs, whichever way it points. */
  readonly certificates: ReadonlyArray<DnsRecord>;
  /** The records are kept at Cloudflare, whose proxy is on unless the person turns it off. */
  readonly cloudflare?: boolean;
  /** The records already found in place, by `recordKey`. */
  readonly found?: ReadonlySet<string>;
}) {
  const all = [...records, ...certificates];
  const roots = [
    ...new Set(
      all
        .filter((record) => recordHost(record.name) === "@")
        .map((record) => registeredDomain(record.name)),
    ),
  ];
  return (
    <div className="grid gap-2" data-dns-records="">
      <RecordTable found={found} records={all} rooted={roots.length > 1} />
      <ul className="m-0 grid list-none gap-0.5 p-0 text-muted-foreground text-xs">
        {roots.length === 0 ? null : (
          <li>
            <span className="font-mono text-foreground">@</span> means {namesWords(roots)} itself.
          </li>
        )}
        {bothRequired ? <li>Each name needs both its A and its AAAA record.</li> : null}
        {cloudflare ? (
          <li>
            On Cloudflare, set each record's Proxy status to{" "}
            <b className="font-medium text-foreground">DNS only</b>.
          </li>
        ) : null}
        {certificates.length === 0 ? null : (
          <li>The _acme-challenge record gets the wildcard its https certificate.</li>
        )}
      </ul>
    </div>
  );
}

/**
 * A record's name: what goes in the provider's field in ink, the rest of the domain after it. `@`
 * says whose it is only where the table holds several domains' (`rooted`).
 */
function RecordName({ name, rooted }: { readonly name: string; readonly rooted: boolean }) {
  const host = recordHost(name);
  const rest =
    host === "@" ? (rooted ? ` ${registeredDomain(name)}` : "") : name.slice(host.length);
  return (
    <span className="block truncate font-mono">
      {host}
      <span className="text-muted-foreground/70">{rest}</span>
    </span>
  );
}

/**
 * The records on a deeper tint, so what is copied stands out of the words around it. A phone has
 * no room for a record on one line: there its value stands under its type and name, read whole.
 */
export function RecordTable({
  records,
  rooted = false,
  found = NONE_FOUND,
}: {
  readonly records: ReadonlyArray<DnsRecord>;
  readonly rooted?: boolean;
  readonly found?: ReadonlySet<string>;
}) {
  return (
    <div
      className="rounded-lg bg-muted/60 px-3 text-foreground text-sm"
      data-dns-table=""
      role="table"
    >
      <div
        className={`${COLUMNS} h-8 border-b border-border/70 text-muted-foreground text-xs max-sm:hidden`}
        role="row"
      >
        <span role="columnheader">Type</span>
        <span role="columnheader">Name</span>
        <span role="columnheader">Value</span>
        <span />
      </div>
      <div className="divide-y divide-border/70" role="rowgroup">
        {records.map((record) => {
          const there = found.has(recordKey(record));
          return (
            <div
              className={`${COLUMNS} min-h-10 max-sm:grid-cols-[3.5rem_minmax(0,1fr)_auto] max-sm:gap-y-0.5 max-sm:py-2`}
              data-record={record.type}
              data-record-found={there ? "" : undefined}
              key={recordKey(record)}
              role="row"
            >
              <span className="font-medium" role="cell">
                {record.type}
              </span>
              <span className="min-w-0 pe-3" role="cell">
                <RecordName name={record.name} rooted={rooted} />
              </span>
              <span
                className="min-w-0 truncate font-mono max-sm:col-span-2 max-sm:row-start-2 max-sm:text-xs"
                role="cell"
              >
                {record.value}
              </span>
              <span
                className="-me-1.5 flex items-center justify-end max-sm:col-start-3 max-sm:row-span-2 max-sm:row-start-1"
                role="cell"
              >
                {there ? (
                  <span className="me-1.5 inline-flex items-center gap-1 font-medium text-status-ok-text text-xs">
                    <CheckIcon aria-hidden="true" className="size-3.5" strokeWidth={2.5} />
                    Found
                  </span>
                ) : (
                  <CopyButton value={record.value} />
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A record's line: its type, its name, its value, then its copy or that it was found. */
const COLUMNS = "grid grid-cols-[4rem_minmax(0,34%)_minmax(0,1fr)_4.25rem] items-center";
