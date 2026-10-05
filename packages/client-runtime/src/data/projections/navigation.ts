/**
 * One menu row (HANDOFF §4.5): an application HQ holds — its projects, its Mates, whether work runs
 * in any of them, each Mate's attention — or a project HQ places in no application, which Zerops
 * alone lists. Join rule: Zerops establishes a project's identity, HQ places it, a running process
 * lights its project until its own end, a Mate's attention is its own value whichever path
 * delivered it. The row derives its combined status from the streams it read: live, catching up,
 * partly missing, or refused.
 *
 * Pure: reads keyed facts through {@link ProjectionReads}, never a table, a client or a clock.
 *
 * @module data/projections/navigation
 */
import { scopeKeys, type AttentionValue, type PublicRead, type StreamKey } from "../model.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import type { Phase } from "../streamMachine.ts";

export type RowKey =
  | { readonly kind: "app"; readonly appId: string }
  | { readonly kind: "project"; readonly projectId: string };

export interface MenuRowKey {
  readonly orgId: string;
  readonly row: RowKey;
}

/** A field as its source said it: ready (fresh while its stream is live), not said yet, or hidden. */
export type Field<T> =
  | { readonly kind: "ready"; readonly value: T; readonly fresh: boolean }
  | { readonly kind: "pending" }
  | { readonly kind: "withheld" };

export interface MenuRowProject {
  readonly projectId: string;
  readonly name: Field<string>;
  /** Its kind as HQ places it; `null` while HQ has not placed it. */
  readonly role: string | null;
  readonly running: boolean;
  /** A Mate's attention; `null` for a project that is no Mate. */
  readonly attention: Field<AttentionValue> | null;
}

export type Lagging =
  | { readonly input: StreamKey; readonly phase: Phase }
  /** A relayed value whose author's link to the relay is down. */
  | { readonly input: "producer"; readonly projectId: string };

export interface CombinedStatus {
  readonly display: "live" | "catching-up" | "partial" | "refused";
  /** Each input not live, naming the stream whose next action recovers it. */
  readonly lagging: ReadonlyArray<Lagging>;
}

export interface MenuRow {
  readonly title: Field<string>;
  readonly running: Field<boolean>;
  readonly projects: ReadonlyArray<MenuRowProject>;
  readonly status: CombinedStatus;
}

const PENDING = { kind: "pending" } as const;
const WITHHELD = { kind: "withheld" } as const;
const isDead = (phase: Phase) => phase === "refused" || phase === "unsupported";

/** The row's reads, remembering every stream it read through and every producer leg down. */
function tracked(read: ProjectionReads) {
  const streams = new Set<StreamKey>();
  const producersDown: string[] = [];
  const field = <T, U>(fact: PublicRead<T>, pick: (value: T) => U, owner: string): Field<U> => {
    if (fact.kind === "withheld") return WITHHELD;
    if (fact.kind !== "known") return PENDING;
    streams.add(fact.scope);
    if (fact.producer === "down") producersDown.push(owner);
    return {
      kind: "ready",
      value: pick(fact.value),
      fresh: read.stream(fact.scope).phase === "live" && fact.producer !== "down",
    };
  };
  return { streams, producersDown, field };
}

export const menuRow: Projection<MenuRowKey, MenuRow> = {
  name: "menuRow",
  keyOf: ({ orgId, row }) =>
    `${orgId}/${row.kind}/${row.kind === "app" ? row.appId : row.projectId}`,
  equals: (left, right) => JSON.stringify(left) === JSON.stringify(right),
  derive: (read, { orgId, row }) => {
    const projectsScope = scopeKeys.projects(orgId);
    const runningScope = scopeKeys.running(orgId);
    const navigation = scopeKeys.navigation(orgId);
    const { streams, producersDown, field } = tracked(read);
    streams.add(projectsScope);
    streams.add(runningScope);
    streams.add(navigation);

    const ids = row.kind === "app" ? [...read.app(row.appId)].sort() : [row.projectId];
    const projects = ids.map((projectId): MenuRowProject => {
      const placement = read.fact("placement", projectId);
      const role =
        placement.kind !== "known"
          ? null
          : placement.value.kind === "app"
            ? placement.value.role
            : "mate";
      const attention = read.fact("attention", projectId);
      return {
        projectId,
        name: field(read.fact("project", projectId), (project) => project.name, projectId),
        role,
        running: read.running(projectId).size > 0,
        attention:
          role === "mate" || attention.kind === "known"
            ? field(attention, (value) => value, projectId)
            : null,
      };
    });

    const first = ids[0];
    const title =
      row.kind === "project"
        ? (projects[0]?.name ?? PENDING)
        : first === undefined
          ? PENDING
          : field(
              read.fact("placement", first),
              (placement) => (placement.kind === "app" ? placement.appName : ""),
              first,
            );
    const running: Field<boolean> =
      read.coverage(runningScope) === "complete"
        ? {
            kind: "ready",
            value: projects.some((project) => project.running),
            fresh: read.stream(runningScope).phase === "live",
          }
        : PENDING;

    const required: ReadonlyArray<StreamKey> =
      row.kind === "app" ? [projectsScope, navigation] : [projectsScope];
    const lagging: Lagging[] = [];
    for (const key of streams) {
      const { phase } = read.stream(key);
      if (phase !== "live") lagging.push({ input: key, phase });
    }
    for (const projectId of producersDown) lagging.push({ input: "producer", projectId });
    const display: CombinedStatus["display"] = required.some((key) =>
      isDead(read.stream(key).phase),
    )
      ? "refused"
      : projects.some((project) => project.name.kind !== "ready") ||
          [...streams].some((key) => isDead(read.stream(key).phase))
        ? "partial"
        : lagging.length > 0
          ? "catching-up"
          : "live";
    return { title, running, projects, status: { display, lagging } };
  },
};

/**
 * The menu's rows in order: each application HQ places a listed project in, once, where its first
 * project stands in Zerops' list; every other listed project as a row of its own. Reads the
 * roster and placements only, so a name, a process or an attention never reorders the menu.
 */
export const menuRowKeys: Projection<string, ReadonlyArray<RowKey>> = {
  name: "menuRowKeys",
  keyOf: (orgId) => orgId,
  equals: (left, right) => JSON.stringify(left) === JSON.stringify(right),
  derive: (read, orgId) => {
    const roster = read.members(scopeKeys.projects(orgId));
    const placed = new Set(read.members(scopeKeys.navigation(orgId)).ids);
    const rows: RowKey[] = [];
    const apps = new Set<string>();
    for (const projectId of [...roster.ids, ...roster.unverified]) {
      const placement = read.fact("placement", projectId);
      if (placement.kind !== "known" || placement.value.kind !== "app" || !placed.has(projectId)) {
        rows.push({ kind: "project", projectId });
        continue;
      }
      if (apps.has(placement.value.appId)) continue;
      apps.add(placement.value.appId);
      rows.push({ kind: "app", appId: placement.value.appId });
    }
    return rows;
  },
};
