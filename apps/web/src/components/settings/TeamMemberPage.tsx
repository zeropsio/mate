/**
 * One person's own page on the team, as legacy Zerops draws it: their face, name and e-mail; their
 * role — four cards, *Advanced*, *Update user* waiting until something changed; their *Project
 * access* — the projects whose own level differs from what their role gives, as chips, *Set custom
 * accesses* to add more, *Save project access*; and the *Danger zone*, which takes them off the
 * team — or withdraws an invitation — after asking.
 *
 * Who may: an organization owner changes anyone but their own role; an admin changes developers,
 * guests and anyone below admin, and their own project access; everyone else reads the page with
 * no control. Each press starts the change at HQ, which runs it whatever becomes of this tab, waits
 * for HQ's answer and says a refusal under it; the change's row under their name says how it goes
 * (`AccessOperationRow`). A person Zerops names no account of can't be changed from here.
 */
import { Link, useNavigate } from "@tanstack/react-router";
import type { AccessOperationRow as AccessOperation } from "@t3tools/client-runtime/data";
import type { OrgMembership } from "@t3tools/client-runtime/zerops/teamRoles";
import { mayChangeAccess } from "@t3tools/client-runtime/zerops/projectAccess";
import { Trash2Icon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

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
import { PageHeader } from "../ui/page-header";
import { PersonAvatar } from "../zerops/primitives";
import { selfLowerWords } from "../zerops/projects/projectPeople.logic";
import { AccessOperationRow } from "./AccessOperationRow";
import { MemberProjectAccess } from "./MemberProjectAccess";
import { SettingsPageContainer } from "./settingsLayout";
import { TeamRoleEditor } from "./TeamRoleEditor";
import {
  draftChanges,
  draftOf,
  membershipChanged,
  pickerLevels,
  projectChips,
  withChoice,
  withPicks,
  type AccessDraft,
  type AccessProject,
} from "./teamMember.logic";
import {
  NO_ACCOUNT_LINE,
  teamMemberChange,
  type TeamMemberPress,
  type TeamPerson,
} from "./teamSettings.logic";
import { Failure } from "../ui/failure";
import { Loading } from "../ui/loading";
import { useTeam } from "./useTeam";
import { MemberTakeOverView } from "./MemberTakeOver";
import { useMemberTakeOver } from "../../zerops/useMemberTakeOver";
import { EmptyState } from "../ui/empty";
import { SectionHeader } from "../ui/section";

/** What the page asks HQ to start; each rejects with what to tell the person. */
export interface TeamMemberActions {
  readonly updateMembership: (membership: OrgMembership) => Promise<void>;
  readonly saveAccess: (changes: ReturnType<typeof draftChanges>) => Promise<void>;
  readonly remove: () => Promise<void>;
  /** Continue and Delete on the person's access change. */
  readonly continueChange: (id: string) => Promise<void>;
  readonly deleteChange: (id: string) => Promise<void>;
}

const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Zerops didn't take the change.";

const NO_OPERATIONS: ReadonlyArray<AccessOperation> = [];

/** One press: pending until Zerops answered, its refusal said under it. */
function usePress() {
  const [pending, setPending] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const press = (run: () => Promise<void>, then?: () => void) => {
    setPending(true);
    setTrouble(null);
    run()
      .then(then, (cause: unknown) => setTrouble(messageOf(cause)))
      .finally(() => setPending(false));
  };
  return { pending, trouble, press };
}

/** The page drawn from what is known of the person; the drafts are its own. */
export function TeamMemberView({
  person,
  viewerRole,
  grants,
  grantsUnread,
  onGrantsAgain,
  projects,
  organizationName,
  actions,
  onRemoved,
  takeOver,
  operations = NO_OPERATIONS,
}: {
  readonly person: TeamPerson;
  readonly viewerRole: string | undefined;
  /** Their own level on each project; `null` while it is read. */
  readonly grants: AccessDraft | null;
  /** Why their grants could not be read, when the read failed or was refused with none held. */
  readonly grantsUnread?: string;
  /** The person's *Try again* where that read failed; absent where Zerops refused it. */
  readonly onGrantsAgain?: () => void;
  readonly projects: ReadonlyArray<AccessProject>;
  readonly organizationName: string;
  /** Absent: nothing is changed from here. */
  readonly actions?: TeamMemberActions;
  readonly onRemoved?: () => void;
  /** What the member made that keeps Zerops refusing their removal, shown above the Danger zone. */
  readonly takeOver?: ReactNode;
  /** The viewer's access changes for this person, as HQ shows them. */
  readonly operations?: ReadonlyArray<AccessOperation>;
}) {
  // HQ changes a person by their Zerops account: one Zerops doesn't name can't be changed.
  const unnamed = person.userId === undefined;
  const roleEditable = actions !== undefined && person.change !== null;
  const memberRole = person.membership.roleCode;
  const accessEditable =
    actions !== undefined && mayChangeAccess({ viewerRole, memberRole, self: person.you });

  const [membership, setMembership] = useState(person.membership);
  const role = usePress();
  const [draft, setDraft] = useState<AccessDraft | null>(null);
  // What was saved, held on screen until their grants are read again: a page never paints a
  // list it takes back. `before` is the read the save started from.
  const [held, setHeld] = useState<{
    readonly draft: AccessDraft;
    readonly before: AccessDraft | null;
  } | null>(null);
  const saved = grants ?? {};
  const shownDraft =
    draft ?? (held !== null && (grants === held.before || grants === null) ? held.draft : saved);
  const access = usePress();
  const changes = draftChanges(saved, shownDraft);
  const [askingSelf, setAskingSelf] = useState(false);
  const removal = usePress();
  const [askingRemove, setAskingRemove] = useState(false);

  const chips = projectChips({
    draft: shownDraft,
    saved,
    projects,
    memberRole,
    viewerRole,
    editable: accessEditable,
    self: person.you,
  });
  const candidates = projects.filter(({ projectId }) => shownDraft[projectId] === undefined);
  const lowersSelf =
    person.you &&
    changes.some(({ roleCode }) => roleCode === "READ_ONLY" || roleCode === "NO_ACCESS");
  const saveAccess = () => {
    const sent = shownDraft;
    const before = grants;
    access.press(
      () => actions?.saveAccess(changes) ?? Promise.resolve(),
      () => {
        setHeld({ draft: sent, before });
        setDraft(null);
      },
    );
  };
  const end = person.change?.end ?? (person.pending ? "withdraw" : "remove");
  const selfWords = selfLowerWords(viewerRole);

  return (
    <div className="tm-page" data-zerops-surface="team-member">
      <PageHeader
        lead={<PersonAvatar name={person.name} picture={person.avatarUrl} size={64} />}
        line={
          [
            ...(person.email === null || person.email === person.name ? [] : [person.email]),
            ...(person.pending ? ["Invited · not joined yet"] : []),
          ].join(" · ") || undefined
        }
        title={person.name}
      />
      {operations.map((operation) => (
        <AccessOperationRow
          address={person.email}
          key={operation.id}
          operation={operation}
          {...(actions === undefined
            ? {}
            : { onContinue: actions.continueChange, onDelete: actions.deleteChange })}
        />
      ))}
      {unnamed && (roleEditable || accessEditable) ? (
        <Failure cause={NO_ACCOUNT_LINE} data-part="unnamed" size="line" />
      ) : null}

      <section aria-label="Role" className="tm-section">
        <TeamRoleEditor
          editable={roleEditable}
          editorRole={viewerRole}
          held={person.membership}
          onChange={setMembership}
          value={membership}
        />
        {roleEditable ? (
          <div className="tm-actions">
            {role.trouble === null ? null : (
              <Failure className="me-auto" cause={role.trouble} role="alert" size="line" />
            )}
            <Button
              aria-busy={role.pending || undefined}
              disabled={
                unnamed || role.pending || !membershipChanged(person.membership, membership)
              }
              onClick={() => role.press(() => actions.updateMembership(membership))}
            >
              {role.pending ? "Updating…" : "Update user"}
            </Button>
          </div>
        ) : null}
      </section>

      <div aria-hidden="true" className="tm-rule" />

      <section aria-label="Project access" className="tm-section">
        {grants === null && held === null ? (
          grantsUnread === undefined ? (
            <Loading count={2} label="Their projects" shape="rows" />
          ) : (
            <Failure
              action={
                onGrantsAgain === undefined ? undefined : (
                  <Button onClick={onGrantsAgain} size="sm" variant="secondary">
                    Try again
                  </Button>
                )
              }
              cause={grantsUnread}
            />
          )
        ) : (
          <MemberProjectAccess
            memberRole={memberRole}
            createsProjects={person.membership.canCreateProjects}
            viewerGives={accessEditable}
            candidates={candidates}
            chips={chips}
            editable={accessEditable}
            levels={pickerLevels(memberRole)}
            onAdd={(picks) => setDraft(withPicks(shownDraft, picks))}
            onChoose={(projectId, choice) => setDraft(withChoice(shownDraft, projectId, choice))}
          />
        )}
        {grants !== null && chips.length === 0 && !accessEditable ? (
          <EmptyState size="row">Every project as their role gives it.</EmptyState>
        ) : null}
        {accessEditable ? (
          <div className="tm-actions">
            {access.trouble === null ? null : (
              <Failure className="me-auto" cause={access.trouble} role="alert" size="line" />
            )}
            <Button
              aria-busy={access.pending || undefined}
              disabled={unnamed || access.pending || changes.length === 0}
              onClick={() => (lowersSelf ? setAskingSelf(true) : saveAccess())}
            >
              {access.pending ? "Saving…" : "Save project access"}
            </Button>
          </div>
        ) : null}
      </section>

      {roleEditable ? (
        <>
          {end === "remove" && takeOver !== undefined ? (
            <>
              <div aria-hidden="true" className="tm-rule" />
              {takeOver}
            </>
          ) : null}
          <div aria-hidden="true" className="tm-rule" />
          <section aria-label="Danger zone" className="tm-section">
            <SectionHeader
              action={
                <Button
                  aria-busy={removal.pending || undefined}
                  disabled={unnamed || removal.pending}
                  onClick={() => setAskingRemove(true)}
                  size="sm"
                  variant="destructive"
                >
                  <Trash2Icon aria-hidden="true" />
                  {end === "withdraw" ? "Withdraw invite" : `Remove from ${organizationName}`}
                </Button>
              }
              line={
                end === "withdraw"
                  ? "The invitation stops working at once; you can invite them again later."
                  : `They lose access to every project in ${organizationName} at once. Their Mates stay in the organization.`
              }
              title="Danger zone"
            />
            {removal.trouble === null ? null : (
              <Failure cause={removal.trouble} role="alert" size="line" />
            )}
          </section>
        </>
      ) : null}

      <AlertDialog onOpenChange={setAskingRemove} open={askingRemove}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {end === "withdraw"
                ? `Withdraw ${person.name}'s invitation?`
                : `Remove ${person.name} from ${organizationName}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {end === "withdraw"
                ? "Their invitation link stops working."
                : "They lose access to every project here, and their Mates stay in the organization."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="secondary" />}>Cancel</AlertDialogClose>
            <Button
              onClick={() => {
                setAskingRemove(false);
                removal.press(() => actions?.remove() ?? Promise.resolve(), onRemoved);
              }}
              variant="destructive"
            >
              {end === "withdraw" ? "Withdraw" : "Remove"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      <AlertDialog onOpenChange={setAskingSelf} open={askingSelf}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{selfWords.title}</AlertDialogTitle>
            <AlertDialogDescription>{selfWords.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="secondary" />}>Cancel</AlertDialogClose>
            <Button
              onClick={() => {
                setAskingSelf(false);
                saveAccess();
              }}
              variant="destructive"
            >
              Give it up
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}

/** Settings → Team → one person. */
export function TeamMemberPage({ clientUserId }: { readonly clientUserId: string }) {
  const navigate = useNavigate();
  const ids = useMemo(() => [clientUserId], [clientUserId]);
  const team = useTeam(ids);
  const { view, clientId, startAccessChange } = team;
  const person =
    view.kind === "people" ? view.people.find(({ key }) => key === clientUserId) : null;
  const read = team.grants[clientUserId];
  // A read held from before stands while it is read again.
  const value = read?.value;
  // One object per read: the page tells a read-back from the read a save started from.
  const grants = useMemo(() => (value === undefined ? null : draftOf(value)), [value]);
  // A refused or failed read with nothing held says so; reading forever would be a lie.
  const grantsUnread =
    value !== undefined || read === undefined
      ? undefined
      : read.refused
        ? "Zerops didn't let you read their project access."
        : read.status === "failed"
          ? "Couldn't read their project access from Zerops."
          : undefined;
  // Only an Owner or Admin takes over what a member made, and never their own.
  const takesOver =
    (team.viewerRole === "OWNER" || team.viewerRole === "ADMIN") &&
    person != null &&
    !person.you &&
    !person.pending;
  const takeOver = useMemberTakeOver(takesOver ? person?.userId : undefined);
  const people = useMemo(
    () =>
      view.kind === "people"
        ? view.people.flatMap(({ userId, name, pending }) =>
            userId === undefined || pending ? [] : [{ userId, name }],
          )
        : [],
    [view],
  );
  // HQ names the person by their Zerops account (ZEROPS-067); without one the presses are disabled.
  const userId = person?.userId;
  const { continueAccessChange, deleteAccessChange } = team;
  const start = (press: TeamMemberPress) => {
    const change = person == null ? null : teamMemberChange(person, press);
    return change === null ? Promise.reject(new Error(NO_ACCOUNT_LINE)) : startAccessChange(change);
  };
  const actions: TeamMemberActions | undefined =
    !team.writable || clientId === null
      ? undefined
      : {
          updateMembership: (membership) => start({ kind: "role", membership }),
          saveAccess: (changes) => start({ kind: "projects", set: changes }),
          remove: () => start({ kind: "remove" }),
          continueChange: continueAccessChange,
          deleteChange: deleteAccessChange,
        };
  const operations = useMemo(
    () =>
      userId === undefined
        ? NO_OPERATIONS
        : team.operations.filter((candidate) => candidate.userId === userId),
    [team.operations, userId],
  );

  return (
    <SettingsPageContainer width="wide">
      {view.kind === "reading" ? (
        <Loading label="Who is on the team" shape="page" />
      ) : view.kind === "unreadable" ? (
        <Failure cause={view.line} />
      ) : person === undefined || person === null ? (
        <EmptyState
          action={
            <Button render={<Link to="/settings/team" />} size="sm" variant="link">
              Back to the team
            </Button>
          }
        >
          They're no longer on the team.
        </EmptyState>
      ) : (
        <TeamMemberView
          // A person read again starts the page's drafts over.
          key={`${person.key}:${JSON.stringify(person.membership)}`}
          {...(actions === undefined ? {} : { actions })}
          grants={grants}
          {...(grantsUnread === undefined ? {} : { grantsUnread })}
          {...(grantsUnread === undefined || read?.refused === true
            ? {}
            : { onGrantsAgain: () => team.retryGrants(clientUserId) })}
          onRemoved={() => void navigate({ to: "/settings/team" })}
          operations={operations}
          organizationName={team.organizationName}
          person={person}
          projects={team.projects}
          {...(takesOver && person.userId !== undefined
            ? {
                takeOver: (
                  <MemberTakeOverView
                    member={person.userId}
                    memberName={person.name}
                    onAgain={takeOver.again}
                    onReplace={takeOver.replace}
                    people={people}
                    read={takeOver.read}
                  />
                ),
              }
            : {})}
          viewerRole={team.viewerRole}
        />
      )}
    </SettingsPageContainer>
  );
}
