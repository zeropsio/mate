/**
 * The operation kinds this account submits. A new kind is one module beside these and one line
 * here.
 *
 * @module data/operations/kinds
 */
import type { OperationIntent } from "../model.ts";
import type { AnyOperationKind, OperationKind } from "./kind.ts";

/** The registry, checked once at startup: each kind once. */
export function defineOperationKinds(
  kinds: ReadonlyArray<AnyOperationKind>,
): ReadonlyArray<AnyOperationKind> {
  const seen = new Set<string>();
  for (const { kind } of kinds) {
    if (seen.has(kind)) throw new Error(`The data layer registers operation kind ${kind} twice.`);
    seen.add(kind);
  }
  return kinds;
}

export const OPERATION_KINDS = defineOperationKinds([]);

/** A kind's name, read the same way whether or not any kind is registered yet. */
const nameOf = (named: { readonly kind: string }) => named.kind;

const byKind = new Map<string, AnyOperationKind>(
  OPERATION_KINDS.map((kind) => [nameOf(kind as { readonly kind: string }), kind]),
);

export function operationKind<Intent extends OperationIntent>(
  intent: Intent,
): OperationKind<Intent["kind"]> {
  const name = nameOf(intent as { readonly kind: string });
  const kind = byKind.get(name);
  if (kind === undefined) throw new Error(`No operation kind ${name} is registered.`);
  return kind as unknown as OperationKind<Intent["kind"]>;
}
