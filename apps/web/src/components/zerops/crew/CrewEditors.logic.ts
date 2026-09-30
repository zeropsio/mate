/**
 * What the Crew tab's views (PRD §4.7) compute: the free tints, *Runs on*'s
 * logins, models and effort levels from the Mate's provider catalog, where a
 * builder's copy may live, and the issues a view must not save over. Phase B
 * offers the two default logins only. One Save applies at the crewmate's
 * next message (§5.6, on the probe-22 fallback: in a fresh conversation).
 *
 * The crew home's format is `@t3tools/shared/crewHome`'s, and the form ↔
 * definition adapter is `zerops/crew/crewHome.ts`.
 */
import {
  agentIdForProviderInstance,
  type CrewDevHost,
  type CrewLogin,
  type CrewSnapshot,
  type Crewmate,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  crewDevHostDatabaseWord,
  crewNoDevHostWord,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import { MATE_TINT_IDS, type MateTintId } from "@t3tools/shared/brand";
import type { CrewDefinition, CrewDefinitionIssue } from "@t3tools/shared/crewHome";

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

/** A login's name: the catalog's, else — before the Mate's catalog is read — a default's own. */
export function crewLoginLabel(logins: ReadonlyArray<CrewLogin>, loginId: string): string {
  return (
    logins.find((login) => login.id === loginId)?.label ??
    DEFAULT_LOGINS.find((login) => login.id === loginId)?.label ??
    loginId
  );
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

/**
 * What a crewmate runs on, named as its login's catalog names them: the login,
 * then the model and effort it sets (`null` where it keeps the login's default).
 */
export function crewRunsOn(
  crewmate: Pick<Crewmate, "login" | "model" | "effort">,
  providers: ReadonlyArray<ServerProvider>,
): { readonly login: string; readonly model: string | null; readonly effort: string | null } {
  const model =
    crewmate.model === null
      ? null
      : (crewModelOptions(providers, crewmate.login.id).find(
          (option) => option.slug === crewmate.model,
        )?.name ?? crewmate.model);
  const effort =
    crewmate.effort === null
      ? null
      : (crewEffortOptions(providers, crewmate.login.id, crewmate.model).find(
          (option) => option.id === crewmate.effort,
        )?.label ?? crewmate.effort);
  return { login: crewmate.login.label, model, effort };
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
 * never "no" (a writer there must declare `env:` or `database: shared`). With
 * no service to pick at all, why: the Mate has mounted none yet.
 */
export function crewServiceHint(
  devHosts: ReadonlyArray<CrewDevHost>,
  host: string,
  crewPort: number | null,
  mateName: string,
): string | undefined {
  if (host === "") return devHosts.length === 0 ? crewNoDevHostWord(mateName) : undefined;
  const database = devHosts.find((candidate) => candidate.host === host)?.database ?? null;
  const parts = [
    crewPort === null ? null : `Crew port ${crewPort}`,
    crewDevHostDatabaseWord(database),
  ];
  return parts.filter((part) => part !== null).join(" · ");
}

/** A crewmate that changes files has nowhere for its copy: it cannot be saved or applied so. */
export const crewWriterWithoutHost = (writes: boolean, host: string): boolean =>
  writes && host.trim() === "";

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
