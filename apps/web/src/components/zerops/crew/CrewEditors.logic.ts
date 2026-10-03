/**
 * What the Crew tab's views (PRD §4.7) compute: the free tints, *Runs on*'s
 * logins, models and effort levels from the Mate's provider catalog, where a
 * builder's copy may live, and the issues a view must not save over. One Save applies at the crewmate's
 * next message (§5.6, on the probe-22 fallback: in a fresh conversation).
 *
 * The crew home's format is `@t3tools/shared/crewHome`'s, and the form ↔
 * definition adapter is `zerops/crew/crewHome.ts`.
 */
import {
  agentIdForDriverKind,
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

/** A login *Runs on* offers: whether its agent also hosts the crew tools. */
export interface CrewLoginOption extends CrewLogin {
  readonly tools: boolean;
}

/**
 * The logins a crewmate may run on: every installed, enabled one whose agent
 * carries the crew's rules (`threadProfile`). The lead hands out and lands
 * the work with the crew tools, so it is offered only an agent that hosts them.
 */
export function crewLoginOptions(
  providers: ReadonlyArray<ServerProvider>,
  lead: boolean,
): ReadonlyArray<CrewLoginOption> {
  return providers.flatMap((provider) => {
    const profile = provider.threadProfile;
    if (!provider.enabled || !provider.installed || profile === undefined) return [];
    if (lead && !profile.tools) return [];
    const agent =
      agentIdForProviderInstance(provider.instanceId) ?? agentIdForDriverKind(provider.driver);
    return [
      {
        id: provider.instanceId,
        label: provider.displayName ?? provider.instanceId,
        ...(agent === undefined ? {} : { agent }),
        tools: profile.tools,
      },
    ];
  });
}

/** A login's name: the catalog's, else its id. */
export function crewLoginLabel(logins: ReadonlyArray<CrewLogin>, loginId: string): string {
  return logins.find((login) => login.id === loginId)?.label ?? loginId;
}

/**
 * What *Runs on* says about the chosen login, if anything: on an agent that
 * hosts no crew tools a crewmate works on code only, and only the person's
 * *Land* completes its task.
 */
export function crewLoginNote(
  logins: ReadonlyArray<CrewLoginOption>,
  loginId: string,
): string | undefined {
  const login = logins.find((candidate) => candidate.id === loginId);
  return login !== undefined && !login.tools
    ? `On ${login.label}, a crewmate works on code only, with no Zerops tools. Its task is done when you land it.`
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

/**
 * The model option each agent's effort is (the one a crewmate's effort sets
 * on the server): Claude's `effort`, Codex's and Grok's `reasoningEffort`,
 * Cursor's `reasoning`, OpenCode's `variant`.
 */
const EFFORT_OPTION_IDS: ReadonlySet<string> = new Set([
  "effort",
  "reasoningEffort",
  "reasoning",
  "variant",
]);

/** A model's effort levels: the choices of its effort option. */
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
    (candidate) => candidate.type === "select" && EFFORT_OPTION_IDS.has(candidate.id),
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
