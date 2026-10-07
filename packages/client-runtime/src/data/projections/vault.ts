/**
 * One project's vault as its surface reads it (`vaultModel.ts`): Shared and each runtime and
 * managed service's values, who reads each at run, each runtime's deployed run entries and where
 * their references resolve, and what is not live yet. Read only while a screen demands the
 * project's `projectVariables` and `serviceVariable` details — and its process `history`, which
 * says when each service last started and when the project last deployed.
 *
 * @module data/projections/vault
 */
import { isZcpService } from "../../zerops/containerAddress.ts";
import { isManagedDataService, isRuntimeService } from "../../zerops/topology.ts";
import { projectVariablesScope, type VariableRow } from "../families/projectVariables.ts";
import { serviceVariablesScope, type ServiceVariableValue } from "../families/serviceVariables.ts";
import type { ServiceValue } from "../families/service.ts";
import type { ScopeKey } from "../model.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { sameValue } from "./equal.ts";
import type {
  VaultNotLive,
  VaultRead,
  VaultScope,
  VaultScopeRef,
  VaultValue,
  VaultView,
} from "./vaultModel.ts";
import {
  readerState,
  readersOf,
  refsOf,
  valueIdOf,
  type RefService,
  type RefWorld,
} from "./vaultReferences.ts";

export interface VaultKey {
  /** The organization whose link observes the project. */
  readonly orgId: string;
  readonly projectId: string;
}

/** The processes after which a service's containers run what its variables said then. */
const START_ACTIONS: ReadonlySet<string> = new Set([
  "stack.build",
  "stack.deploy",
  "stack.restart",
  "stack.start",
]);
const DEPLOY_ACTIONS: ReadonlySet<string> = new Set(["stack.build", "stack.deploy"]);

/** A managed service's platform rows that say who it is, not what an app connects with. */
const isIdentityNoise = (key: string) =>
  key === "projectId" || key === "serviceId" || key.startsWith("ZEROPS_");

const isUser = (row: { readonly type: string }) => row.type === "USER";
const isSystem = (row: { readonly type: string }) => row.type === "SYSTEM";

const after = (left: string | null, right: string | null): boolean =>
  left !== null && right !== null && Date.parse(left) > Date.parse(right);

const newest = (left: string | null, right: string | undefined): string | null =>
  right === undefined || (left !== null && !after(right, left)) ? left : right;

/** When each service last started, and the project's newest deploy, from its finished processes. */
function startsOf(read: ProjectionReads, projectId: string) {
  const startedAt = new Map<string, string>();
  let deployedAt: string | null = null;
  for (const id of read.index("project", projectId)) {
    const fact = read.fact("process", id);
    if (fact.kind !== "known") continue;
    const process = fact.value;
    if (process.status !== "FINISHED" || !START_ACTIONS.has(process.actionName)) continue;
    if (DEPLOY_ACTIONS.has(process.actionName)) deployedAt = newest(deployedAt, process.finished);
    for (const serviceId of process.serviceStackIds) {
      const at = newest(startedAt.get(serviceId) ?? null, process.finished);
      if (at !== null) startedAt.set(serviceId, at);
    }
  }
  return { startedAt, deployedAt };
}

type ServiceKind = RefService["kind"];

const kindOf = (service: ServiceValue): ServiceKind =>
  isZcpService(service)
    ? "other"
    : isRuntimeService(service)
      ? "runtime"
      : isManagedDataService(service)
        ? "managed"
        : "other";

interface Held {
  readonly id: string;
  readonly row: ServiceVariableValue;
}

/** A service's rows, sorted into what references and the surface see. */
function sortRows(kind: ServiceKind, rows: ReadonlyArray<Held>) {
  const system = new Set<string>();
  const entries = new Map<string, string>();
  const values: Held[] = [];
  for (const held of rows) {
    const { row } = held;
    if (kind === "managed") {
      if (isSystem(row) && isIdentityNoise(row.key)) system.add(row.key);
      else values.push(held);
      continue;
    }
    if (isSystem(row)) system.add(row.key);
    else if (isUser(row) && row.editable) values.push(held);
    else if (isUser(row)) entries.set(row.key, row.value ?? "");
  }
  return { system, entries, values };
}

/** The service's type and version without the OS the platform may prefix (`ubuntu/nodejs@22`). */
const typeOf = (service: ServiceValue): string | null => {
  const type = service.serviceStackTypeInfo?.serviceStackTypeVersionName;
  return type == null ? null : type.slice(type.indexOf("/") + 1);
};

const byKey = <T extends { readonly key: string }>(left: T, right: T) =>
  left.key.localeCompare(right.key);

const failing = (read: ProjectionReads, scope: ScopeKey) => {
  const { phase } = read.stream(scope);
  return phase === "refused" || phase === "recovering";
};

export const vault: Projection<VaultKey, VaultView> = {
  name: "vault",
  keyOf: ({ orgId, projectId }) => `${orgId}/${projectId}`,
  derive: (read, { orgId, projectId }) => {
    const sharedScope = projectVariablesScope(orgId, projectId);
    const servicesScope = serviceVariablesScope(orgId, projectId);
    const coverage = [read.coverage(sharedScope), read.coverage(servicesScope)];
    const status: VaultView["status"] =
      failing(read, sharedScope) || failing(read, servicesScope)
        ? "failed"
        : coverage.includes("unknown")
          ? "unread"
          : "ready";
    // An absence proves nothing until both answers are whole: nothing is "unread" or "missing".
    const whole = coverage.every((each) => each === "complete");

    const projectFact = read.fact("projectVariables", projectId);
    const sharedRows: ReadonlyArray<VariableRow> =
      projectFact.kind === "known" ? projectFact.value.rows : [];
    const sharedValues = sharedRows.filter(isUser);

    const rowsByService = new Map<string, Held[]>();
    for (const id of read.members(servicesScope).ids) {
      const fact = read.fact("serviceVariable", id);
      if (fact.kind !== "known") continue;
      const list = rowsByService.get(fact.value.serviceId) ?? [];
      list.push({ id, row: fact.value });
      rowsByService.set(fact.value.serviceId, list);
    }

    const services: Array<{
      readonly service: ServiceValue;
      readonly ref: RefService;
      readonly values: ReadonlyArray<Held>;
    }> = [];
    for (const id of read.index("serviceProject", projectId)) {
      const fact = read.fact("service", id);
      if (fact.kind !== "known" || fact.value.isSystem === true) continue;
      const kind = kindOf(fact.value);
      const { system, entries, values } = sortRows(kind, rowsByService.get(id) ?? []);
      services.push({
        service: fact.value,
        values,
        ref: {
          serviceId: id,
          hostname: fact.value.name,
          kind,
          system,
          entries,
          own: new Map(values.map(({ row }) => [row.key, row.value])),
        },
      });
    }
    services.sort((left, right) => left.ref.hostname.localeCompare(right.ref.hostname));

    const world: RefWorld = {
      shared: new Map(sharedValues.map((row) => [row.key, row.value])),
      sharedSystem: new Set(sharedRows.filter(isSystem).map((row) => row.key)),
      services: services.map(({ ref }) => ref),
    };
    const readers = readersOf(world);
    const { startedAt, deployedAt } = startsOf(read, projectId);

    const valueOf = (
      scope: VaultScopeRef,
      id: string,
      row: Omit<VariableRow, "id">,
      madeByZerops: boolean,
    ): VaultValue => ({
      id,
      key: row.key,
      sensitive: row.sensitive,
      value: row.sensitive ? null : row.value,
      createdAt: row.created,
      changedAt: row.lastUpdate,
      madeByZerops,
      readers: (readers.get(valueIdOf(scope, row.key)) ?? []).map((reader) => ({
        ...reader,
        state: readerState(startedAt.get(reader.serviceId) ?? null, row.lastUpdate),
      })),
    });

    const shared: VaultScope = {
      ref: { kind: "shared" },
      id: "shared",
      hostname: null,
      kind: "shared",
      serviceType: null,
      editable: true,
      values: sharedValues
        .map((row) => valueOf({ kind: "shared" }, row.id, row, false))
        .sort(byKey),
      reads: [],
      startedAt: null,
    };
    const serviceScope = ({ service, ref, values }: (typeof services)[number]): VaultScope => {
      const scopeRef: VaultScopeRef = { kind: "service", serviceId: ref.serviceId };
      return {
        ref: scopeRef,
        id: ref.serviceId,
        hostname: ref.hostname,
        kind: ref.kind === "managed" ? "managed" : "runtime",
        serviceType: typeOf(service),
        editable: ref.kind === "runtime",
        values: values.map(({ id, row }) => valueOf(scopeRef, id, row, isSystem(row))).sort(byKey),
        reads: [...ref.entries.keys()].sort().map((key): VaultRead => ({
          key,
          template: ref.entries.get(key) ?? "",
          refs: refsOf(world, ref, key),
        })),
        startedAt: ref.kind === "runtime" ? (startedAt.get(ref.serviceId) ?? null) : null,
      };
    };
    const runtimes = services.filter(({ ref }) => ref.kind === "runtime").map(serviceScope);
    const managed = services.filter(({ ref }) => ref.kind === "managed").map(serviceScope);
    const scopes = [shared, ...runtimes, ...managed];

    return { status, scopes, notLive: notLiveOf(scopes, deployedAt, whole) };
  },
  equals: sameValue,
};

/** What is not live yet: restarts by service, literal references, values nothing reads yet. */
function notLiveOf(
  scopes: ReadonlyArray<VaultScope>,
  deployedAt: string | null,
  whole: boolean,
): ReadonlyArray<VaultNotLive> {
  const restarts = new Map<string, { hostname: string; keys: Set<string> }>();
  const literal: VaultNotLive[] = [];
  const unread: VaultNotLive[] = [];
  for (const scope of scopes) {
    for (const value of scope.values) {
      for (const reader of value.readers) {
        if (reader.state !== "restart") continue;
        const restart = restarts.get(reader.serviceId) ?? {
          hostname: reader.hostname,
          keys: new Set<string>(),
        };
        restart.keys.add(value.key);
        restarts.set(reader.serviceId, restart);
      }
      const written = value.changedAt ?? value.createdAt;
      if (
        whole &&
        scope.editable &&
        value.readers.length === 0 &&
        (deployedAt === null || written === null || after(written, deployedAt))
      )
        unread.push({ kind: "unread", scope: scope.ref, key: value.key });
    }
    if (scope.hostname === null) continue;
    for (const entry of scope.reads)
      for (const ref of entry.refs) {
        if (ref.kind === "self" && ref.name === entry.key)
          literal.push({
            kind: "self",
            serviceId: scope.id,
            hostname: scope.hostname,
            entry: entry.key,
          });
        if (ref.kind === "missing" && whole)
          literal.push({
            kind: "missing",
            serviceId: scope.id,
            hostname: scope.hostname,
            entry: entry.key,
            name: ref.name,
          });
      }
  }
  const restart = [...restarts]
    .sort(([, left], [, right]) => left.hostname.localeCompare(right.hostname))
    .map(([serviceId, { hostname, keys }]): VaultNotLive => ({
      kind: "restart",
      serviceId,
      hostname,
      keys: [...keys].sort(),
    }));
  return [...restart, ...literal, ...unread];
}
