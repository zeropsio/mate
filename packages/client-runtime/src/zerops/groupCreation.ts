/**
 * *Add project* — what it writes, and who is offered it (guide 4.1).
 *
 * ## A group is a registry entry, not a project
 *
 * Nothing is created in Zerops when a person adds a project. A group is one
 * `mate:gn:{groupId}:{slug}` tag on the account's Gitea project, and the broker
 * builds the Gitea side from it — the org, its three teams, the group repo, its
 * runner — within about eighty seconds (measured 2026-09-16). So the tree shows
 * the group the moment the tag lands, and says its Gitea is still being set up
 * until `GET /orgs/{slug}` answers **as the person** (`giteaClient.ts`). The
 * org is not assumed from the tag: the tag is what we asked for, the org is
 * what exists.
 *
 * ## Who may
 *
 * The registry lives on a project only org owners and admins can write (D3),
 * and the platform enforces that — so an offered verb a member cannot finish
 * would be an error message after the fact (guide 0.8). The gate here is
 * therefore stricter than `canCreateMates`: a `READ_ONLY` member with *can
 * create projects* may add a **Mate** to a group that exists, and may not make
 * a group.
 *
 * ## The slug is forever
 *
 * It is the Gitea org, and renaming a Gitea org breaks every clone URL under
 * it, so it is derived once from the name and numbered on collision
 * (`groupRegistry.ts`). The name a person types stays theirs to change; the
 * slug does not move with it.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module groupCreation
 */

import {
  deriveGroupSlug,
  formatZeropsRegistryTags,
  type ZeropsRegistry,
  type ZeropsRegistryGroup,
} from "./groupRegistry.ts";
import { mateMemberName, type MateAccessViewer, type MateOwnerCandidate } from "./mateAccess.ts";
import type { RoleProjectKind } from "@t3tools/shared/zeropsRoles";

/** A verb is either offered, or refused in words that name who can do it. */
export type GroupVerb =
  | { readonly offered: true }
  | { readonly offered: false; readonly reason: string };

const OFFERED: GroupVerb = { offered: true };

/** Who may write the registry: an org owner or admin, and nobody else (D3). */
export function canWriteRegistry(viewer: { readonly roleCode?: string | undefined }): boolean {
  return viewer.roleCode === "OWNER" || viewer.roleCode === "ADMIN";
}

/**
 * Whether this person is offered *Add project*, and what the row says instead.
 *
 * One refusal: a member simply is not the one who does this. An account with
 * no Gitea yet is not a refusal — the first project stands it up on its way
 * (`submitZeropsNewProject`), so nobody has to know the word.
 */
export function resolveAddProjectVerb(input: {
  readonly viewer: MateAccessViewer;
  /** The org's owners and admins, for the refusal that names them. */
  readonly admins?: ReadonlyArray<MateOwnerCandidate> | undefined;
}): GroupVerb {
  if (!canWriteRegistry(input.viewer)) {
    return { offered: false, reason: onlyTheseCanAddAProject(input.admins ?? []) };
  }
  return OFFERED;
}

/**
 * The one line a member sees in place of the verb.
 *
 * Names them when the member list can be read for names, because "ask an owner"
 * with no owner to ask is the kind of sentence that sends somebody to support.
 * With no names it says the same thing without pretending to know who.
 */
export function onlyTheseCanAddAProject(admins: ReadonlyArray<MateOwnerCandidate>): string {
  const names = admins
    .map((admin) => mateMemberName(admin))
    .filter((name): name is string => name !== undefined);
  if (names.length === 0) return "Only an owner or admin adds a project.";
  if (names.length === 1) return `Only ${names[0]} adds a project.`;
  const last = names.at(-1);
  return `Only ${names.slice(0, -1).join(", ")} and ${last} add a project.`;
}

export interface GroupRegistrationPlan {
  readonly groupId: string;
  /** The Gitea org this group will be, derived once and never changed. */
  readonly slug: string;
  /** The Gitea project's whole tag list, this entry included. */
  readonly tagList: ReadonlyArray<string>;
}

export type GroupRegistrationResult =
  | { readonly ok: true; readonly plan: GroupRegistrationPlan }
  | { readonly ok: false; readonly reason: string };

/**
 * The registry the account has, plus one group.
 *
 * The whole tag list comes back because `PUT /project/{id}` replaces it: a
 * write that carried only the new tag would delete every other group, the
 * `mate:tool:gitea` marker and whatever a person tagged the project with
 * themselves.
 */
export function planGroupRegistration(input: {
  readonly name: string;
  /** Minted by the caller — `generateZeropsGroupId`. */
  readonly groupId: string;
  readonly registry: ZeropsRegistry;
}): GroupRegistrationResult {
  const name = input.name.trim();
  if (name.length === 0) return { ok: false, reason: "A project needs a name." };
  if (input.registry.groups.some((group) => group.groupId === input.groupId)) {
    return { ok: false, reason: "That project already exists." };
  }

  let slug: string;
  try {
    slug = deriveGroupSlug(
      name,
      input.registry.groups.map((group) => group.slug),
    );
  } catch {
    return { ok: false, reason: `Too many projects are already called "${name}".` };
  }

  const group: ZeropsRegistryGroup = {
    groupId: input.groupId,
    slug,
    projects: [],
    matesMayRelease: false,
  };
  return {
    ok: true,
    plan: {
      groupId: input.groupId,
      slug,
      tagList: formatZeropsRegistryTags({
        ...input.registry,
        groups: [...input.registry.groups, group],
      }),
    },
  };
}

export type GroupMembershipResult =
  | { readonly ok: true; readonly tagList: ReadonlyArray<string> }
  | { readonly ok: false; readonly reason: string };

/**
 * The registry with one project added to a group as a Mate, a stage or the
 * production.
 *
 * **One production per group** (`docs/vocabulary.md`), refused here rather than
 * by the broker: the app is what offers *Add production*, and a second one
 * would leave two projects claiming the same release target with nothing to
 * decide between them.
 *
 * Adding a project already in the group is a no-op rather than a duplicate —
 * the same write run twice, which is what a retried creation is.
 */
export function planGroupMembership(input: {
  readonly registry: ZeropsRegistry;
  readonly groupId: string;
  readonly projectId: string;
  readonly kind: RoleProjectKind;
}): GroupMembershipResult {
  const group = input.registry.groups.find((entry) => entry.groupId === input.groupId);
  if (group === undefined) return { ok: false, reason: "That project is not in the registry." };

  const already = group.projects.find((entry) => entry.projectId === input.projectId);
  if (already?.kind === input.kind) {
    return { ok: true, tagList: formatZeropsRegistryTags(input.registry) };
  }
  if (already !== undefined) {
    return { ok: false, reason: `That environment is already the group's ${already.kind}.` };
  }
  if (input.kind === "production" && group.projects.some((entry) => entry.kind === "production")) {
    return { ok: false, reason: "This project already has a production." };
  }

  return {
    ok: true,
    tagList: formatZeropsRegistryTags({
      ...input.registry,
      groups: input.registry.groups.map((entry) =>
        entry.groupId === input.groupId
          ? {
              ...entry,
              projects: [...entry.projects, { projectId: input.projectId, kind: input.kind }],
            }
          : entry,
      ),
    }),
  };
}

/**
 * How far the broker has got with a group's Gitea side.
 *
 * `asking` is not a spinner state to hide — the group is usable as a place to
 * put a Mate from the moment its tag lands, and the org matters only when
 * somebody wants the repositories. It is the difference between "we asked for
 * this" and "this exists", which is the line guide 4.5 draws through the whole
 * screen.
 */
export type GroupGiteaState = "ready" | "being-set-up" | "unknown";

export function resolveGroupGitea(input: {
  /** What `GET /orgs/{slug}` answered as the person: the org, or nothing. */
  readonly organizationExists: boolean | undefined;
}): GroupGiteaState {
  if (input.organizationExists === undefined) return "unknown";
  return input.organizationExists ? "ready" : "being-set-up";
}

/**
 * Whether the registry knows about a Mate yet (guide 4.2).
 *
 * A member with *can create projects* may make a Mate, and may not write the
 * registry — so their new Mate exists, runs, and has neither group reach nor a
 * Gitea bot until an owner or admin adds it. That is a real state with a real
 * consequence (the broker refuses `POST /mate/credential` with
 * `not_registered`), and the row says it rather than showing a Mate that looks
 * finished and cannot push.
 *
 * An owner's own creation writes the entry in the same breath, so this is
 * `registered` before the row is ever painted.
 */
export type MateRegistration = "registered" | "awaiting-owner";

export function resolveMateRegistration(input: {
  readonly registry: ZeropsRegistry;
  readonly projectId: string;
}): MateRegistration {
  const registered = input.registry.groups.some((group) =>
    group.projects.some((project) => project.projectId === input.projectId),
  );
  return registered ? "registered" : "awaiting-owner";
}

/**
 * The one line such a Mate carries, in place of its Gitea facts.
 *
 * It names the consequence, not the plumbing: "not in the registry" means
 * nothing to the person who made it, and "cannot push yet" is what they will
 * actually run into.
 */
export function mateAwaitingRegistryLine(admins: ReadonlyArray<MateOwnerCandidate> = []): string {
  const names = admins
    .map((admin) => mateMemberName(admin))
    .filter((name): name is string => name !== undefined);
  const who = names.length === 0 ? "an owner or admin" : names.join(" or ");
  return `Waiting for ${who} to add it to the project — until then it cannot push.`;
}

/**
 * The verb an owner sees on a colleague's unregistered Mate (guide 4.2).
 *
 * A member with *can create projects* makes a Mate and cannot write the
 * registry, so their Mate runs with no group reach and no bot until somebody
 * who can adds it. That somebody is an org owner or admin — the only people the
 * platform lets write the Gitea project's tags (D3) — and this is the one verb
 * that finishes the job.
 *
 * `undefined` for everybody else, and for a Mate already in the registry: a
 * disabled button on a row a person can do nothing about is noise, and the row
 * already says who it is waiting for (`mateAwaitingRegistryLine`).
 */
export function registerMateVerb(input: {
  readonly registration: MateRegistration;
  /** The viewer's org role, as the platform spells it. */
  readonly viewerRole?: string | undefined;
  /** What the group is called, for the verb itself. */
  readonly groupName: string;
}): string | undefined {
  if (input.registration !== "awaiting-owner") return undefined;
  if (input.viewerRole !== "OWNER" && input.viewerRole !== "ADMIN") return undefined;
  return `Register in ${input.groupName}`;
}
