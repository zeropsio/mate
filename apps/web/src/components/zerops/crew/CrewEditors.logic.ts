/**
 * What the crew editors (PRD §4.7) compute: the edited crew home, the save
 * choices (§5.6, on the probe-22 fallback: a next-turn save starts a fresh
 * conversation), when a job changed enough to start fresh, the free tints,
 * and *Runs on*'s logins, models and effort levels from the Mate's provider
 * catalog. Phase B offers the two default logins only.
 *
 * The crew home's format is `@t3tools/shared/crewHome`'s, and the form ↔
 * definition adapter is `zerops/crew/crewHome.ts`.
 */
import {
  agentIdForProviderInstance,
  type CrewApplyChoice,
  type CrewDevHost,
  type CrewLogin,
  type CrewSnapshot,
  type Crewmate,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  crewApplyWord,
  crewDevHostDatabaseWord,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import { MATE_TINT_IDS, type MateTintId } from "@t3tools/shared/brand";
import type { CrewDefinition, CrewDefinitionIssue } from "@t3tools/shared/crewHome";

export interface CrewSaveChoice {
  readonly apply: CrewApplyChoice;
  readonly label: string;
  readonly description: string;
}

/** The split save button's choices; the first is the default. */
export const CREW_SAVE_CHOICES: ReadonlyArray<CrewSaveChoice> = [
  {
    apply: "nextTurn",
    label: "Save — the next turn starts a fresh conversation",
    description: "Each crewmate it applies to starts its next turn in a new conversation.",
  },
  {
    apply: "now",
    label: "Save and apply now",
    description: "Interrupts working crewmates, keeps their work and continues with the change.",
  },
  {
    apply: "fresh",
    label: "Save and start fresh",
    description: "New conversations now, started from the task, the branch and the last report.",
  },
];

/** CONCEPT §3A.3's docs-derived figure, until probe 19 measures it. */
export const CREW_APPLY_COST_LINE =
  "Applying re-reads this crewmate’s conversation once (up to about $1.25 at 200k context)";

/** More than half of the job's lines changed: a fresh conversation follows it better. */
export function jobChangedMostly(before: string, after: string): boolean {
  const lines = (text: string) => text.split(/\r?\n/u).filter((line) => line.trim() !== "");
  const old = lines(before);
  if (old.length === 0) return false;
  const kept = new Set(lines(after));
  const changed = old.filter((line) => !kept.has(line)).length;
  return changed * 2 > old.length;
}

/** The tints a crewmate may take: its own and those nobody else wears, never the Mate's. */
export function freeTints(
  definition: CrewDefinition,
  handle: string | null,
  mateTint: MateTintId | undefined,
): ReadonlyArray<MateTintId> {
  const taken = new Set(
    definition.members.flatMap((member) =>
      member.handle !== handle && member.tint !== undefined ? [member.tint] : [],
    ),
  );
  return MATE_TINT_IDS.filter((tint) => tint !== mateTint && !taken.has(tint));
}

/** The provider instances that are Mate logins in phase B: the two defaults. */
const DEFAULT_LOGINS: ReadonlyArray<{ readonly id: string; readonly label: string }> = [
  { id: "claudeAgent", label: "Claude Code" },
  { id: "codex", label: "Codex" },
];

/**
 * The logins a crewmate may run on. The lead needs the crew tools, which
 * only Claude hosts in phase C, so it is offered no Codex login.
 */
export function crewLoginOptions(
  providers: ReadonlyArray<ServerProvider>,
  lead: boolean,
): ReadonlyArray<CrewLogin> {
  return DEFAULT_LOGINS.flatMap((login) => {
    const agent = agentIdForProviderInstance(login.id);
    const present = providers.some((provider) => provider.instanceId === login.id);
    return present && agent !== undefined && !(lead && agent === "codex")
      ? [{ id: login.id, label: login.label, agent }]
      : [];
  });
}

/**
 * What *Runs on* says about the chosen login, if anything: a Codex crewmate
 * runs code-only in phase C, and only the person's *Land* completes its task.
 */
export function crewLoginNote(
  logins: ReadonlyArray<CrewLogin>,
  loginId: string,
): string | undefined {
  return logins.find((login) => login.id === loginId)?.agent === "codex"
    ? "A Codex crewmate works on code only, with no Zerops tools. Its task is done when you land it."
    : undefined;
}

export function crewModelOptions(
  providers: ReadonlyArray<ServerProvider>,
  loginId: string,
): ReadonlyArray<{ readonly slug: string; readonly name: string }> {
  const provider = providers.find((candidate) => candidate.instanceId === loginId);
  return (provider?.models ?? []).map((model) => ({ slug: model.slug, name: model.name }));
}

/** A model's effort levels: its `effort` (Claude) or `reasoningEffort` (Codex) choices. */
export function crewEffortOptions(
  providers: ReadonlyArray<ServerProvider>,
  loginId: string,
  modelSlug: string | null,
): ReadonlyArray<{ readonly id: string; readonly label: string }> {
  if (modelSlug === null) return [];
  const model = providers
    .find((candidate) => candidate.instanceId === loginId)
    ?.models.find((candidate) => candidate.slug === modelSlug);
  const descriptor = model?.capabilities?.optionDescriptors?.find(
    (candidate) =>
      candidate.type === "select" &&
      (candidate.id === "effort" || candidate.id === "reasoningEffort"),
  );
  return descriptor?.type === "select"
    ? descriptor.options.map((option) => ({ id: option.id, label: option.label }))
    : [];
}

/**
 * Where a crewmate's copy may live: the dev services the engine names, with
 * whether each reaches a database, and any host the crew already names, so an
 * edit never loses one (its database unknown).
 */
export function crewDevHosts(
  crew: Pick<CrewSnapshot, "devHosts"> & {
    readonly hosts: ReadonlyArray<{ readonly host: string }>;
  },
): ReadonlyArray<CrewDevHost> {
  const named = new Set(crew.devHosts.map((host) => host.host));
  return [
    ...crew.devHosts,
    ...crew.hosts
      .filter((host) => !named.has(host.host))
      .map((host): CrewDevHost => ({ host: host.host, database: null })),
  ];
}

/**
 * What the *Service* field says under the picked service: its crew port, and
 * whether it reaches a database — "unknown" while the engine has not read it,
 * never "no" (a writer there must declare `env:` or `database: shared`).
 */
export function crewServiceHint(
  devHosts: ReadonlyArray<CrewDevHost>,
  host: string,
  crewPort: number | null,
): string | undefined {
  if (host === "") return undefined;
  const database = devHosts.find((candidate) => candidate.host === host)?.database ?? null;
  const parts = [
    crewPort === null ? null : `Crew port ${crewPort}`,
    crewDevHostDatabaseWord(database),
  ];
  return parts.filter((part) => part !== null).join(" · ");
}

export interface CrewApplyStep {
  readonly id: string;
  readonly label: string;
  readonly state: "queued" | "running" | "done" | "failed";
  readonly stateLabel: string;
}

/** Apply's progress per crewmate (PRD §4.7): its copy being created, set up, ready or failed. */
export function crewApplyProgress(
  crewmates: ReadonlyArray<Crewmate>,
): ReadonlyArray<CrewApplyStep> {
  return crewmates.map((mate): CrewApplyStep => {
    const step = { id: mate.handle, label: mate.displayName, stateLabel: crewApplyWord(mate) };
    switch (mate.lane?.state) {
      case "creating":
      case "setting-up":
        return { ...step, state: "running" };
      case "missing":
      case "failed":
        return { ...step, state: "failed" };
      case undefined:
      case "ready":
      case "conflicts":
      case "frozen":
        return { ...step, state: "done" };
    }
  });
}
/**
 * The issues an editor must not save over: an editor writes crew.yaml back
 * from the parsed definition, so a field it could not read would be dropped.
 * Every other issue is one an editor exists to fix.
 */
export function crewRewriteBlockers(
  issues: ReadonlyArray<CrewDefinitionIssue>,
): ReadonlyArray<CrewDefinitionIssue> {
  return issues.filter((issue) => issue.code === "field-unknown" || issue.code === "field-type");
}
