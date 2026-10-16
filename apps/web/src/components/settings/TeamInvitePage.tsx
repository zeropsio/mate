/**
 * Inviting someone to the team, on one page: their e-mail and name — asked of every address alike,
 * so the page never tells whether an address has a Zerops account (Zerops makes one, with the name,
 * where it has none); their role, each card saying what it can do; the projects they get — the one
 * the invitation was opened from, or the organization's only one, already picked — at Full or Read,
 * asked only once a project is picked; then *Invite*. A press asks Zerops who the address is and
 * sends, saying a refusal beside it; once the invitation landed the page says so under the address
 * and stays for the next one — the address and name cleared, the role and projects kept — the name
 * typed kept for their row until they join. *Done* goes back to the team.
 */
import { Link, useRouter, useSearch } from "@tanstack/react-router";
import type { Invitee, InviteeCheck } from "@t3tools/client-runtime/data";
import { presetMembership, type OrgMembership } from "@t3tools/client-runtime/zerops/teamRoles";
import { useEffect, useId, useRef, useState } from "react";

import { rememberInvitedName } from "~/zerops/invitationMemory";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { PageHeader } from "../ui/page-header";
import { ACCESS_LEVEL_LINES } from "../zerops/projects/projectPeople.logic";
import { noteInvitationSent } from "./invitationSent";
import { SettingsPageContainer } from "./settingsLayout";
import { TeamRoleEditor } from "./TeamRoleEditor";
import {
  addressProblem,
  inviteGrants,
  inviteLevels,
  invitePreselect,
  inviteReachLine,
  nameProblem,
  noPickLine,
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
    /** The name typed, as the team shows them until they join. */
    readonly name: string;
    readonly invitee: Invitee;
    readonly membership: OrgMembership;
    readonly grants: ReturnType<typeof inviteGrants>;
  }) => Promise<void>;
}

const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Zerops didn't take the invitation.";

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
}: {
  readonly organizationName: string;
  readonly viewerRole: string | undefined;
  readonly projects: ReadonlyArray<InviteProject>;
  /** The project the invitation was opened from: picked to start with. */
  readonly from?: string | undefined;
  readonly actions: TeamInviteActions;
  /** Called with the address once Zerops took the invitation. */
  readonly onSent: (address: string) => void;
  /** Where the invitation starts; a harness shows it filled. */
  readonly initialEmail?: string;
  readonly initialMembership?: OrgMembership;
}) {
  const id = useId();
  const emailField = useRef<HTMLInputElement | null>(null);
  const [email, setEmail] = useState(initialEmail);
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
  // The address the last invitation went to, said beside Invite until the next one is typed.
  const [sentTo, setSentTo] = useState<string | null>(null);

  const offered = inviteLevels(membership);
  const level =
    chosenLevel !== null && offered.levels.includes(chosenLevel) ? chosenLevel : offered.level;

  const submit = async () => {
    if (sending) return;
    setTrouble(null);
    setSentTo(null);
    const wrongAddress = addressProblem(email);
    if (wrongAddress !== null) {
      setAddressTrouble(wrongAddress);
      return;
    }
    const missing = nameProblem(first, last);
    if (missing !== null) {
      setSubmitted(true);
      setTrouble(missing);
      return;
    }
    const address = email.trim();
    setSending(true);
    try {
      // Who the address is decides only how Zerops is asked; the page says nothing of it.
      const known = await actions.check(address);
      const step = teamInviteStep(address, known, organizationName);
      if ("problem" in step) {
        setAddressTrouble(step.problem);
        return;
      }
      const invitee: Invitee =
        known.kind === "existing"
          ? { kind: "existing", userId: known.userId }
          : { kind: "new", firstName: first.trim(), lastName: last.trim() };
      await actions.send({
        email: address,
        name: `${first.trim()} ${last.trim()}`,
        invitee,
        membership,
        grants: level === null ? [] : inviteGrants({ projects, picked, level }),
      });
      onSent(address);
      // The next invitation starts here: who is cleared, what they get is kept.
      setEmail("");
      setFirst("");
      setLast("");
      setSubmitted(false);
      setSentTo(address);
      emailField.current?.focus();
    } catch (cause) {
      setTrouble(messageOf(cause));
    } finally {
      setSending(false);
    }
  };

  const pickedNone = picked.length === 0;

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
            aria-invalid={addressTrouble !== null ? true : undefined}
            autoComplete="off"
            autoFocus
            id={`${id}-email`}
            onChange={(event) => {
              setEmail(event.target.value);
              setAddressTrouble(null);
              setTrouble(null);
              setSentTo(null);
            }}
            readOnly={sending}
            ref={emailField}
            type="email"
            value={email}
          />
          {addressTrouble === null ? (
            // Where the eyes are once the field takes the focus back: the invitation that went out.
            <span className="tm-block-desc" role="status">
              {sentTo === null
                ? `Zerops e-mails them a link to join ${organizationName}${organizationName.endsWith(".") ? "" : "."}`
                : `Invitation sent to ${sentTo}.`}
            </span>
          ) : (
            <p className="tm-trouble" role="alert">
              {addressTrouble}
            </p>
          )}
        </div>
        <div className="tm-names">
          <div className="tm-field">
            <Label htmlFor={`${id}-first`}>First name</Label>
            <Input
              aria-invalid={submitted && first.trim() === "" ? true : undefined}
              id={`${id}-first`}
              onChange={(event) => {
                setFirst(event.target.value);
                setSentTo(null);
              }}
              readOnly={sending}
              value={first}
            />
          </div>
          <div className="tm-field">
            <Label htmlFor={`${id}-last`}>Last name</Label>
            <Input
              aria-invalid={submitted && last.trim() === "" ? true : undefined}
              id={`${id}-last`}
              onChange={(event) => {
                setLast(event.target.value);
                setSentTo(null);
              }}
              readOnly={sending}
              value={last}
            />
          </div>
        </div>
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
            {pickedNone ? (
              <span className="tm-block-desc" data-part="no-pick">
                {noPickLine(membership)}
              </span>
            ) : offered.levels.length > 1 ? (
              <div className="tm-role">
                <h2 className="tm-block-title" id={`${id}-level`}>
                  Access
                </h2>
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
        {sentTo === null ? null : (
          <Button render={<Link to="/settings/team" />} variant="secondary">
            Done
          </Button>
        )}
        <Button aria-busy={sending || undefined} disabled={sending} type="submit">
          {sending ? "Inviting…" : "Invite"}
        </Button>
      </div>
    </form>
  );
}

/** Settings → Team → Invite; `?project=<group id>` picks the project it was opened from. */
export function TeamInvitePage() {
  const router = useRouter();
  const { project: from } = useSearch({ from: "/settings/team_/invite" });
  const team = useTeam();
  const { clientId, write, check } = team;
  // The team is where this page leads back to: its code is fetched ahead, so it paints at once.
  useEffect(() => {
    void router.preloadRoute({ to: "/settings/team" }).catch(() => undefined);
  }, [router]);
  const actions: TeamInviteActions = {
    check,
    send: async ({ email, name, invitee, membership, grants }) => {
      if (clientId === null) throw new Error("Zerops isn't reachable from here.");
      await write({ kind: "invite-member", orgId: clientId, email, invitee, membership, grants });
      // Zerops lists the invitation by its address until they join: the typed name stands in.
      rememberInvitedName(clientId, email, name);
    },
  };
  const mayInvite = team.view.kind === "people" && team.view.invite.length > 0;
  return (
    <SettingsPageContainer width="wide">
      {team.view.kind === "people" && !mayInvite ? (
        <p className="tm-empty">Only an organization owner or admin can invite.</p>
      ) : (
        <TeamInviteView
          actions={actions}
          from={from}
          onSent={noteInvitationSent}
          organizationName={team.organizationName}
          projects={team.invitable}
          viewerRole={team.viewerRole}
        />
      )}
    </SettingsPageContainer>
  );
}
