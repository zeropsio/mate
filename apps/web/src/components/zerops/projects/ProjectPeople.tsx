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
 * said under the chips. Under the table, read access is asked for a place Zerops does not show the
 * viewer, and an owner or admin grants or declines it (`ReadAccessRequests`).
 */
import { useAtomValue } from "@effect/atom-react";
import { Link, useRouterState } from "@tanstack/react-router";
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
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  useAccountDataOptional,
  useAccountOrgId,
  useDetailDemand,
  useDetailReadAsOpened,
  useProjection,
} from "~/zerops/accountData";
import { captureAccountLifetime } from "~/zerops/accountLifetime";
import { useAccountOperationsOptional } from "~/zerops/accountOperations";
import { useZeropsSessionOptional } from "~/zerops/sessionContext";
import { useZeropsRegistry } from "~/zerops/useZeropsRegistry";
import { writeTrouble } from "~/zerops/zeropsWrite";

import {
  draftChoose,
  draftPeople,
  draftPrefill,
  draftSpeaks,
  draftSummary,
  draftView,
  type DraftPeople,
} from "./accessDraft.logic";
import {
  ADD_TROUBLE,
  AccessDraftFold,
  ProjectAccessChips,
  type AccessChoice,
  type AccessPick,
} from "./ProjectAccessChips";
import { ReadAccessRequests, useHiddenEnvironments } from "./ReadAccessRequests";
import {
  accessChanges,
  appProjectsOf,
  projectPeople,
  type ProjectPeopleInput,
  type ProjectPerson,
} from "./projectPeople.logic";
import {
  accessTable,
  cellChange,
  columnPeople,
  everywhereChanges,
  type AccessColumn,
  type AccessRow,
  type AccessTableView,
  type CellChoice,
} from "./accessTable.logic";
import { cellKey, PlaceAccessSummary, ProjectAccessTable } from "./ProjectAccessTable";
import { Skeleton } from "../../ui/skeleton";
import { SetupRow } from "../project/SetupCard";
import { peopleSummary } from "../project/projectSetup.logic";
import { PersonAvatar } from "../primitives";
import { SectionAction } from "../system";

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
 * The group's stages and productions Zerops does not list to the viewer, by id and tier alone as
 * HQ names them (`hiddenEnvironments`): columns they can ask read access for, never read.
 */
function useHiddenPlaces(groupId: string): AccessProjects {
  const hidden = useHiddenEnvironments(groupId);
  // HQ leaves the list out where the viewer reaches every place: none is hidden.
  return useMemo(
    () =>
      hidden === undefined
        ? NO_HIDDEN_PLACES
        : hidden.map(({ id, tier }) => ({ projectId: id, kind: tier, hidden: true })),
    [hidden],
  );
}

/** No hidden place: one list, so a render changes nothing. */
const NO_HIDDEN_PLACES: AccessProjects = [];

type WriteIntent = Parameters<
  NonNullable<ReturnType<typeof useAccountOperationsOptional>>["submit"]
>[0];

/**
 * Access writes, each under a key: saving until Zerops answered and the people were read again,
 * a refusal said by its key until the next write under it.
 */
function useAccessWrites() {
  const operations = useAccountOperationsOptional();
  const [saving, setSaving] = useState<ReadonlySet<string>>(() => new Set());
  const [troubles, setTroubles] = useState<Readonly<Record<string, string>>>({});

  const write = useCallback(
    (key: string, intent: WriteIntent) => {
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
  return { write, saving, troubles, writable: operations !== null };
}

/** People added from *Add access*: each at their level on every project here but their own Mates. */
function useAddPeople(
  projects: AccessProjects,
  owners: Readonly<Record<string, string | null | undefined>>,
  clientId: string | null,
  write: (key: string, intent: WriteIntent) => void,
) {
  return useCallback(
    (picks: ReadonlyArray<AccessPick>) => {
      if (clientId === null) return;
      const projectIds = projects.map(({ projectId }) => projectId);
      const changes = picks.flatMap(({ candidate, level }): ReadonlyArray<ProjectAccessChange> =>
        accessChanges({
          clientUserId: candidate.clientUserId,
          projectIds,
          // A Mate of their own stays theirs, as HQ names its owner.
          owned: projects.flatMap(({ projectId }) =>
            candidate.userId !== undefined && owners[projectId] === candidate.userId
              ? [projectId]
              : [],
          ),
          choice: level,
        }),
      );
      write(ADD_TROUBLE, { kind: "set-project-access", orgId: clientId, changes });
    },
    [clientId, owners, projects, write],
  );
}

/**
 * Who reaches `projects`, and the changes the viewer makes to it: a choice applies to every one of
 * them but the Mates the person owns.
 */
function useProjectAccess(projects: AccessProjects) {
  const { base, clientId } = useAccessReads(projects);
  const view = useMemo(() => projectPeople({ ...base, projects }), [base, projects]);
  const { write, saving, troubles, writable } = useAccessWrites();
  const projectIds = useMemo(() => projects.map(({ projectId }) => projectId), [projects]);

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
  const add = useAddPeople(projects, base.owners, clientId, write);

  return {
    view,
    saving,
    troubles,
    adding: saving.has(ADD_TROUBLE),
    // An owner or admin opens a person's own Team page from their chip.
    ...(view.kind === "people" && view.invite ? { personPage: LINKED } : {}),
    ...(writable && clientId !== null ? { onChoose: choose, onAdd: add } : {}),
  };
}

const LINKED = () => true;

/** The link from a place to its column: to change it, or — for whoever can't — to see the rest. */
const placeLinkWords = (groupName: string | undefined, editable: boolean): string => {
  const page = groupName === undefined ? "the project’s page" : `${groupName}’s page`;
  return editable ? `Change on ${page}` : `Every place’s access on ${page}`;
};

/** The column a place's page linked to (`#access-<projectId>`), if any. */
function useFocusedColumn(): string | undefined {
  const hash = useRouterState({ select: (state) => state.location.hash });
  return hash.startsWith("access-") ? hash.slice("access-".length) : undefined;
}

/**
 * The People on an app's page, for the group `groupId`: its people by its places, one place's
 * level changed at a time, or the same everywhere from a person's row.
 */
export function ProjectPeople({ groupId }: { groupId: string }) {
  const projects = useGroupProjects(groupId);
  const hidden = useHiddenPlaces(groupId);
  const { base, clientId } = useAccessReads(projects);
  const view = useMemo(
    () => accessTable({ ...base, projects: [...projects, ...hidden] }),
    [base, hidden, projects],
  );
  const { write, saving, troubles, writable } = useAccessWrites();
  const focus = useFocusedColumn();

  const onCell = useCallback(
    (row: AccessRow, column: AccessColumn, choice: CellChoice) => {
      if (clientId === null) return;
      write(cellKey(row, column.projectId), {
        kind: "set-project-access",
        orgId: clientId,
        changes: [
          cellChange({
            clientUserId: row.key,
            memberRole: row.roleCode,
            projectId: column.projectId,
            choice,
          }),
        ],
      });
    },
    [clientId, write],
  );
  const onEverywhere = useCallback(
    (row: AccessRow, choice: CellChoice) => {
      if (clientId === null || view.kind !== "table") return;
      write(row.key, {
        kind: "set-project-access",
        orgId: clientId,
        changes: everywhereChanges({ row, columns: view.columns, choice }),
      });
    },
    [clientId, view, write],
  );
  const onWithdraw = useCallback(
    (row: AccessRow) => {
      if (clientId === null) return;
      write(row.key, {
        kind: "set-app-access",
        orgId: clientId,
        clientUserId: row.key,
        change: "withdraw",
        projects: appProjectsOf(projects),
        owned: row.cells.flatMap(({ projectId, level }) => (level === "owner" ? [projectId] : [])),
      });
    },
    [clientId, projects, write],
  );
  const onAdd = useAddPeople(projects, base.owners, clientId, write);

  return (
    <>
      <ProjectAccessTable
        adding={saving.has(ADD_TROUBLE)}
        focus={focus}
        saving={saving}
        troubles={troubles}
        view={view}
        {...(view.kind === "table" && view.invite ? { personPage: LINKED } : {})}
        {...(writable && clientId !== null ? { onCell, onEverywhere, onWithdraw, onAdd } : {})}
      />
      <ReadAccessRequests orgId={clientId} view={view} />
    </>
  );
}

/**
 * The People row of a project page's side column: how many people reach the project and how many
 * its production, and *Manage*, which opens who has access where (`ProjectPeople`).
 */
export function ProjectPeopleRow({
  groupId,
  onManage,
}: {
  readonly groupId: string;
  readonly onManage: (from: HTMLElement) => void;
}) {
  const projects = useGroupProjects(groupId);
  const { base } = useAccessReads(projects);
  const view = useMemo(() => accessTable({ ...base, projects }), [base, projects]);
  return <ProjectPeopleRowView onManage={onManage} view={view} />;
}

export function ProjectPeopleRowView({
  view,
  onManage,
}: {
  readonly view: AccessTableView;
  readonly onManage: (from: HTMLElement) => void;
}) {
  const summary = peopleSummary(view);
  const people = view.kind === "table" ? view.rows : [];
  const more = people.length - FACES_SHOWN;
  return (
    <SetupRow
      action={<SectionAction onClick={onManage}>Manage</SectionAction>}
      busy={view.kind === "reading"}
      label="Who has access"
      surface="project-people"
    >
      <div className="flex min-h-7 min-w-0 items-center gap-3.5">
        {view.kind === "unreadable" ? (
          <span className="text-line text-muted-foreground">{view.line}</span>
        ) : summary === null ? (
          <Skeleton className="h-5 w-48" />
        ) : (
          <>
            {people.length === 0 ? null : (
              <span aria-hidden="true" className="pp-faces">
                {people.slice(0, FACES_SHOWN).map((person) => (
                  <PersonAvatar
                    key={person.key}
                    name={person.name}
                    picture={person.avatarUrl}
                    size={24}
                  />
                ))}
                {more > 0 ? <span className="pp-faces-more">+{more}</span> : null}
              </span>
            )}
            <span className="text-sm text-foreground">{summary}</span>
          </>
        )}
      </div>
    </SetupRow>
  );
}

/** How many faces stand for who has access before "+N" says the rest. */
const FACES_SHOWN = 5;

/** The app a project is part of, as HQ's structure places it; `undefined` for one on its own. */
export function useProjectGroup(
  projectId: string,
): { readonly groupId: string; readonly name: string } | undefined {
  const { registry } = useZeropsRegistry();
  return useMemo(() => {
    const group = registry.groups.find((one) =>
      one.projects.some((project) => project.projectId === projectId),
    );
    return group === undefined ? undefined : { groupId: group.groupId, name: group.name };
  }, [projectId, registry]);
}

/**
 * Who reaches one place of an app, read only, and the link to its column on the app's page,
 * where it is changed: a place's own page, a grouped Mate's *Access*.
 */
export function PlaceAccess({
  groupId,
  groupName,
  projectId,
  kind,
  name,
  onLeave,
}: {
  readonly groupId: string;
  /** The app's name, for the link: "Change on kite.works’s page". */
  readonly groupName: string | undefined;
  readonly projectId: string;
  readonly kind: RoleProjectKind;
  readonly name?: string;
  /** Called as the link is followed: a dialog closes. */
  readonly onLeave?: () => void;
}) {
  const { view, summary, line } = usePlaceAccessPeople({ projectId, kind, name });
  return (
    <PlaceAccessSummary
      change={
        <Link
          className="ov-acc-link"
          hash={`access-${projectId}`}
          onClick={onLeave}
          params={{ groupId }}
          to="/group/$groupId/flow"
        >
          {placeLinkWords(groupName, view.kind === "table" && view.editable)}
        </Link>
      }
      line={line}
      summary={summary}
    />
  );
}

/**
 * Who reaches one place of an app, read only: its people with their level there (`columnPeople`),
 * or what stands for them while they are read or can't be. A place's page draws them as its own
 * access card.
 */
export function usePlaceAccessPeople({
  projectId,
  kind,
  name,
}: {
  readonly projectId: string;
  readonly kind: RoleProjectKind;
  readonly name?: string | undefined;
}) {
  const projects = useMemo(
    () => [{ projectId, kind, ...(name === undefined ? {} : { name }) }],
    [kind, name, projectId],
  );
  const { base } = useAccessReads(projects);
  const view = useMemo(() => accessTable({ ...base, projects }), [base, projects]);
  const summary = useMemo(() => columnPeople(view, projectId), [projectId, view]);
  const line =
    view.kind === "reading"
      ? "Reading who has access…"
      : view.kind === "unreadable"
        ? view.line
        : null;
  return { view, summary, line };
}

/** One Zerops project's access, changed here: a Mate on its own's *Project access…*. */
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
 * What a new project of the app starts from: the app's places (or its Mates, where it has none),
 * their grants and the organization's members — read again as it opens, so whoever joined since
 * this session first read them is counted.
 */
function useDraftInput(groupId: string | null, kind: RoleProjectKind) {
  const app = useGroupProjects(groupId);
  const read = useMemo(() => {
    const places = app.filter(({ kind: one }) => one !== "mate");
    return places.length > 0 ? places : app;
  }, [app]);
  const { base } = useAccessReads(read);
  useDetailReadAsOpened(
    "organizationMembers",
    useZeropsSessionOptional()?.activeOrganization?.id ?? null,
  );
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
  return { base, input };
}

/**
 * The people a new environment of the app gets without asking: everyone who reaches the app now,
 * at their level there (`draftPeople`) — what a creation that asks nothing sends.
 */
export function useDraftPeople(groupId: string, kind: RoleProjectKind): DraftPeople {
  const { input } = useDraftInput(groupId, kind);
  const retryDetail = useAccountDataOptional()?.retryDetail;
  const clientId = useZeropsSessionOptional()?.activeOrganization?.id ?? null;
  return useMemo(() => {
    const people = draftPeople(input);
    if (people.kind !== "failed" || retryDetail === undefined) return people;
    // Only the reads that failed are asked again: the members, and each project whose grants did.
    const again = () => {
      if (!input.members.known && clientId !== null)
        retryDetail({ family: "organizationMembers", ownerId: clientId });
      for (const { projectId } of input.app.projects)
        if (input.app.grants[projectId]?.status === "failed")
          retryDetail({ family: "project", listing: "project", ownerId: projectId });
    };
    return { kind: "failed", again };
  }, [clientId, input, retryDetail]);
}

/** Hands what `useDraftPeople` reads to a creation form drawn without data of its own. */
export function WithDraftPeople({
  groupId,
  kind,
  children,
}: {
  readonly groupId: string;
  readonly kind: RoleProjectKind;
  readonly children: (people: DraftPeople) => ReactNode;
}) {
  return children(useDraftPeople(groupId, kind));
}

/**
 * A new project's access, before it exists: its creator pinned, then everyone it will reach, the
 * app's people prefilled, under the form's name for it — drawn only where someone besides the
 * creator is in it or can be added (`draftSpeaks`). Says each change to `onChange` as the list the
 * creation sends.
 */
export function ProjectAccessDraft({
  groupId,
  kind,
  onChange,
  label,
}: {
  /** The app it is made in; `null` for a brand new app. */
  readonly groupId: string | null;
  readonly kind: RoleProjectKind;
  readonly onChange: (userRoles: ReadonlyArray<ProjectGrant>) => void;
  /** What the creation form names the section: "Project access", "Who can work with this Mate". */
  readonly label: string;
}) {
  const { base, input } = useDraftInput(groupId, kind);
  const organization = useZeropsSessionOptional()?.activeOrganization?.name ?? null;
  const [chosen, setChosen] = useState<ReadonlyArray<ProjectGrant> | null>(null);
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
  // Someone alone in the organization is asked nothing: the creator's own chip says nothing new.
  if (!draftSpeaks(view)) return null;
  // Said in one line, the chips opened only to change it (`AccessDraftFold`); drawn open only
  // while the people are still read or unreadable.
  const summary = draftSummary({ view, organization, prefill, list });
  if (summary !== null)
    return (
      <AccessDraftFold label={label} summary={summary}>
        <ProjectAccessChips
          heading={false}
          label={label}
          onAdd={add}
          onChoose={choose}
          view={view}
        />
      </AccessDraftFold>
    );
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm">{label}</span>
      <ProjectAccessChips heading={false} label={label} onAdd={add} onChoose={choose} view={view} />
    </div>
  );
}

/** What a creation role makes, as the access draft names the project. */
export const roleProjectKind = (role: "dev" | "devstage" | "stage" | "prod"): RoleProjectKind =>
  role === "dev" ? "mate" : role === "prod" ? "production" : role;
