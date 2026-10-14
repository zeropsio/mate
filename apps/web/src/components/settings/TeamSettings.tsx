/**
 * Settings → Team: everyone in the active organization — never an integration token — with their
 * role and the Mate projects it reaches, each project leading to its own page, where access to it
 * is changed. The member list and each developer's and guest's own grants come through the
 * account's data layer, held while the page is drawn.
 *
 * An organization owner or admin invites someone at its foot and, from a person's menu, gives them
 * another role or takes them off the team; making someone an owner and removing someone ask first.
 * Each change is the account's operation; a row says it is saving until Zerops answered and the
 * team was read again, and says a refusal under it.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  accountReadsAtom,
  initialStream,
  membersProjectRoles,
  organizationMembers,
  shownHqProjectPeopleAtom,
  shownProjectsAtom,
  type Invitee,
  type MembersRead,
  type SampledRead,
} from "@t3tools/client-runtime/data";
import type { AppProjects } from "@t3tools/client-runtime/zerops/appAccess";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { presetMembership, type TeamRole } from "@t3tools/client-runtime/zerops/teamRoles";
import { Link, useNavigate } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import {
  useAccountDataOptional,
  useAccountOrgId,
  useDetailDemand,
  useProjection,
} from "~/zerops/accountData";
import { captureAccountLifetime } from "~/zerops/accountLifetime";
import { useAccountOperationsOptional } from "~/zerops/accountOperations";
import { useZeropsSessionOptional } from "~/zerops/sessionContext";
import { isChief } from "~/zerops/chief";
import { useZeropsRegistry } from "~/zerops/useZeropsRegistry";
import { writeTrouble } from "~/zerops/zeropsWrite";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Avatar } from "../zerops/primitives";
import { appProjectsOf } from "../zerops/projects/projectPeople.logic";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import {
  TeamInviteDialog,
  type TeamInviteActions,
  type TeamInviteChoice,
} from "./TeamInviteDialog";
import {
  reachWords,
  invitableGroups,
  TEAM_ROLE_WORDS,
  teamGrantIds,
  teamPeople,
  type TeamPerson,
  type TeamPlace,
  type TeamView,
} from "./teamSettings.logic";

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
const UNREAD_GRANTS = Atom.make<
  Readonly<Record<string, SampledRead<ReadonlyArray<{ projectId: string; roleCode: string }>>>>
>({});

/** A change a person is asked to confirm before it is sent. */
type Confirming =
  | { readonly kind: "owner"; readonly person: TeamPerson }
  | { readonly kind: "remove"; readonly person: TeamPerson };

/** The team as the data layer holds it now, and the Mate projects to give. */
function useTeam() {
  const session = useZeropsSessionOptional();
  const orgId = useAccountOrgId();
  const clientId = session?.activeOrganization?.id ?? null;
  const organizationName = session?.activeOrganization?.name ?? "this organization";
  const { registry } = useZeropsRegistry();

  useDetailDemand("organizationMembers", undefined, clientId);
  const members = useProjection(
    organizationMembers,
    orgId === null || clientId === null ? null : { orgId, clientId },
    UNREAD_MEMBERS,
  );

  // Each developer's and guest's own grants, held while the page is drawn.
  const grantIds = useMemo(() => teamGrantIds(members.members), [members.members]);
  const grantKey = grantIds.join(",");
  const demandDetail = useAtomValue(accountReadsAtom)?.demandDetail;
  useEffect(() => {
    if (demandDetail === undefined || grantKey === "") return;
    const releases = grantKey
      .split(",")
      .map((ownerId) => demandDetail({ family: "memberProjectRoles", ownerId }));
    return () => {
      for (const release of releases) release();
    };
  }, [demandDetail, grantKey]);
  const grants = useProjection(
    membersProjectRoles,
    orgId === null ? null : { orgId, clientUserIds: grantIds },
    UNREAD_GRANTS,
  );

  const roster = useAtomValue(shownProjectsAtom).projects;
  const hqProjectPeople = useAtomValue(shownHqProjectPeopleAtom);
  const viewerUserId = session?.user?.id ?? null;
  const viewer = useAccountDataOptional()?.viewer;

  // Where each project belongs: its Mate project, or itself outside any.
  const places = useMemo(() => {
    const byProject: Record<string, TeamPlace> = {};
    for (const { id, name } of roster) byProject[id] = { key: id, name, groupId: null };
    for (const group of registry.groups)
      for (const { projectId } of group.projects)
        byProject[projectId] = { key: group.groupId, name: group.name, groupId: group.groupId };
    return byProject;
  }, [registry, roster]);

  const view = useMemo(
    () =>
      teamPeople({
        members: {
          known: members.fact.kind === "known",
          status: members.status,
          refused: members.refused,
          list: members.members,
        },
        grants,
        places,
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
    [grants, hqProjectPeople, members, places, viewer, viewerUserId],
  );

  const groups = useMemo(
    () =>
      invitableGroups(
        registry.groups,
        new Set(roster.filter((project) => isChief(project)).map((project) => project.id)),
      ),
    [registry, roster],
  );
  /** The chosen Mate projects' places and Mates, as one. */
  const projectsOf = useCallback(
    (groupIds: ReadonlyArray<string>): AppProjects => {
      const each = registry.groups
        .filter(({ groupId }) => groupIds.includes(groupId))
        .map(({ projects }) => appProjectsOf(projects));
      return {
        places: each.flatMap(({ places: one }) => one),
        mates: each.flatMap(({ mates }) => mates),
      };
    },
    [registry],
  );

  return { view, clientId, organizationName, groups, projectsOf };
}

/** Settings → Team. */
export function TeamSettings() {
  const { view, clientId, organizationName, groups, projectsOf } = useTeam();
  const operations = useAccountOperationsOptional();
  const [saving, setSaving] = useState<ReadonlySet<string>>(() => new Set());
  const [troubles, setTroubles] = useState<Readonly<Record<string, string>>>({});
  const [inviting, setInviting] = useState(false);
  const [confirming, setConfirming] = useState<Confirming | null>(null);

  const write = useCallback(
    (person: TeamPerson, intent: "remove" | TeamRole) => {
      if (operations === null || clientId === null) return;
      const isCurrent = captureAccountLifetime();
      const key = person.key;
      const said = (trouble: string | null) =>
        setTroubles(({ [key]: _was, ...rest }) =>
          trouble === null ? rest : { ...rest, [key]: trouble },
        );
      setSaving((held) => new Set(held).add(key));
      said(null);
      void operations
        .submit(
          intent === "remove"
            ? { kind: "remove-member", orgId: clientId, clientUserId: key }
            : {
                kind: "set-org-role",
                orgId: clientId,
                clientUserId: key,
                membership: presetMembership(intent),
              },
        )
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
    [clientId, operations],
  );

  const onRole = useCallback(
    (person: TeamPerson, role: TeamRole) =>
      role === "owner" ? setConfirming({ kind: "owner", person }) : write(person, role),
    [write],
  );
  const onEnd = useCallback(
    (person: TeamPerson) =>
      person.change?.end === "withdraw"
        ? write(person, "remove")
        : setConfirming({ kind: "remove", person }),
    [write],
  );

  const invite = useMemo((): TeamInviteActions | null => {
    if (operations === null || clientId === null) return null;
    return {
      check: (email) =>
        operations.run(
          { kind: "check-invitee", orgId: clientId, email },
          { orgId: clientId, unobserved: "Zerops isn't answering. Try again." },
        ),
      shownHere: (clientUserId) =>
        view.kind === "people" && view.people.some((person) => person.key === clientUserId),
      send: async (email: string, invitee: Invitee, choice: TeamInviteChoice) => {
        const { progress, evidence } = await operations.submit({
          kind: "invite-member",
          orgId: clientId,
          email,
          invitee,
          membership: presetMembership(choice.role),
          level: choice.level,
          projects: projectsOf(choice.groups),
        });
        const trouble = writeTrouble(progress, evidence);
        if (trouble !== null) throw new Error(trouble);
      },
    };
  }, [clientId, operations, projectsOf, view]);

  return (
    <SettingsPageContainer>
      <TeamList
        onEnd={onEnd}
        {...(invite === null ? {} : { onInvite: () => setInviting(true) })}
        onRole={onRole}
        organizationName={organizationName}
        saving={saving}
        troubles={troubles}
        view={view}
      />
      {invite === null || view.kind !== "people" ? null : (
        <TeamInviteDialog
          actions={invite}
          onOpenChange={setInviting}
          open={inviting}
          organizationName={organizationName}
          projects={groups}
          roles={view.invite}
        />
      )}
      <TeamConfirm
        confirming={confirming}
        onClose={() => setConfirming(null)}
        onConfirm={(asked) => {
          setConfirming(null);
          write(asked.person, asked.kind === "owner" ? "owner" : "remove");
        }}
        organizationName={organizationName}
      />
    </SettingsPageContainer>
  );
}

/** The two asks before a change that can't be taken back by the viewer alone. */
export function TeamConfirm({
  confirming,
  organizationName,
  onClose,
  onConfirm,
}: {
  readonly confirming: Confirming | null;
  readonly organizationName: string;
  readonly onClose: () => void;
  readonly onConfirm: (asked: Confirming) => void;
}) {
  const name = confirming?.person.name ?? "";
  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open={confirming !== null}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {confirming?.kind === "owner"
              ? `Make ${name} an owner of ${organizationName}?`
              : `Remove ${name} from ${organizationName}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirming?.kind === "owner"
              ? "They get billing and can remove you."
              : "They lose access to every project here, and their Mates stay in the organization."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button
            onClick={() => {
              if (confirming !== null) onConfirm(confirming);
            }}
            variant={confirming?.kind === "remove" ? "destructive" : "default"}
          >
            {confirming?.kind === "owner" ? "Make owner" : "Remove"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

const REACH_LINK = "text-foreground/80 underline-offset-2 hover:underline";

/** What a person reaches, each Mate project leading to its page, where access to it is changed. */
function Reach({ person }: { readonly person: TeamPerson }) {
  const navigate = useNavigate();
  const { reach } = person;
  const lead = [...(person.pending ? ["Invited · not joined yet"] : []), person.role].join(" · ");
  if (reach === null) return <>{lead}</>;
  const words = reachWords(reach);
  if (reach.kind !== "projects" || reach.projects.length === 0)
    return (
      <>
        {lead} · {words}
      </>
    );
  // Counted: the count opens the projects it names.
  if (reach.unnamed > 0 || reach.projects.length > 2)
    return (
      <>
        {lead} ·{" "}
        <Menu>
          <MenuTrigger render={<button className={REACH_LINK} type="button" />}>
            {words}
          </MenuTrigger>
          <MenuPopup align="start">
            {reach.projects.map((place) => (
              <MenuItem
                disabled={place.groupId === null}
                key={place.key}
                onClick={() => {
                  if (place.groupId !== null)
                    void navigate({
                      to: "/group/$groupId/flow",
                      params: { groupId: place.groupId },
                    });
                }}
              >
                {place.name}
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      </>
    );
  return (
    <>
      {lead} · on{" "}
      {reach.projects.map((place, index) => (
        <Fragment key={place.key}>
          {index === 0 ? null : " and "}
          {place.groupId === null ? (
            place.name
          ) : (
            <Link
              className={REACH_LINK}
              params={{ groupId: place.groupId }}
              to="/group/$groupId/flow"
            >
              {place.name}
            </Link>
          )}
        </Fragment>
      ))}
    </>
  );
}

/** The team as drawn from what is known of it, and what is being changed of it. */
export function TeamList({
  view,
  organizationName = "this organization",
  saving,
  troubles,
  onRole,
  onEnd,
  onInvite,
}: {
  readonly view: TeamView;
  readonly organizationName?: string;
  /** The rows being changed now, by key. */
  readonly saving?: ReadonlySet<string>;
  /** What a change's refusal said, by row key. */
  readonly troubles?: Readonly<Record<string, string>>;
  readonly onRole?: (person: TeamPerson, role: TeamRole) => void;
  readonly onEnd?: (person: TeamPerson) => void;
  /** Opens the invitation; absent, nobody is invited from here. */
  readonly onInvite?: () => void;
}) {
  return (
    <SettingsSection
      headerAction={
        view.kind === "people" ? (
          <span className="text-sm text-muted-foreground">{view.count}</span>
        ) : null
      }
      id="team"
      title="Team"
    >
      <div className="ov-team px-3 sm:px-4">
        {view.kind === "reading" ? (
          <p className="ov-sec-empty">Reading who is on the team…</p>
        ) : view.kind === "unreadable" ? (
          <p className="ov-sec-empty">{view.line}</p>
        ) : (
          <>
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
                      <span className="ov-mate-l2">
                        {busy ? "Saving…" : <Reach person={person} />}
                      </span>
                      {trouble === undefined ? null : (
                        <span className="ov-mate-l2" data-tone="failed" data-wrap="" role="alert">
                          {trouble}
                        </span>
                      )}
                    </div>
                    {person.change === null ||
                    onRole === undefined ||
                    onEnd === undefined ? null : (
                      <span className="ov-person-more">
                        <TeamPersonMenu
                          busy={busy}
                          onEnd={() => onEnd(person)}
                          onRole={(role) => onRole(person, role)}
                          organizationName={organizationName}
                          person={person}
                        />
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {view.invite.length > 0 && onInvite !== undefined ? (
              <button
                className="ov-add"
                data-zerops-surface="invite-team"
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
      </div>
    </SettingsSection>
  );
}

/** A person's ···: the roles the viewer may give them, theirs checked, then the way out. */
export function TeamPersonMenu({
  person,
  organizationName,
  busy,
  onRole,
  onEnd,
}: {
  readonly person: TeamPerson;
  readonly organizationName: string;
  readonly busy: boolean;
  readonly onRole: (role: TeamRole) => void;
  readonly onEnd: () => void;
}) {
  const change = person.change;
  if (change === null) return null;
  return (
    <Menu>
      <MenuTrigger
        aria-label={`Change ${person.name}'s role`}
        disabled={busy}
        render={<Button size="icon-xs" variant="ghost" />}
      >
        <MoreHorizontalIcon aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuRadioGroup
          onValueChange={(value) => {
            if (value !== change.current) onRole(value as TeamRole);
          }}
          value={change.current ?? ""}
        >
          {change.roles.map((role) => (
            <MenuRadioItem key={role} value={role} variant="check">
              {TEAM_ROLE_WORDS[role].label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem onClick={onEnd} variant="destructive">
          {change.end === "withdraw" ? "Withdraw invite" : `Remove from ${organizationName}`}
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
