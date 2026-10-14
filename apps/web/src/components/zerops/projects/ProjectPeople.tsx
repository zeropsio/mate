/**
 * Who reaches Zerops projects, as people chips (`ProjectAccessChips`), read through the account's
 * data layer: the organization's members, each project's own row — the only read naming everybody's
 * grants, held while it is shown — and whose each Mate is, as HQ names its owner.
 *
 * Three ways in. An app's page shows its People: one chip per person who reaches any of its
 * projects, every change made to all of them at once. A project's own page (an environment, or a
 * Mate's *Project access…*) shows that one project's. A creation dialog edits a draft the creation
 * sends with the project (`accessDraft.logic.ts`).
 *
 * An organization owner or admin changes access from a person's ⋮ and adds people already in the
 * organization from *Add access*. Each change is the account's operation (`set-project-access`); a
 * chip says it is saving until Zerops answered and the people were read again, and a refusal is
 * said under the chips.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  accountReadsAtom,
  initialStream,
  organizationMembers,
  projectsGrants,
  shownHqProjectPeopleAtom,
  shownProjectsAtom,
  type MembersRead,
  type ProjectGrantsRead,
} from "@t3tools/client-runtime/data";
import type {
  ProjectAccessChange,
  ProjectGrant,
} from "@t3tools/client-runtime/zerops/projectAccess";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import type { RoleProjectKind } from "@t3tools/shared/zeropsRoles";
import { Atom } from "effect/reactivity";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  useAccountDataOptional,
  useAccountOrgId,
  useDetailDemand,
  useProjection,
} from "~/zerops/accountData";
import { captureAccountLifetime } from "~/zerops/accountLifetime";
import { useAccountOperationsOptional } from "~/zerops/accountOperations";
import { useZeropsSessionOptional } from "~/zerops/sessionContext";
import { useZeropsRegistry } from "~/zerops/useZeropsRegistry";
import { writeTrouble } from "~/zerops/zeropsWrite";

import { draftChoose, draftPrefill, draftView } from "./accessDraft.logic";
import {
  ADD_TROUBLE,
  ProjectAccessChips,
  type AccessChoice,
  type AccessPick,
} from "./ProjectAccessChips";
import {
  accessChanges,
  appProjectsOf,
  projectPeople,
  type ProjectPeopleInput,
  type ProjectPerson,
} from "./projectPeople.logic";

/** Outside an account nothing is read: every project's grants are still to come. */
const UNREAD_GRANTS = Atom.make<Readonly<Record<string, ProjectGrantsRead>>>({});
const UNREAD_MEMBERS = Atom.make<MembersRead>({
  fact: { kind: "unknown" },
  coverage: "unknown",
  stream: initialStream({ parent: null, mode: "sampled" }),
  link: null,
  members: [],
  status: "loading",
  settled: false,
  refused: false,
});

type AccessProjects = ProjectPeopleInput["projects"];

/** A draft with nothing chosen and nothing to start from: one list, so a render changes nothing. */
const NO_GRANTS: ReadonlyArray<ProjectGrant> = [];

/**
 * What access to `projects` is drawn from, as the data layer holds it now: the members, each
 * project's grants (its own row held while this is mounted), whose each Mate is, and who looks.
 */
function useAccessReads(projects: AccessProjects) {
  const session = useZeropsSessionOptional();
  const orgId = useAccountOrgId();
  const projectIds = useMemo(() => projects.map(({ projectId }) => projectId), [projects]);
  const projectKey = projectIds.join(",");

  // Each project's own row, held while the chips are drawn: everybody's grants come only with it.
  const demandDetail = useAtomValue(accountReadsAtom)?.demandDetail;
  useEffect(() => {
    if (demandDetail === undefined || projectKey === "") return;
    const releases = projectKey
      .split(",")
      .map((ownerId) => demandDetail({ family: "project", listing: "project", ownerId }));
    return () => {
      for (const release of releases) release();
    };
  }, [demandDetail, projectKey]);

  // The organization's members: who they are, their role, whether they joined. Displayed here,
  // never a gate: what anyone may do is Zerops' and HQ's to decide.
  const clientId = session?.activeOrganization?.id ?? null;
  useDetailDemand("organizationMembers", undefined, clientId);
  const members = useProjection(
    organizationMembers,
    orgId === null || clientId === null ? null : { orgId, clientId },
    UNREAD_MEMBERS,
  );
  const grants = useProjection(
    projectsGrants,
    orgId === null ? null : { orgId, projectIds },
    UNREAD_GRANTS,
  );
  const hqProjectPeople = useAtomValue(shownHqProjectPeopleAtom);
  const viewerUserId = session?.user?.id ?? null;
  const viewer = useAccountDataOptional()?.viewer;

  const base = useMemo(
    () => ({
      members: {
        known: members.fact.kind === "known",
        status: members.status,
        refused: members.refused,
        list: members.members,
      },
      grants,
      owners: Object.fromEntries(
        projects.map(({ projectId }) => [projectId, hqProjectPeople[projectId]?.owner?.userId]),
      ),
      // The pictures the menu's faces draw owners with, as HQ names them.
      pictures: Object.fromEntries(
        Object.values(hqProjectPeople).flatMap(({ owner }) =>
          owner === null ? [] : [[owner.userId, owner.avatarUrl]],
        ),
      ),
      viewerUserId,
      viewer:
        viewer === undefined
          ? undefined
          : {
              membershipId: viewer.membershipId,
              ...(viewer.roleCode === undefined ? {} : { roleCode: viewer.roleCode }),
            },
    }),
    [grants, hqProjectPeople, members, projects, viewer, viewerUserId],
  );
  return { base, clientId };
}

/** The projects of the group `groupId`, each with its own name, as HQ's structure places them. */
function useGroupProjects(groupId: string | null): AccessProjects {
  const { registry } = useZeropsRegistry();
  const roster = useAtomValue(shownProjectsAtom).projects;
  return useMemo(
    () =>
      (registry.groups.find((one) => one.groupId === groupId)?.projects ?? []).map(
        ({ projectId, kind }) => {
          const name = roster.find(({ id }) => id === projectId)?.name;
          return { projectId, kind, ...(name === undefined ? {} : { name }) };
        },
      ),
    [groupId, registry, roster],
  );
}

/**
 * Who reaches `projects`, and the changes the viewer makes to it: a choice applies to every one of
 * them but the Mates the person owns.
 */
function useProjectAccess(projects: AccessProjects) {
  const { base, clientId } = useAccessReads(projects);
  const view = useMemo(() => projectPeople({ ...base, projects }), [base, projects]);
  const operations = useAccountOperationsOptional();
  const [saving, setSaving] = useState<ReadonlySet<string>>(() => new Set());
  const [troubles, setTroubles] = useState<Readonly<Record<string, string>>>({});
  const projectIds = useMemo(() => projects.map(({ projectId }) => projectId), [projects]);

  /** Runs one write under `key`: saving until it ends, its refusal said under the chips. */
  const write = useCallback(
    (key: string, intent: Parameters<NonNullable<typeof operations>["submit"]>[0]) => {
      if (operations === null) return;
      const isCurrent = captureAccountLifetime();
      const said = (trouble: string | null) =>
        setTroubles(({ [key]: _was, ...rest }) =>
          trouble === null ? rest : { ...rest, [key]: trouble },
        );
      setSaving((held) => new Set(held).add(key));
      said(null);
      void operations
        .submit(intent)
        .then(
          ({ progress, evidence }) => {
            if (isCurrent()) said(writeTrouble(progress, evidence));
          },
          (cause: unknown) => {
            if (isCurrent()) said(zeropsErrorMessage(cause));
          },
        )
        .finally(() => {
          if (!isCurrent()) return;
          setSaving((held) => {
            const left = new Set(held);
            left.delete(key);
            return left;
          });
        });
    },
    [operations],
  );

  const choose = useCallback(
    (person: ProjectPerson, choice: AccessChoice) => {
      const change = person.change;
      if (clientId === null || change === null) return;
      if (choice === "withdraw") {
        write(person.key, {
          kind: "set-app-access",
          orgId: clientId,
          clientUserId: change.clientUserId,
          change: "withdraw",
          projects: appProjectsOf(projects),
          owned: change.owned,
        });
        return;
      }
      write(person.key, {
        kind: "set-project-access",
        orgId: clientId,
        changes: accessChanges({
          clientUserId: change.clientUserId,
          projectIds,
          owned: change.owned,
          choice,
        }),
      });
    },
    [clientId, projectIds, projects, write],
  );

  const add = useCallback(
    (picks: ReadonlyArray<AccessPick>) => {
      if (clientId === null) return;
      const changes = picks.flatMap(({ candidate, level }): ReadonlyArray<ProjectAccessChange> =>
        accessChanges({
          clientUserId: candidate.clientUserId,
          projectIds,
          // A Mate of their own stays theirs, as HQ names its owner.
          owned: projects.flatMap(({ projectId }) =>
            candidate.userId !== undefined && base.owners[projectId] === candidate.userId
              ? [projectId]
              : [],
          ),
          choice: level,
        }),
      );
      write(ADD_TROUBLE, { kind: "set-project-access", orgId: clientId, changes });
    },
    [base.owners, clientId, projectIds, projects, write],
  );

  const writable = operations !== null && clientId !== null;
  return {
    view,
    saving,
    troubles,
    adding: saving.has(ADD_TROUBLE),
    ...(writable ? { onChoose: choose, onAdd: add } : {}),
  };
}

/** The People on an app's page, for the group `groupId`: every project of the app at once. */
export function ProjectPeople({ groupId }: { groupId: string }) {
  const projects = useGroupProjects(groupId);
  const access = useProjectAccess(projects);
  return <ProjectAccessChips label="People" {...access} />;
}

/** One Zerops project's access: an environment's page, or a Mate's *Project access…*. */
export function ProjectAccess({
  projectId,
  kind,
  name,
  heading = true,
}: {
  readonly projectId: string;
  readonly kind: RoleProjectKind;
  readonly name?: string;
  /** Drawn with its own heading; `false` where the host names the section. */
  readonly heading?: boolean;
}) {
  const projects = useMemo(
    () => [{ projectId, kind, ...(name === undefined ? {} : { name }) }],
    [kind, name, projectId],
  );
  const access = useProjectAccess(projects);
  return <ProjectAccessChips heading={heading} {...access} />;
}

/**
 * A new project's access, before it exists: its creator pinned, then everyone it will reach, the
 * app's people prefilled. Says each change to `onChange` as the list the creation sends.
 */
export function ProjectAccessDraft({
  groupId,
  kind,
  onChange,
  heading = false,
}: {
  /** The app it is made in; `null` for a brand new app. */
  readonly groupId: string | null;
  readonly kind: RoleProjectKind;
  readonly onChange: (userRoles: ReadonlyArray<ProjectGrant>) => void;
  /** Drawn with its own heading; by default the creation form names the section. */
  readonly heading?: boolean;
}) {
  const app = useGroupProjects(groupId);
  // The prefill reads the places, or the Mates where the app has none.
  const read = useMemo(() => {
    const places = app.filter(({ kind: one }) => one !== "mate");
    return places.length > 0 ? places : app;
  }, [app]);
  const { base } = useAccessReads(read);
  const [chosen, setChosen] = useState<ReadonlyArray<ProjectGrant> | null>(null);
  const input = useMemo(
    () => ({
      members: base.members,
      kind,
      app: { projects: read, grants: base.grants, owners: base.owners },
      pictures: base.pictures,
      creator:
        base.viewer === undefined
          ? undefined
          : { membershipId: base.viewer.membershipId, userId: base.viewerUserId },
      list: [],
    }),
    [base, kind, read],
  );
  const prefill = useMemo(() => draftPrefill(input), [input]);
  const list = chosen ?? prefill ?? NO_GRANTS;
  const view = useMemo(() => draftView({ ...input, list }), [input, list]);

  useEffect(() => {
    onChange(list);
  }, [list, onChange]);

  const choose = useCallback(
    (person: ProjectPerson, choice: AccessChoice) => {
      const change = person.change;
      if (change === null) return;
      setChosen(
        draftChoose(
          list,
          base.members.list,
          change.clientUserId,
          choice === "withdraw" ? "remove" : choice,
        ),
      );
    },
    [base.members.list, list],
  );
  const add = useCallback(
    (picks: ReadonlyArray<AccessPick>) =>
      setChosen(
        picks.reduce(
          (next, { candidate, level }) =>
            draftChoose(next, base.members.list, candidate.clientUserId, level),
          list,
        ),
      ),
    [base.members.list, list],
  );
  return <ProjectAccessChips heading={heading} onAdd={add} onChoose={choose} view={view} />;
}

/** What a creation role makes, as the access draft names the project. */
export const roleProjectKind = (role: "dev" | "devstage" | "stage" | "prod"): RoleProjectKind =>
  role === "dev" ? "mate" : role === "prod" ? "production" : role;
