/**
 * Inviting someone to the team, on one page: their e-mail and name — asked of every address alike,
 * so the page never tells whether an address has a Zerops account (Zerops makes one, with the name,
 * where it has none); their role, each card saying what it can do; the projects they get — the one
 * the invitation was opened from, or the organization's only one, already picked — at Full or Read,
 * asked only once a project is picked; then *Invite*. A press asks Zerops who the address is and
 * starts the invitation at HQ, which sends it whatever becomes of this tab, saying a refusal beside
 * it; once HQ took it the page goes back to the team, where a toast says it is on its way and their
 * row grows in — the name typed kept for that row until they join.
 */
import { useRouter, useSearch } from "@tanstack/react-router";
import type { InviteeCheck } from "@t3tools/client-runtime/data";
import { presetMembership, type OrgMembership } from "@t3tools/client-runtime/zerops/teamRoles";
import { useEffect, useId, useState } from "react";

import { toastManager } from "~/lib/toasts";
import { rememberInvitedName } from "~/zerops/invitationMemory";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { EmptyState } from "../ui/empty";
import { Failure } from "../ui/failure";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { PageHeader } from "../ui/page-header";
import { RadioCard, RadioGroup } from "../ui/radio-group";
import { Row } from "../ui/row";
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
import { SectionHeader } from "../ui/section";

/** What the invitation asks Zerops and HQ; each rejects with what to tell the person. */
export interface TeamInviteActions {
  readonly check: (email: string) => Promise<InviteeCheck>;
  readonly send: (input: {
    readonly email: string;
    /** The name typed, as the team shows them until they join. */
    readonly name: string;
    /** The names Zerops makes an account with, for an address that has none. */
    readonly names?: { readonly firstName: string; readonly lastName: string };
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
  /** Called with the address once HQ took the invitation and a toast said so: where to go next. */
  readonly onSent: (address: string) => void;
  /** Where the invitation starts; a harness shows it filled. */
  readonly initialEmail?: string;
  readonly initialMembership?: OrgMembership;
}) {
  const id = useId();
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

  const offered = inviteLevels(membership);
  const level =
    chosenLevel !== null && offered.levels.includes(chosenLevel) ? chosenLevel : offered.level;

  const submit = async () => {
    if (sending) return;
    setTrouble(null);
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
      await actions.send({
        email: address,
        name: `${first.trim()} ${last.trim()}`,
        ...(known.kind === "existing"
          ? {}
          : { names: { firstName: first.trim(), lastName: last.trim() } }),
        membership,
        grants: level === null ? [] : inviteGrants({ projects, picked, level }),
      });
      toastManager.add({ type: "success", title: `Invitation sent to ${address}` });
      onSent(address);
    } catch (cause) {
      setTrouble(messageOf(cause));
    } finally {
      setSending(false);
    }
  };

  const pickedNone = picked.length === 0;

  return (
    <form
      className="grid w-full max-w-140 gap-11 px-3"
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
      <section aria-label="Who" className="grid gap-3.5">
        <div className="grid gap-1.5">
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
            }}
            readOnly={sending}
            type="email"
            value={email}
          />
          {addressTrouble === null ? (
            <span className="text-body leading-4.5 text-pretty text-muted-foreground">
              {`Zerops e-mails them a link to join ${organizationName}${organizationName.endsWith(".") ? "" : "."}`}
            </span>
          ) : (
            <Failure cause={addressTrouble} role="alert" size="line" />
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-first`}>First name</Label>
            <Input
              aria-invalid={submitted && first.trim() === "" ? true : undefined}
              id={`${id}-first`}
              onChange={(event) => setFirst(event.target.value)}
              readOnly={sending}
              value={first}
            />
          </div>
          <div className="grid gap-1.5">
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
      </section>
      <section aria-label="Role" className="grid gap-3.5">
        <TeamRoleEditor
          editable={!sending}
          editorRole={viewerRole}
          onChange={setMembership}
          value={membership}
        />
      </section>
      <section aria-label="Projects" className="grid gap-3.5">
        <SectionHeader line={inviteReachLine(membership, projects.length)} title="Projects" />
        {level === null || projects.length === 0 ? null : (
          <>
            <ul
              aria-label="Projects to give"
              className="grid gap-0.5 rounded-card bg-muted p-1.5 [--accent:color-mix(in_oklab,var(--foreground)_6%,var(--muted))]"
            >
              {projects.map((project) => (
                <li key={project.key}>
                  <Row
                    lead={
                      <Checkbox
                        checked={picked.includes(project.key)}
                        disabled={sending}
                        onCheckedChange={(on) => {
                          const others = picked.filter((key) => key !== project.key);
                          setOwnPicks(on === true ? [...others, project.key] : others);
                        }}
                      />
                    }
                    pressable
                    render={<label />}
                    size="sm"
                    title={project.name}
                  />
                </li>
              ))}
            </ul>
            {pickedNone ? (
              <span
                className="text-body leading-4.5 text-pretty text-muted-foreground"
                data-part="no-pick"
              >
                {noPickLine(membership)}
              </span>
            ) : offered.levels.length > 1 ? (
              <div className="grid gap-2.5">
                <SectionHeader id={`${id}-level`} title="Access" />
                <RadioGroup
                  aria-labelledby={`${id}-level`}
                  layout="columns"
                  disabled={sending}
                  onValueChange={(picked) => {
                    const option = offered.levels.find((candidate) => candidate === picked);
                    if (option !== undefined) setChosenLevel(option);
                  }}
                  value={level}
                >
                  {offered.levels.map((option) => (
                    <RadioCard
                      className="min-h-24 max-sm:min-h-0"
                      key={option}
                      title={LEVEL_WORDS[option]}
                      value={option}
                    >
                      {ACCESS_LEVEL_LINES[option]}
                    </RadioCard>
                  ))}
                </RadioGroup>
              </div>
            ) : (
              <span className="text-body leading-4.5 text-pretty text-muted-foreground">
                {LEVEL_WORDS[level]} access: {lowerFirst(ACCESS_LEVEL_LINES[level])}
              </span>
            )}
          </>
        )}
      </section>
      <div className="flex items-center justify-end gap-2">
        {trouble === null ? null : (
          <Failure className="me-auto" cause={trouble} role="alert" size="line" />
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
  const { clientId, startAccessChange, check } = team;
  // The team is where this page leads back to: its code is fetched ahead, so it paints at once.
  useEffect(() => {
    void router.preloadRoute({ to: "/settings/team" }).catch(() => undefined);
  }, [router]);
  const actions: TeamInviteActions = {
    check,
    send: async ({ email, name, names, membership, grants }) => {
      if (clientId === null) throw new Error("Zerops isn't reachable from here.");
      await startAccessChange({
        kind: "invite",
        email,
        ...(names === undefined ? {} : { names }),
        membership,
        ...(grants.length === 0 ? {} : { grants }),
      });
      // Zerops lists the invitation by its address until they join: the typed name stands in.
      rememberInvitedName(clientId, email, name);
    },
  };
  const mayInvite = team.view.kind === "people" && team.view.invite.length > 0;
  return (
    <SettingsPageContainer width="wide">
      {team.view.kind === "people" && !mayInvite ? (
        <EmptyState>Only an organization owner or admin can invite.</EmptyState>
      ) : (
        <TeamInviteView
          actions={actions}
          from={from}
          onSent={(address) => {
            // Back to the team, which grows their row in once Zerops lists it.
            noteInvitationSent(address);
            void router.navigate({ to: "/settings/team" });
          }}
          organizationName={team.organizationName}
          projects={team.invitable}
          viewerRole={team.viewerRole}
        />
      )}
    </SettingsPageContainer>
  );
}
