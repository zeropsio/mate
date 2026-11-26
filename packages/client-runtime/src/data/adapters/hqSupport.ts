import { HqError, type HqApi } from "../../zerops/hq/client.ts";

export type SupportEntry =
  | { readonly kind: "go"; readonly exchange: string }
  | { readonly kind: "denied" }
  | { readonly kind: "signed-out" }
  | { readonly kind: "unavailable" };

export function supportEntryOf(
  outcome:
    | { readonly ok: true; readonly exchange: string }
    | { readonly ok: false; readonly error: unknown },
): SupportEntry {
  if (outcome.ok) {
    return outcome.exchange.length > 0
      ? { kind: "go", exchange: outcome.exchange }
      : { kind: "unavailable" };
  }
  if (outcome.error instanceof HqError && outcome.error.kind === "refused") {
    if (outcome.error.status === 403) return { kind: "denied" };
    if (outcome.error.status === 401) return { kind: "signed-out" };
  }
  return { kind: "unavailable" };
}

export async function supportEntry(hq: Pick<HqApi, "supportExchange">): Promise<SupportEntry> {
  try {
    const { exchange } = await hq.supportExchange();
    return supportEntryOf({ ok: true, exchange });
  } catch (error) {
    return supportEntryOf({ ok: false, error });
  }
}
