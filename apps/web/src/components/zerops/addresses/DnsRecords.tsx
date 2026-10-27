/**
 * The records a domain needs at the person's DNS provider, to copy: its A and AAAA, a wildcard's
 * certificate CNAME, and the one-CNAME way where the project's zone allows it (`recordsOf`). The
 * addresses sheet and an approved domain's card draw the same block.
 */
import type { DnsRecord } from "@t3tools/client-runtime/data";

import { CopyButton } from "./AddressesSheetBits";

export function DnsRecords({
  records,
  bothRequired,
  cnames,
  certificates,
}: {
  readonly records: ReadonlyArray<DnsRecord>;
  readonly bothRequired: boolean;
  readonly cnames: ReadonlyArray<DnsRecord & { readonly ipv4: boolean }>;
  readonly certificates: ReadonlyArray<DnsRecord>;
}) {
  return (
    <div className="grid gap-2.5 text-xs" data-dns-records="">
      <RecordTable records={[...records, ...certificates]} />
      {bothRequired ? (
        <p className="text-muted-foreground">Keep both: the shared IPv4 needs the AAAA.</p>
      ) : null}
      {certificates.length === 0 ? null : (
        <p className="text-muted-foreground">
          Keep the _acme-challenge CNAME either way: it gets the wildcard its certificate.
        </p>
      )}
      {cnames.length === 0 ? null : (
        <div className="grid gap-1.5" data-dns-way="cname">
          <p className="font-medium">Or one CNAME instead of the A and AAAA</p>
          <RecordTable head={false} records={cnames} />
          <p className="text-muted-foreground">
            For a subdomain, or an apex your DNS provider can flatten.
            {cnames.some((cname) => !cname.ipv4)
              ? " IPv4 visitors need Shared IPv4 in the CNAME (Zerops › Public access)."
              : null}
          </p>
        </div>
      )}
    </div>
  );
}

/** The columns line up from table to table; a later one goes without its header. */
function RecordTable({
  records,
  head = true,
}: {
  readonly records: ReadonlyArray<DnsRecord>;
  readonly head?: boolean;
}) {
  return (
    <table className="w-full table-fixed">
      <colgroup>
        <col className="w-16" />
        <col className="w-[38%]" />
        <col />
        <col className="w-8" />
      </colgroup>
      {head ? (
        <thead className="text-muted-foreground">
          <tr>
            <th className="pb-1 text-left font-normal">Type</th>
            <th className="pb-1 text-left font-normal">Name</th>
            <th className="pb-1 text-left font-normal">Value</th>
            <th />
          </tr>
        </thead>
      ) : null}
      <tbody>
        {records.map((record) => (
          <tr
            className="border-t border-border/50"
            data-record={record.type}
            key={`${record.type}:${record.name}`}
          >
            <td className="py-1 font-medium">{record.type}</td>
            <td className="truncate py-1 font-mono">{record.name}</td>
            <td className="truncate py-1 font-mono">{record.value}</td>
            <td className="py-0.5 text-right">
              <CopyButton value={record.value} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
