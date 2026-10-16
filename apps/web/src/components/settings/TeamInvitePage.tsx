/**
 * Inviting someone to the team, on one page: their e-mail, checked with Zerops as the field is
 * left (or Invite pressed); their first and last name where the address has no Zerops account yet
 * (Zerops makes one with the invitation); their role, each card saying what it can do; the
 * projects they get — the one the invitation was opened from, or the organization's only one,
 * already picked — at Full or Read, each explained once here; then *Invite*. A press waits for
 * Zerops's answer and says a refusal beside it; once the invitation landed the team is shown, the
 * name typed kept for their row until they join.
 */
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { Invitee, InviteeCheck } from "@t3tools/client-runtime/data";
import { presetMembership, type OrgMembership } from "@t3tools/client-runtime/zerops/teamRoles";
import { useId, useState } from "react";

import { rememberInvitedName } from "~/zerops/invitationMemory";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { PageHeader } from "../ui/page-header";
import { ACCESS_LEVEL_LINES } from "../zerops/projects/projectPeople.logic";
import { SettingsPageContainer } from "./settingsLayout";
import { TeamRoleEditor } from "./TeamRoleEditor";
import {
  addressProblem,
  inviteGrants,
  inviteLevels,
  invitePreselect,
  inviteReachLine,
  nameProblem,
  teamInviteStep,
  type InviteLevel,
  type InviteProject,
} from "./teamMember.logic";
import { useTeam } from "./useTeam";

/** What the invitation asks Zerops; each rejects with what to tell the person. */
export interface TeamInviteActions {
  readonly check: (email: string) => Promise<InviteeCheck>;
  readonly send: (input: {
    readonly email: string;
    readonly invitee: Invitee;
    readonly membership: OrgMembership;
    readonly grants: ReturnType<typeof inviteGrants>;
  }) => Promise<void>;
}

const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Zerops didn't take the invitation.";

/** Zerops's answer for the address it was asked about. */
interface Checked {
  readonly email: string;
  readonly answer: InviteeCheck;
}

const LEVEL_WORDS: Readonly<Record<InviteLevel, string>> = { full: "Full", read: "Read" };

const lowerFirst = (line: string) => line.charAt(0).toLocaleLowerCase() + line.slice(1);

export function TeamInviteView({
  organizationName,
  viewerRole,
  projects,
  from,
  actions,
  onSent,
  initialEmail = "",
  initialMembership,
  initialAnswer,
}: {
  readonly organizationName: string;
  readonly viewerRole: string | undefined;
  readonly projects: ReadonlyArray<InviteProject>;
  /** The project the invitation was opened from: picked to start with. */
  readonly from?: string | undefined;
  readonly actions: TeamInviteActions;
  readonly onSent: () => void;
  /** Where the invitation starts; a harness shows it filled. */
  readonly initialEmail?: string;
  readonly initialMembership?: OrgMembership;
  /** Zerops's answer for `initialEmail`, as a harness shows it checked. */
  readonly initialAnswer?: InviteeCheck | undefined;
}) {
  const id = useId();
  const [email, setEmail] = useState(initialEmail);
  const [checked, setChecked] = useState<Checked | null>(
    initialAnswer === undefined ? null : { email: initialEmail.trim(), answer: initialAnswer },
  );
  const [checking, setChecking] = useState(false);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [membership, setMembership] = useState<OrgMembership>(
    initialMembership ?? presetMembership("developer"),
  );
  // The person's own picks once they touch one; until then the preselection, as projects arrive.
  const [ownPicks, setOwnPicks] = useState<ReadonlyArray<string> | null>(null);
  const picked = ownPicks ?? invitePreselect({ projects, from });
  const [chosenLevel, setChosenLevel] = useState<InviteLevel | null>(null);
  const [sending, setSending] = useState(false);
  // What stops the address (under it), and what stops the invitation (beside Invite).
  const [addressTrouble, setAddressTrouble] = useState<string | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const address = email.trim();
  const answer = checked?.email === address ? checked.answer : null;
  const isNew = answer?.kind === "new";
  const offered = inviteLevels(membership);
  const level =
    chosenLevel !== null && offered.levels.includes(chosenLevel) ? chosenLevel : offered.level;
  const pending = checking || sending;

  /** Asks Zerops who the address is; the answer, or `null` where it stops the invitation. */
  const check = async (): Promise<InviteeCheck | null> => {
    if (answer !== null) return answer;
    setChecking(true);
    try {
      const next = await actions.check(address);
      setChecked({ email: address, answer: next });
      const step = teamInviteStep(address, next, organizationName);
      if ("problem" in step) {
        setAddressTrouble(step.problem);
        return null;
      }
      return next;
    } catch (cause) {
      setAddressTrouble(messageOf(cause));
      return null;
    } finally {
      setChecking(false);
    }
  };

  const leaveEmail = () => {
    if (pending || answer !== null || addressProblem(email) !== null) return;
    setAddressTrouble(null);
    void check();
  };

  const submit = async () => {
    if (pending) return;
    setTrouble(null);
    const wrongAddress = addressProblem(email);
    if (wrongAddress !== null) {
      setAddressTrouble(wrongAddress);
      return;
    }
    const known = await check();
    if (known === null || known.kind === "member") return;
    if (known.kind === "new") {
      // Names are asked once the address turns out new: a press before they were seen says nothing.
      if (answer === null) return;
      const missing = nameProblem(first, last);
      if (missing !== null) {
        setSubmitted(true);
        setTrouble(missing);
        return;
      }
    }
    const invitee: Invitee =
      known.kind === "new"
        ? { kind: "new", firstName: first.trim(), lastName: last.trim() }
        : { kind: "existing", userId: known.userId };
    setSending(true);
    try {
      await actions.send({
        email: address,
        invitee,
        membership,
        grants: level === null ? [] : inviteGrants({ projects, picked, level }),
      });
      onSent();
    } catch (cause) {
      setTrouble(messageOf(cause));
    } finally {
      setSending(false);
    }
  };

  // The line under the address: what goes wrong, else who Zerops says it is.
  const emailTrouble = addressTrouble;
  const emailLine =
    answer?.kind === "new"
      ? "No Zerops account uses this address yet: Zerops makes one with the invitation."
      : answer?.kind === "existing"
        ? "They have a Zerops account: they join once they accept."
        : checking
          ? "Checking the address with Zerops…"
          : `Zerops e-mails them a link to join ${organizationName}${organizationName.endsWith(".") ? "" : "."}`;

  return (
    <form
      className="tm-page"
      data-zerops-surface="team-invite"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <PageHeader
        line="People you invite sign in with their own Zerops account."
        title={`Invite someone to ${organizationName}`}
      />
      <section aria-label="Who" className="tm-section">
        <div className="tm-field">
          <Label htmlFor={`${id}-email`}>E-mail</Label>
          <Input
            aria-invalid={emailTrouble !== null ? true : undefined}
            autoComplete="off"
            autoFocus
            id={`${id}-email`}
            onBlur={leaveEmail}
            onChange={(event) => {
              setEmail(event.target.value);
              setAddressTrouble(null);
              setTrouble(null);
              setSubmitted(false);
            }}
            readOnly={sending}
            type="email"
            value={email}
          />
          {emailTrouble === null ? (
            <span className="tm-block-desc" role="status">
              {emailLine}
            </span>
          ) : (
            <p className="tm-trouble" role="alert">
              {emailTrouble}
            </p>
          )}
        </div>
        {isNew ? (
          <div className="tm-names">
            <div className="tm-field">
              <Label htmlFor={`${id}-first`}>First name</Label>
              <Input
                aria-invalid={submitted && first.trim() === "" ? true : undefined}
                id={`${id}-first`}
                onChange={(event) => setFirst(event.target.value)}
                readOnly={sending}
                value={first}
              />
            </div>
            <div className="tm-field">
              <Label htmlFor={`${id}-last`}>Last name</Label>
              <Input
                aria-invalid={submitted && last.trim() === "" ? true : undefined}
                id={`${id}-last`}
                onChange={(event) => setLast(event.target.value)}
                readOnly={sending}
                value={last}
              />
            </div>
          </div>
        ) : null}
      </section>
      <section aria-label="Role" className="tm-section">
        <TeamRoleEditor
          editable={!sending}
          editorRole={viewerRole}
          onChange={setMembership}
          value={membership}
        />
      </section>
      <section aria-label="Projects" className="tm-section">
        <span className="tm-block-text">
          <h2 className="tm-block-title">Projects</h2>
          <span className="tm-block-desc">{inviteReachLine(membership, projects.length)}</span>
        </span>
        {level === null || projects.length === 0 ? null : (
          <>
            <ul aria-label="Projects to give" className="tm-invite-projects">
              {projects.map((project) => (
                <li key={project.key}>
                  <label className="tm-invite-project">
                    <Checkbox
                      checked={picked.includes(project.key)}
                      disabled={sending}
                      onCheckedChange={(on) => {
                        const others = picked.filter((key) => key !== project.key);
                        setOwnPicks(on === true ? [...others, project.key] : others);
                      }}
                    />
                    <span className="tm-pick-name">{project.name}</span>
                  </label>
                </li>
              ))}
            </ul>
            {offered.levels.length > 1 ? (
              <div className="tm-role">
                <span className="tm-label" id={`${id}-level`}>
                  Access
                </span>
                <div aria-labelledby={`${id}-level`} className="tm-role-cards" role="radiogroup">
                  {offered.levels.map((option) => (
                    <button
                      aria-checked={level === option}
                      className="tm-role-card"
                      data-selected={level === option || undefined}
                      disabled={sending}
                      key={option}
                      onClick={() => setChosenLevel(option)}
                      role="radio"
                      type="button"
                    >
                      <span className="tm-role-card-name">{LEVEL_WORDS[option]}</span>
                      <span className="tm-role-card-text">{ACCESS_LEVEL_LINES[option]}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <span className="tm-block-desc">
                {LEVEL_WORDS[level]} access: {lowerFirst(ACCESS_LEVEL_LINES[level])}
              </span>
            )}
          </>
        )}
      </section>
      <div className="tm-actions">
        {trouble === null ? null : <p role="alert">{trouble}</p>}
        <Button aria-busy={pending || undefined} disabled={pending} type="submit">
          {sending ? "Inviting…" : checking ? "Checking…" : "Invite"}
        </Button>
      </div>
    </form>
  );
}

/** Settings → Team → Invite; `?project=<group id>` picks the project it was opened from. */
export function TeamInvitePage() {
  const navigate = useNavigate();
  const { project: from } = useSearch({ from: "/settings/team_/invite" });
  const team = useTeam();
  const { clientId, write, check } = team;
  const actions: TeamInviteActions = {
    check,
    send: async ({ email, invitee, membership, grants }) => {
      if (clientId === null) throw new Error("Zerops isn't reachable from here.");
      await write({ kind: "invite-member", orgId: clientId, email, invitee, membership, grants });
      // Zerops lists the invitation by its address until they join: the typed name stands in.
      if (invitee.kind === "new")
        rememberInvitedName(clientId, email, `${invitee.firstName} ${invitee.lastName}`);
    },
  };
  const mayInvite = team.view.kind === "people" && team.view.invite.length > 0;
  return (
    <SettingsPageContainer>
      {team.view.kind === "people" && !mayInvite ? (
        <p className="tm-empty">Only an organization owner or admin can invite.</p>
      ) : (
        <TeamInviteView
          actions={actions}
          from={from}
          onSent={() => void navigate({ to: "/settings/team" })}
          organizationName={team.organizationName}
          projects={team.invitable}
          viewerRole={team.viewerRole}
        />
      )}
    </SettingsPageContainer>
  );
}
