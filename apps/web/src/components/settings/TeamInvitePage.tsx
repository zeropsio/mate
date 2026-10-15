/**
 * Inviting someone to the team, as legacy Zerops does it, on a page of its own: first their
 * e-mail, in a narrow card, checked with Zerops. Then "Adding <e-mail>": their first and last name
 * where the address has no Zerops account yet (Zerops makes one with the invitation), the same role
 * cards, *Advanced* and *Project access* as a person's own page, and *Send invite*. Each press
 * waits for Zerops's answer and says a refusal beside it; once the invitation landed the team is
 * shown.
 */
import { useNavigate } from "@tanstack/react-router";
import type { Invitee, InviteeCheck } from "@t3tools/client-runtime/data";
import { presetMembership, type OrgMembership } from "@t3tools/client-runtime/zerops/teamRoles";
import { useId, useState } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { MemberProjectAccess } from "./MemberProjectAccess";
import { SettingsPageContainer } from "./settingsLayout";
import { TeamRoleEditor } from "./TeamRoleEditor";
import {
  addressProblem,
  draftGrants,
  pickerLevels,
  projectChips,
  teamInviteStep,
  withChoice,
  withPicks,
  type AccessDraft,
  type AccessProject,
  nameProblem,
  type TeamInviteStep,
} from "./teamMember.logic";
import { useTeam } from "./useTeam";

/** What the invitation asks Zerops; each rejects with what to tell the person. */
export interface TeamInviteActions {
  readonly check: (email: string) => Promise<InviteeCheck>;
  readonly send: (input: {
    readonly email: string;
    readonly invitee: Invitee;
    readonly membership: OrgMembership;
    readonly grants: ReturnType<typeof draftGrants>;
  }) => Promise<void>;
}

const NO_DRAFT: AccessDraft = {};

const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Zerops didn't take the invitation.";

export function TeamInviteView({
  organizationName,
  viewerRole,
  projects,
  actions,
  onSent,
  initial = null,
  initialMembership,
  initialDraft = NO_DRAFT,
}: {
  readonly organizationName: string;
  readonly viewerRole: string | undefined;
  readonly projects: ReadonlyArray<AccessProject>;
  readonly actions: TeamInviteActions;
  readonly onSent: () => void;
  /** Where the invitation starts; a harness shows each step. */
  readonly initial?: TeamInviteStep | null;
  readonly initialMembership?: OrgMembership;
  readonly initialDraft?: AccessDraft;
}) {
  const id = useId();
  const [step, setStep] = useState<TeamInviteStep | null>(initial);
  const [email, setEmail] = useState(initial?.email ?? "");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [membership, setMembership] = useState<OrgMembership>(
    initialMembership ?? presetMembership("developer"),
  );
  const [draft, setDraft] = useState<AccessDraft>(initialDraft);
  const [pending, setPending] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const isNew = step?.step === "details" && step.existing === null;
  const problem = step === null ? addressProblem(email) : isNew ? nameProblem(first, last) : null;

  const press = (run: () => Promise<void>) => {
    setPending(true);
    setTrouble(null);
    run()
      .catch((cause: unknown) => setTrouble(messageOf(cause)))
      .finally(() => setPending(false));
  };

  const submit = () => {
    if (pending) return;
    setSubmitted(true);
    if (problem !== null) return;
    if (step === null) {
      const address = email.trim();
      return press(async () => {
        const next = teamInviteStep(address, await actions.check(address), organizationName);
        setSubmitted(false);
        if ("problem" in next) setTrouble(next.problem);
        else setStep(next);
      });
    }
    if (step.step !== "details") return;
    const invitee: Invitee =
      step.existing === null
        ? { kind: "new", firstName: first.trim(), lastName: last.trim() }
        : { kind: "existing", userId: step.existing };
    return press(async () => {
      await actions.send({ email: step.email, invitee, membership, grants: draftGrants(draft) });
      onSent();
    });
  };

  const chips = projectChips({
    draft,
    saved: draft,
    projects,
    memberRole: membership.roleCode,
    viewerRole,
    editable: true,
    self: false,
  });
  const failed = submitted && problem !== null ? problem : trouble;

  return (
    <form
      className="tm-page"
      data-zerops-surface="team-invite"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {step === null ? (
        <div className="tm-invite-card">
          <div className="tm-block-text">
            <h1 className="tm-block-title">Add a new team member</h1>
            <span className="tm-block-desc">
              Zerops e-mails them a link to join {organizationName}
              {organizationName.endsWith(".") ? "" : "."}
            </span>
          </div>
          <div className="tm-field">
            <Label htmlFor={`${id}-email`}>E-mail</Label>
            <Input
              aria-invalid={failed !== null ? true : undefined}
              autoComplete="off"
              autoFocus
              id={`${id}-email`}
              onChange={(event) => {
                setEmail(event.target.value);
                setTrouble(null);
              }}
              readOnly={pending}
              type="email"
              value={email}
            />
            {failed === null ? null : (
              <p className="tm-trouble" role="alert">
                {failed}
              </p>
            )}
          </div>
          <div className="tm-actions">
            <Button aria-busy={pending || undefined} disabled={pending} type="submit">
              {pending ? "Checking…" : "Continue"}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <header className="tm-block-text">
            <h1 className="tm-head-name">
              Adding <span className="font-semibold">{step.email}</span>
            </h1>
            <span className="tm-block-desc">
              {isNew
                ? "No Zerops account uses this address yet: Zerops makes one with the invitation."
                : "They have a Zerops account: they join once they accept."}
            </span>
          </header>
          {isNew ? (
            <div className="tm-names">
              <div className="tm-field">
                <Label htmlFor={`${id}-first`}>First name</Label>
                <Input
                  aria-invalid={submitted && first.trim() === "" ? true : undefined}
                  autoFocus
                  id={`${id}-first`}
                  onChange={(event) => setFirst(event.target.value)}
                  value={first}
                />
              </div>
              <div className="tm-field">
                <Label htmlFor={`${id}-last`}>Last name</Label>
                <Input
                  aria-invalid={submitted && last.trim() === "" ? true : undefined}
                  id={`${id}-last`}
                  onChange={(event) => setLast(event.target.value)}
                  value={last}
                />
              </div>
            </div>
          ) : null}
          <section aria-label="Role" className="tm-section">
            <TeamRoleEditor
              editable={!pending}
              editorRole={viewerRole}
              onChange={setMembership}
              value={membership}
            />
          </section>
          <section aria-label="Project access" className="tm-section">
            <MemberProjectAccess
              memberRole={membership.roleCode}
              createsProjects={membership.canCreateProjects}
              viewerGives
              candidates={projects.filter(({ projectId }) => draft[projectId] === undefined)}
              chips={chips}
              editable={!pending}
              levels={pickerLevels(membership.roleCode)}
              onAdd={(picks) => setDraft(withPicks(draft, picks))}
              onChoose={(projectId, choice) => setDraft(withChoice(draft, projectId, choice))}
            />
          </section>
          <div className="tm-actions">
            {failed === null ? null : <p role="alert">{failed}</p>}
            <Button
              onClick={() => {
                setStep(null);
                setTrouble(null);
              }}
              type="button"
              variant="ghost"
            >
              Change the e-mail
            </Button>
            <Button aria-busy={pending || undefined} disabled={pending} type="submit">
              {pending ? "Sending…" : "Send invite"}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}

/** Settings → Team → Invite. */
export function TeamInvitePage() {
  const navigate = useNavigate();
  const team = useTeam();
  const { clientId, write, check } = team;
  const actions: TeamInviteActions = {
    check,
    send: ({ email, invitee, membership, grants }) =>
      clientId === null
        ? Promise.reject(new Error("Zerops isn't reachable from here."))
        : write({ kind: "invite-member", orgId: clientId, email, invitee, membership, grants }),
  };
  const mayInvite = team.view.kind === "people" && team.view.invite.length > 0;
  return (
    <SettingsPageContainer>
      {team.view.kind === "people" && !mayInvite ? (
        <p className="tm-empty">Only an organization owner or admin can invite.</p>
      ) : (
        <TeamInviteView
          actions={actions}
          onSent={() => void navigate({ to: "/settings/team" })}
          organizationName={team.organizationName}
          projects={team.projects}
          viewerRole={team.viewerRole}
        />
      )}
    </SettingsPageContainer>
  );
}
