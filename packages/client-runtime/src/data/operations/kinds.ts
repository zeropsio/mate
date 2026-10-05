/**
 * The operation kinds this account submits. A new kind is one module beside these and one line
 * here.
 *
 * @module data/operations/kinds
 */
import type { OperationIntent } from "../model.ts";
import type { AnyOperationKind, OperationKind } from "./kind.ts";
import { moveProject } from "./moveProject.ts";

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

export const OPERATION_KINDS = defineOperationKinds([moveProject]);

const byKind = new Map<string, AnyOperationKind>(OPERATION_KINDS.map((kind) => [kind.kind, kind]));

export function operationKind<Intent extends OperationIntent>(
  intent: Intent,
): OperationKind<Intent["kind"]> {
  const kind = byKind.get(intent.kind);
  if (kind === undefined) throw new Error(`No operation kind ${intent.kind} is registered.`);
  return kind as unknown as OperationKind<Intent["kind"]>;
}
