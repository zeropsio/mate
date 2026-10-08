/**
 * A call's echo: the `tool.updated` row a provider sends with the call's
 * completion — stamped with the completion's instant and carrying its payload,
 * only its status still "inProgress". Run 12: every one of the 174 updates in
 * Sage's thread was one, each browser check's screenshot in both rows, so a
 * live page held every such picture twice. The server's snapshot and the
 * client's live reducer both drop an echo, wherever it sorts — with no
 * sequence, rows of one instant sort by their random ids. Any other update,
 * one after the completion with new output included, is kept.
 */
import type { OrchestrationThreadActivity } from "@t3tools/contracts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The call a lifecycle row belongs to: its runtime item id, then the legacy
 * nested id, and finally the itemType/title/detail triple. Null for a row
 * that names no call.
 */
export function toolLifecycleIdentity(activity: OrchestrationThreadActivity): string | null {
  const payload = asRecord(activity.payload);
  if (!payload) {
    return null;
  }

  const toolCallId =
    asTrimmedString(payload.toolCallId) ?? asTrimmedString(asRecord(payload.data)?.toolCallId);
  if (toolCallId) {
    return `id:${toolCallId}`;
  }

  const itemType = asTrimmedString(payload.itemType) ?? "";
  // Mirrors the clients' `normalizeCompactToolLabel`: a completion's title may
  // gain a trailing "complete"/"completed" the in-flight updates lack.
  const label = (asTrimmedString(payload.title) ?? activity.summary)
    .replace(/\s+(?:complete|completed)\s*$/iu, "")
    .trim();
  const detail = asTrimmedString(payload.detail) ?? "";
  if (itemType.length === 0 && label.length === 0 && detail.length === 0) {
    return null;
  }
  return [itemType, label, detail].join("\u0000");
}

/**
 * Where a row's echo or completion would be found: its call, turn and instant.
 * Null for a row that is neither an update nor a completion of a named call.
 */
export function toolCallEchoKey(activity: OrchestrationThreadActivity): string | null {
  if (activity.kind !== "tool.updated" && activity.kind !== "tool.completed") return null;
  const identity = toolLifecycleIdentity(activity);
  if (identity === null) return null;
  return `${activity.turnId ?? ""}\u0000${identity}\u0000${activity.createdAt}`;
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left)) {
    return (
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => sameValue(entry, right[index]))
    );
  }
  const a = asRecord(left);
  const b = asRecord(right);
  if (a === null || b === null) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => key in b && sameValue(a[key], b[key]))
  );
}

/**
 * Whether `update` is `completion`'s echo: the same call, turn and instant,
 * and the same payload but for status, `data.wrote` and captured-image ownership.
 */
export function isToolCallEcho(
  update: OrchestrationThreadActivity,
  completion: OrchestrationThreadActivity,
): boolean {
  if (update.kind !== "tool.updated" || completion.kind !== "tool.completed") return false;
  const key = toolCallEchoKey(update);
  if (key === null || key !== toolCallEchoKey(completion)) return false;
  const a = asRecord(update.payload);
  const b = asRecord(completion.payload);
  if (a === null || b === null) return false;
  return sameValue(comparedPart(a), comparedPart(b));
}

/**
 * What of a payload an echo shares with its completion: all but its status,
 * and but the projection's `data.wrote` mark — an update stored projected
 * before the mark existed lacks it, while its completion, stored whole, gains
 * it on every read. Captured pictures compare their retained original, not
 * the occurrence metadata each activity owns.
 */
function comparedPart(payload: Record<string, unknown>): Record<string, unknown> {
  const { status: _status, ...rest } = payload;
  const data = asRecord(rest.data);
  if (data === null) return rest;
  const { wrote: _wrote, ...dataRest } = data;
  const zerops = asRecord(dataRest.zerops);
  if (zerops && Array.isArray(zerops.images)) {
    dataRest.zerops = {
      ...zerops,
      images: zerops.images.map((value: unknown) => {
        const image = asRecord(value);
        const original = asRecord(asRecord(image?.asset)?.original);
        // An occurrence owns bytes for one activity; its identity is not picture content.
        // Only a retained digest proves equality. Failed captures keep their identities.
        return image &&
          original?.status === "ready" &&
          typeof original.digest === "string" &&
          /^[a-f0-9]{64}$/u.test(original.digest)
          ? { ...image, asset: { original } }
          : value;
      }),
    };
  }
  return { ...rest, data: dataRest };
}
