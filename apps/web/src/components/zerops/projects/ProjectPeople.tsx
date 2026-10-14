/**
 * A project's People: who can work on it and how. The organization's members, the grants on the
 * project's places and whose each Mate is, all through the account's data layer; each place's own
 * row — the only read naming everybody's grants — is held while it is shown.
 *
 * An organization owner or admin invites someone at its foot and, from a person's menu, sets how
 * much they may do here or takes them out. Each change is the account's operation; a row says it
 * is saving until Zerops answered and the people were read again, and says a refusal under it.
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
import type { AppAccessChange, AppProjects } from "@t3tools/client-runtime/zerops/appAccess";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { Atom } from "effect/reactivity";
import { MoreHorizontalIcon, PlusIcon } from "lucide-react";
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

import { Button } from "../../ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../../ui/menu";
import { Avatar } from "../primitives";
import { ProjectInviteDialog, type ProjectInviteActions } from "./ProjectInviteDialog";
import {
  appProjectsOf,
  personMenu,
  projectPeople,
  type ProjectPeopleInput,
  type ProjectPeopleView,
  type ProjectPerson,
} from "./projectPeople.logic";

/** Outside an account nothing is read: every place's grants are still to come. */
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

/** Who can work on the group `groupId`, as the data layer holds it now. */
function useProjectPeople(groupId: string): {
  readonly view: ProjectPeopleView;
  readonly name: string;
  readonly app: AppProjects;
  readonly clientId: string | null;
  /** The group's Mates a person owns, by their Zerops user id. */
  readonly ownedBy: (userId: string | undefined) => ReadonlyArray<string>;
} {
  const session = useZeropsSessionOptional();
  const orgId = useAccountOrgId();
  const { registry } = useZeropsRegistry();
  const group = registry.groups.find((one) => one.groupId === groupId);
  const projects = useMemo(
    () => registry.groups.find((one) => one.groupId === groupId)?.projects ?? [],
    [groupId, registry],
  );
  const placeIds = useMemo(
    () => projects.flatMap(({ projectId, kind }) => (kind === "mate" ? [] : [projectId])),
    [projects],
  );
  const placeKey = placeIds.join(",");

  // Each place's own row, held while the section is drawn: everybody's grants come only with it.
  const demandDetail = useAtomValue(accountReadsAtom)?.demandDetail;
  useEffect(() => {
    if (demandDetail === undefined || placeKey === "") return;
    const releases = placeKey
      .split(",")
      .map((ownerId) => demandDetail({ family: "project", listing: "project", ownerId }));
    return () => {
      for (const release of releases) release();
    };
  }, [demandDetail, placeKey]);

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
    orgId === null ? null : { orgId, projectIds: placeIds },
    UNREAD_GRANTS,
  );
  const roster = useAtomValue(shownProjectsAtom).projects;
  const hqProjectPeople = useAtomValue(shownHqProjectPeopleAtom);
  const viewerUserId = session?.user?.id ?? null;
  const viewer = useAccountDataOptional()?.viewer;

  const view = useMemo(() => {
    const input: ProjectPeopleInput = {
      members: {
        known: members.fact.kind === "known",
        status: members.status,
        refused: members.refused,
        list: members.members,
      },
      projects: projects.map(({ projectId, kind }) => {
        const name = roster.find(({ id }) => id === projectId)?.name;
        return { projectId, kind, ...(name === undefined ? {} : { name }) };
      }),
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
    };
    return projectPeople(input);
  }, [grants, hqProjectPeople, members, projects, roster, viewer, viewerUserId]);
  const app = useMemo(() => appProjectsOf(projects), [projects]);
  const ownedBy = useCallback(
    (userId: string | undefined) =>
      userId === undefined
        ? []
        : app.mates.filter((projectId) => hqProjectPeople[projectId]?.owner?.userId === userId),
    [app, hqProjectPeople],
  );
  return { view, name: group?.name ?? "this project", app, clientId, ownedBy };
}

/** The People section of a project page, for the group `groupId`. */
export function ProjectPeople({ groupId }: { groupId: string }) {
  const { view, name, app, clientId, ownedBy } = useProjectPeople(groupId);
  const operations = useAccountOperationsOptional();
  const [saving, setSaving] = useState<ReadonlySet<string>>(() => new Set());
  const [troubles, setTroubles] = useState<Readonly<Record<string, string>>>({});
  const [inviting, setInviting] = useState(false);

  const change = useCallback(
    (person: ProjectPerson, next: AppAccessChange) => {
      const access = person.change;
      if (operations === null || clientId === null || access === null) return;
      const isCurrent = captureAccountLifetime();
      const key = person.key;
      const said = (trouble: string | null) =>
        setTroubles(({ [key]: _was, ...rest }) =>
          trouble === null ? rest : { ...rest, [key]: trouble },
        );
      setSaving((held) => new Set(held).add(key));
      said(null);
      void operations
        .submit({
          kind: "set-app-access",
          orgId: clientId,
          clientUserId: access.clientUserId,
          change: next,
          projects: app,
          owned: access.owned,
        })
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
    [app, clientId, operations],
  );

  const invite = useMemo((): ProjectInviteActions | null => {
    if (operations === null || clientId === null) return null;
    return {
      check: (email) =>
        operations.run(
          { kind: "check-invitee", orgId: clientId, email },
          { orgId: clientId, unobserved: "Zerops isn't answering. Try again." },
        ),
      shownHere: (clientUserId) =>
        view.kind === "people" && view.people.some((person) => person.key === clientUserId),
      send: async (email, invitee, level) => {
        const { progress, evidence } = await operations.submit(
          invitee.kind === "member"
            ? {
                kind: "set-app-access",
                orgId: clientId,
                clientUserId: invitee.clientUserId,
                change: level,
                projects: app,
                owned: ownedBy(invitee.userId),
              }
            : { kind: "invite-member", orgId: clientId, email, invitee, level, projects: app },
        );
        const trouble = writeTrouble(progress, evidence);
        if (trouble !== null) throw new Error(trouble);
      },
    };
  }, [app, clientId, operations, ownedBy, view]);

  return (
    <>
      <ProjectPeopleList
        onChange={change}
        {...(invite === null ? {} : { onInvite: () => setInviting(true) })}
        projectName={name}
        saving={saving}
        troubles={troubles}
        view={view}
      />
      {invite === null ? null : (
        <ProjectInviteDialog
          actions={invite}
          onOpenChange={setInviting}
          open={inviting}
          projectName={name}
        />
      )}
    </>
  );
}

/** The section as drawn from what is known of the people, and what is being changed of them. */
export function ProjectPeopleList({
  view,
  projectName = "this project",
  saving,
  troubles,
  onChange,
  onInvite,
}: {
  readonly view: ProjectPeopleView;
  readonly projectName?: string;
  /** The rows whose access is being changed now, by key. */
  readonly saving?: ReadonlySet<string>;
  /** What a change's refusal said, by row key. */
  readonly troubles?: Readonly<Record<string, string>>;
  readonly onChange?: (person: ProjectPerson, change: AppAccessChange) => void;
  /** Opens the invitation; absent, nobody is invited from here. */
  readonly onInvite?: () => void;
}) {
  return (
    <section className="ov-sec" aria-label="People">
      <h3 className="ov-sec-name">People</h3>
      {view.kind === "reading" ? (
        <p className="ov-sec-empty">Reading who has access…</p>
      ) : view.kind === "unreadable" ? (
        <p className="ov-sec-empty">{view.line}</p>
      ) : (
        <>
          {view.people.length === 0 ? (
            <p className="ov-sec-empty">Nobody has access yet.</p>
          ) : (
            <ul className="ov-people">
              {view.people.map((person) => {
                const busy = saving?.has(person.key) === true;
                const trouble = troubles?.[person.key];
                return (
                  <li
                    className="ov-person"
                    data-pending={person.pending || undefined}
                    key={person.key}
                  >
                    <Avatar initials={person.initials} size="md" src={person.avatarUrl} />
                    <div className="ov-mate-text">
                      <div className="ov-mate-l1">
                        <span className="ov-mate-name">{person.name}</span>
                        {person.you ? <span className="ov-person-you">You</span> : null}
                      </div>
                      <span className="ov-mate-l2">{busy ? "Saving…" : person.line}</span>
                      {trouble === undefined ? null : (
                        <span className="ov-mate-l2" data-tone="failed" data-wrap="" role="alert">
                          {trouble}
                        </span>
                      )}
                    </div>
                    {person.change === null || onChange === undefined ? null : (
                      <span className="ov-person-more">
                        <PersonMenu
                          busy={busy}
                          onChange={(next) => onChange(person, next)}
                          person={person}
                          projectName={projectName}
                        />
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {view.invite && onInvite !== undefined ? (
            <button
              className="ov-add"
              data-zerops-surface="invite-person"
              onClick={onInvite}
              type="button"
            >
              <span aria-hidden="true" className="ov-add-face">
                <PlusIcon className="size-4" />
              </span>
              <span>Invite</span>
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

/** A person's ···: their level here, theirs checked, then the way out. */
function PersonMenu({
  person,
  projectName,
  busy,
  onChange,
}: {
  readonly person: ProjectPerson;
  readonly projectName: string;
  readonly busy: boolean;
  readonly onChange: (change: AppAccessChange) => void;
}) {
  if (person.change === null) return null;
  const entries = personMenu(person.change, projectName);
  const levels = entries.flatMap((entry) => (entry.kind === "level" ? [entry] : []));
  const end = entries.find((entry) => entry.kind === "end");
  return (
    <Menu>
      <MenuTrigger
        aria-label={`Change ${person.name}'s access`}
        disabled={busy}
        render={<Button size="icon-xs" variant="ghost" />}
      >
        <MoreHorizontalIcon aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuRadioGroup
          onValueChange={(value) => {
            if (value !== person.change?.level) onChange(value as AppAccessChange);
          }}
          value={person.change.level ?? ""}
        >
          {levels.map((entry) => (
            <MenuRadioItem key={entry.level} value={entry.level} variant="check">
              {entry.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        {end === undefined ? null : (
          <>
            <MenuSeparator />
            <MenuItem onClick={() => onChange(end.end)} variant="destructive">
              {end.label}
            </MenuItem>
          </>
        )}
      </MenuPopup>
    </Menu>
  );
}
