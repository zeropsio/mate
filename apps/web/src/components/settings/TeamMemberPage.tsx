/**
 * One person's own page on the team, as legacy Zerops draws it: their face, name and e-mail; their
 * role — four cards, *Advanced*, *Update user* waiting until something changed; their *Project
 * access* — the projects whose own level differs from what their role gives, as chips, *Set custom
 * accesses* to add more, *Save project access*; and the *Danger zone*, which takes them off the
 * team — or withdraws an invitation — after asking.
 *
 * Who may: an organization owner changes anyone but their own role; an admin changes developers,
 * guests and anyone below admin, and their own project access; everyone else reads the page with
 * no control. Each press waits for Zerops's answer and says a refusal under it.
 */
import { Link, useNavigate } from "@tanstack/react-router";
import type { OrgMembership } from "@t3tools/client-runtime/zerops/teamRoles";
import { roleAtLeast } from "@t3tools/shared/zeropsRoles";
import { Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";

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
import type { TeamPerson } from "./teamSettings.logic";
import { useTeam } from "./useTeam";

/** What the page asks Zerops to do; each rejects with what to tell the person. */
export interface TeamMemberActions {
  readonly updateMembership: (membership: OrgMembership) => Promise<void>;
  readonly saveAccess: (changes: ReturnType<typeof draftChanges>) => Promise<void>;
  readonly remove: () => Promise<void>;
}

const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Zerops didn't take the change.";

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
  projects,
  organizationName,
  actions,
  onRemoved,
}: {
  readonly person: TeamPerson;
  readonly viewerRole: string | undefined;
  /** Their own level on each project; `null` while it is read. */
  readonly grants: AccessDraft | null;
  readonly projects: ReadonlyArray<AccessProject>;
  readonly organizationName: string;
  /** Absent: nothing is changed from here. */
  readonly actions?: TeamMemberActions;
  readonly onRemoved?: () => void;
}) {
  const roleEditable = actions !== undefined && person.change !== null;
  const memberRole = person.membership.roleCode;
  // An owner changes anyone's access, an admin anyone below admin and their own.
  const accessEditable =
    actions !== undefined &&
    roleAtLeast(viewerRole, "ADMIN") &&
    (roleAtLeast(viewerRole, "OWNER") || person.you || !roleAtLeast(memberRole, "ADMIN"));

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

      <section aria-label="Role" className="tm-section">
        <TeamRoleEditor
          editable={roleEditable}
          editorRole={viewerRole}
          onChange={setMembership}
          value={membership}
        />
        {roleEditable ? (
          <div className="tm-actions">
            {role.trouble === null ? null : <p role="alert">{role.trouble}</p>}
            <Button
              aria-busy={role.pending || undefined}
              disabled={role.pending || !membershipChanged(person.membership, membership)}
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
          <p className="tm-empty">Reading their projects…</p>
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
          <p className="tm-empty">Every project as their role gives it.</p>
        ) : null}
        {accessEditable ? (
          <div className="tm-actions">
            {access.trouble === null ? null : <p role="alert">{access.trouble}</p>}
            <Button
              aria-busy={access.pending || undefined}
              disabled={access.pending || changes.length === 0}
              onClick={() => (lowersSelf ? setAskingSelf(true) : saveAccess())}
            >
              {access.pending ? "Saving…" : "Save project access"}
            </Button>
          </div>
        ) : null}
      </section>

      {roleEditable ? (
        <>
          <div aria-hidden="true" className="tm-rule" />
          <section aria-label="Danger zone" className="tm-section">
            <div className="tm-block-head">
              <span className="tm-block-text">
                <h2 className="tm-block-title">Danger zone</h2>
                <span className="tm-block-desc">
                  {end === "withdraw"
                    ? "The invitation stops working at once; you can invite them again later."
                    : `They lose access to every project in ${organizationName} at once. Their Mates stay in the organization.`}
                </span>
              </span>
              <Button
                aria-busy={removal.pending || undefined}
                disabled={removal.pending}
                onClick={() => setAskingRemove(true)}
                size="sm"
                variant="destructive-outline"
              >
                <Trash2Icon aria-hidden="true" />
                {end === "withdraw" ? "Withdraw invite" : `Remove from ${organizationName}`}
              </Button>
            </div>
            {removal.trouble === null ? null : (
              <p className="tm-trouble" role="alert">
                {removal.trouble}
              </p>
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
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
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
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
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
  const { view, clientId, write } = team;
  const person =
    view.kind === "people" ? view.people.find(({ key }) => key === clientUserId) : null;
  const read = team.grants[clientUserId];
  // A read held from before stands while it is read again.
  const value = read?.value;
  // One object per read: the page tells a read-back from the read a save started from.
  const grants = useMemo(() => (value === undefined ? null : draftOf(value)), [value]);
  const actions = useMemo((): TeamMemberActions | undefined => {
    if (!team.writable || clientId === null) return undefined;
    return {
      updateMembership: (membership) =>
        write({ kind: "set-org-role", orgId: clientId, clientUserId, membership }),
      saveAccess: (changes) =>
        write({
          kind: "set-project-access",
          orgId: clientId,
          changes: changes.map((change) => ({ ...change, clientUserId })),
        }),
      remove: () => write({ kind: "remove-member", orgId: clientId, clientUserId }),
    };
  }, [clientId, clientUserId, team.writable, write]);

  return (
    <SettingsPageContainer>
      {view.kind === "reading" ? (
        <p className="tm-empty">Reading who is on the team…</p>
      ) : view.kind === "unreadable" ? (
        <p className="tm-empty">{view.line}</p>
      ) : person === undefined || person === null ? (
        <p className="tm-empty">
          They're no longer on the team. <Link to="/settings/team">Back to the team</Link>
        </p>
      ) : (
        <TeamMemberView
          // A person read again starts the page's drafts over.
          key={`${person.key}:${JSON.stringify(person.membership)}`}
          {...(actions === undefined ? {} : { actions })}
          grants={grants}
          onRemoved={() => void navigate({ to: "/settings/team" })}
          organizationName={team.organizationName}
          person={person}
          projects={team.projects}
          viewerRole={team.viewerRole}
        />
      )}
    </SettingsPageContainer>
  );
}
