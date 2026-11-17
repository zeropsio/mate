/**
 * What is being done to each change now (`changeActOf`), for every door to it: the account's merge,
 * close and ask presses on changes, each by its operation's request id, and how each operation
 * stands as the data layer's progress projection says it — a subscribed read, so a settlement
 * redraws what shows it.
 *
 * A surface reads only the changes it draws (`useChangeActs`'s scope): a chip its change, a card
 * its application, so a press elsewhere redraws nothing of it.
 *
 * Kept in memory for the account's operations. An ended merge's word goes when HQ's facts of the
 * change move since the press (`changeActStands`), or when its review is opened again.
 */
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { operationProgress } from "@t3tools/client-runtime/data";
import {
  changeActOf,
  changeActStands,
  type ChangeAct,
  type ChangeFacts,
  type ChangeVerbRead,
  type FlowVerb,
} from "@t3tools/client-runtime/zerops";
import { Atom, type AtomRegistry } from "effect/reactivity";
import { useContext, useEffect } from "react";

import { useAccountOperationsOptional, type AccountOperations } from "./accountOperations";
import { useAccountDataOptional } from "./ZeropsAccountData";

type ChangeVerb = "merge" | "close" | "ask-merge";

/** A verb's last press on a change: on its way, its operation once recorded, the change as pressed. */
interface ChangePress {
  readonly pending: boolean;
  readonly requestId?: string | undefined;
  /** HQ's facts of the change at the press: its ended word holds only while they do. */
  readonly facts?: ChangeFacts | undefined;
}

type ChangePresses = Readonly<Partial<Record<ChangeVerb, ChangePress>>>;
type PressMap = ReadonlyMap<string, ChangePresses>;

/** A change's act, with the facts of the merge press it may be about. */
export interface ChangeActEntry {
  readonly act: ChangeAct;
  readonly facts?: ChangeFacts | undefined;
}

type ActMap = ReadonlyMap<string, ChangeActEntry>;

/** A change's key among the presses: its application, repository and number. */
export function changeActKey(groupId: string, repository: string, number: number): string {
  return `${groupId}/${repository}#${String(number)}`;
}

const isChangeVerb = (kind: FlowVerb["kind"]): kind is ChangeVerb =>
  kind === "merge" || kind === "close" || kind === "ask-merge";

const pressAtoms = new WeakMap<AccountOperations, Atom.Writable<PressMap>>();

function pressesOf(operations: AccountOperations): Atom.Writable<PressMap> {
  let atom = pressAtoms.get(operations);
  if (atom === undefined) {
    atom = Atom.make<PressMap>(new Map()).pipe(Atom.keepAlive);
    pressAtoms.set(operations, atom);
  }
  return atom;
}

/**
 * Records a change verb's press, its operation or its end (`patch`), or forgets an ended one
 * (`null`); a verb that is no change's is left alone.
 */
export function recordChangePress(
  registry: AtomRegistry.AtomRegistry,
  operations: AccountOperations,
  verb: FlowVerb,
  patch: Partial<ChangePress> | null,
): void {
  if (!isChangeVerb(verb.kind) || !("repository" in verb)) return;
  const kind = verb.kind;
  const atom = pressesOf(operations);
  const presses = registry.get(atom);
  const key = changeActKey(verb.groupId, verb.repository, verb.number);
  const entry = presses.get(key) ?? {};
  const before = entry[kind];
  if (patch === null && (before === undefined || before.pending)) return;
  const next: ChangePresses =
    patch === null
      ? Object.fromEntries(Object.entries(entry).filter(([verbKind]) => verbKind !== kind))
      : { ...entry, [kind]: { pending: false, ...before, ...patch } };
  registry.set(atom, new Map(presses).set(key, next));
}

/** Two act maps saying the same: a press that changes no act redraws nothing. */
function sameActs(left: ActMap, right: ActMap): boolean {
  if (left.size !== right.size) return false;
  for (const [key, entry] of left) {
    const other = right.get(key);
    if (other === undefined || JSON.stringify(other) !== JSON.stringify(entry)) return false;
  }
  return true;
}

type Data = NonNullable<ReturnType<typeof useAccountDataOptional>>["data"];

const families = new WeakMap<
  Atom.Writable<PressMap>,
  WeakMap<Data, (scope: string) => Atom.Atom<ActMap>>
>();

/**
 * Acts by change key within `scope`: every change (""), an application's (`<groupId>/`), or one
 * change (its key).
 */
function actsOf(operations: AccountOperations, data: Data): (scope: string) => Atom.Atom<ActMap> {
  const presses = pressesOf(operations);
  let byData = families.get(presses);
  if (byData === undefined) {
    byData = new WeakMap();
    families.set(presses, byData);
  }
  let family = byData.get(data);
  if (family === undefined) {
    family = Atom.family((scope: string) =>
      Atom.make((get): ActMap => {
        const acts = new Map<string, ChangeActEntry>();
        for (const [key, entry] of get(presses)) {
          if (scope !== "" && (scope.endsWith("/") ? !key.startsWith(scope) : key !== scope))
            continue;
          const read = (press: ChangePress | undefined): ChangeVerbRead | undefined =>
            press === undefined
              ? undefined
              : {
                  pending: press.pending,
                  progress:
                    press.requestId === undefined
                      ? undefined
                      : get(data.project(operationProgress, press.requestId)),
                };
          const act = changeActOf({
            merge: read(entry.merge),
            close: read(entry.close),
            ask: read(entry["ask-merge"]),
          });
          if (act === undefined) continue;
          const facts = entry.merge?.facts;
          acts.set(key, facts === undefined ? { act } : { act, facts });
        }
        return acts;
      }).pipe(Atom.withEquality(sameActs)),
    );
    byData.set(data, family);
  }
  return family;
}

const EMPTY_ACTS: ActMap = new Map();
const NO_ACTS: Atom.Atom<ActMap> = Atom.make<ActMap>(EMPTY_ACTS);

/** Which changes a surface draws: an application's, or one change of it. */
export interface ChangeActScope {
  readonly appId: string | undefined;
  readonly repository?: string | undefined;
  readonly number?: number | undefined;
}

/** The acts of the changes in `scope` (every change where none is given); none outside an account. */
export function useChangeActs(scope?: ChangeActScope): ActMap {
  const operations = useAccountOperationsOptional();
  const data = useAccountDataOptional()?.data;
  const key =
    scope === undefined
      ? ""
      : scope.appId === undefined
        ? null
        : scope.repository === undefined || scope.number === undefined
          ? `${scope.appId}/`
          : changeActKey(scope.appId, scope.repository, scope.number);
  const acts = useAtomValue(
    operations === null || data === undefined || key === null
      ? NO_ACTS
      : actsOf(operations, data)(key),
  );
  // A surface drawn with a stand-in for the atoms (a markdown preview's) reads no acts.
  return acts instanceof Map ? acts : EMPTY_ACTS;
}

/** A change's act among `acts`, as it stands for the change as HQ gives it now. */
export function changeActIn(
  acts: ActMap,
  appId: string | undefined,
  pull: {
    readonly repository?: string | undefined;
    readonly number?: number | undefined;
    readonly headSha?: string | undefined;
    readonly updatedAt?: string | undefined;
  },
): ChangeAct | undefined {
  if (appId === undefined || pull.repository === undefined || pull.number === undefined)
    return undefined;
  const entry = acts.get(changeActKey(appId, pull.repository, pull.number));
  return changeActStands(entry?.act, entry?.facts, {
    head: pull.headSha,
    updatedAt: pull.updatedAt,
  });
}

/** Opening a change's review forgets how its last merge ended: the review says anew. */
export function useMergeEndForgottenOnOpen(
  groupId: string,
  repository: string,
  number: number,
): void {
  const operations = useAccountOperationsOptional();
  const registry = useContext(RegistryContext);
  useEffect(() => {
    if (operations === null) return;
    recordChangePress(registry, operations, { kind: "merge", groupId, repository, number }, null);
  }, [groupId, number, operations, registry, repository]);
}
