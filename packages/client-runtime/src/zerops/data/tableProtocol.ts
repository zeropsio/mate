/**
 * The wire of the entity table's kinds (`entityTable.ts`): a search's answer, a list's membership
 * frame, an update frame's rows. A row without an id, or without what makes it the kind it is
 * (a variable's key), is dropped alone, never the answer it rode.
 */
import type {
  PlatformObservation,
  ReadTicket,
  RegistrationRequest,
  ServiceVariableRow,
  TableEntity,
  TableQueryReadTarget,
  TableRow,
} from "./types.ts";
import { coverageFor } from "./coverage.ts";
import type { ProtocolDecodeIssue, ProtocolDecodeResult } from "./platformProtocol.ts";

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** One row of a table kind, or `null` for one that is not readable as it. */
export function decodeTableRow(entity: TableEntity, raw: unknown): TableRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const id = text(record.id);
  if (id === null || id.length === 0) return null;
  const key = text(record.key);
  if (key === null) return null;
  return {
    id,
    serviceId: text(record.serviceStackId),
    projectId: text(record.projectId),
    key,
    content: text(record.content),
  } satisfies ServiceVariableRow;
}

function decodeRows(
  entity: TableEntity,
  items: ReadonlyArray<unknown>,
): { readonly rows: ReadonlyArray<TableRow>; readonly issues: ReadonlyArray<ProtocolDecodeIssue> } {
  const rows: TableRow[] = [];
  const issues: ProtocolDecodeIssue[] = [];
  items.forEach((raw, rowIndex) => {
    const row = decodeTableRow(entity, raw);
    if (row === null)
      issues.push({ kind: "malformed-row", message: `Malformed ${entity} row.`, rowIndex });
    else rows.push(row);
  });
  return { rows, issues };
}

const finite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** A table list's search answer — a read's, or its registration's response. */
export function decodeTableSearch(ticket: ReadTicket, input: unknown): ProtocolDecodeResult {
  const target = ticket.target as TableQueryReadTarget;
  const envelope =
    typeof input === "object" && input !== null ? (input as Record<string, unknown>) : null;
  // A read of named ids that answered none found none of them: each waits out its back-off
  // rather than being asked again at once.
  if (envelope !== null && !Array.isArray(envelope.items) && target.descriptor.ids !== undefined)
    return decodeTableSearch(ticket, { ...envelope, items: [] });
  if (envelope === null || !Array.isArray(envelope.items))
    return {
      observations: [],
      issues: [{ kind: "malformed-envelope", message: "The search answered no items." }],
    };
  const entity = "user-data";
  const { rows, issues } = decodeRows(entity, envelope.items);
  const total = finite(envelope.totalHits) ?? finite(envelope.totalCount);
  const limit = finite(envelope.limit);
  const offset = finite(envelope.offset);
  return {
    observations: [
      {
        kind: "table-rows-observed",
        entity,
        rows,
        source: "direct-read",
        coverage: coverageFor(
          envelope.items.length,
          {
            ...(limit === undefined ? {} : { limit }),
            ...(offset === undefined ? {} : { offset }),
            ...(total === undefined ? {} : { total }),
          },
          false,
        ),
        ticket: ticket as ReadTicket & { readonly target: TableQueryReadTarget },
      },
    ],
    issues,
  };
}

/** A table registration's frame: a list's added and deleted ids, or an update's whole rows. */
export function decodeTableFrame(
  registration: RegistrationRequest & {
    readonly descriptor: { readonly kind: "table-list" | "table-updates" };
  },
  data: unknown,
): ProtocolDecodeResult | null {
  const frame =
    typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
  if (frame === null) return null;
  if (registration.descriptor.kind === "table-list") {
    const add = frame.add;
    const remove = frame.delete;
    if (
      !Array.isArray(add) ||
      !Array.isArray(remove) ||
      ![...add, ...remove].every((id) => typeof id === "string")
    )
      return null;
    const listRegistration = registration as RegistrationRequest & {
      readonly descriptor: { readonly kind: "table-list" };
    };
    const observations: PlatformObservation[] = [
      ...(add as string[]).map((id) => ({
        kind: "table-membership-observed" as const,
        operation: "add" as const,
        id,
        registration: listRegistration,
      })),
      ...(remove as string[]).map((id) => ({
        kind: "table-membership-observed" as const,
        operation: "remove" as const,
        id,
        registration: listRegistration,
      })),
    ];
    return { observations, issues: [] };
  }
  if (!Array.isArray(frame.update)) return null;
  const descriptor = registration.descriptor as Extract<
    RegistrationRequest["descriptor"],
    { readonly kind: "table-updates" }
  >;
  const { rows, issues } = decodeRows(descriptor.entity, frame.update);
  return {
    observations: [
      {
        kind: "table-rows-observed",
        entity: descriptor.entity,
        rows,
        source: "native-push",
        registration: registration as RegistrationRequest & {
          readonly descriptor: { readonly kind: "table-updates" };
        },
      },
    ],
    issues,
  };
}
