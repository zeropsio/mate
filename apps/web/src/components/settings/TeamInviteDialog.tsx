/**
 * Inviting someone to the organization's team: their e-mail, checked with Zerops; their name where
 * the address has no Zerops account yet; then their role — and, for a developer or a guest, the
 * Mate projects they're given and how much they may do there — and *Send invite*. Each press waits
 * for Zerops's answer in the dialog and says a refusal there; the dialog closes once the invitation
 * landed and the team shows it.
 */
import type { Invitee, InviteeCheck } from "@t3tools/client-runtime/data";
import type { AppAccessLevel } from "@t3tools/client-runtime/zerops/appAccess";
import type { TeamRole } from "@t3tools/client-runtime/zerops/teamRoles";
import { useId, useState } from "react";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Radio, RadioGroup } from "../ui/radio-group";
import {
  addressProblem,
  ALREADY_HERE,
  inviteStepAfterCheck,
  nameProblem,
  type InviteStep,
} from "../zerops/projects/projectInvite.logic";
import { TEAM_ROLE_WORDS } from "./teamSettings.logic";

/** What the invitation gives: a role, and for a developer or a guest, projects at one level. */
export interface TeamInviteChoice {
  readonly role: TeamRole;
  /** The Mate projects (HQ groups) chosen. */
  readonly groups: ReadonlyArray<string>;
  readonly level: AppAccessLevel;
}

export interface TeamInviteActions {
  /** Asks Zerops who the address is; rejects with what to tell the person. */
  readonly check: (email: string) => Promise<InviteeCheck>;
  /** Whether the team shows this membership now. */
  readonly shownHere: (clientUserId: string) => boolean;
  /** Sends the invitation; rejects with what to tell the person. */
  readonly send: (email: string, invitee: Invitee, choice: TeamInviteChoice) => Promise<void>;
}

const FIRST_STEP: InviteStep = { step: "address" };

const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Zerops didn't take the invitation.";

/** The two levels on the chosen projects; whether they may start projects is their role's. */
const LEVELS: ReadonlyArray<{
  readonly level: AppAccessLevel;
  readonly label: string;
  readonly hint: string;
}> = [
  {
    level: "work",
    label: "Can work on it",
    hint: "Deploys and works on them wherever they run, and sees their Mates.",
  },
  { level: "look", label: "Can only look", hint: "Sees everything, changes nothing." },
];

/** Whether a role is given projects one by one: a developer's or a guest's. */
const byProject = (role: TeamRole) => role === "developer" || role === "guest";

export function TeamInviteForm({
  organizationName,
  roles,
  projects,
  actions,
  onDone,
  onCancel,
  initial = FIRST_STEP,
  initialError = null,
  initialChoice,
}: {
  readonly organizationName: string;
  /** The roles the viewer may give, in the order offered. */
  readonly roles: ReadonlyArray<TeamRole>;
  /** The organization's Mate projects, to give a developer or a guest. */
  readonly projects: ReadonlyArray<{ readonly groupId: string; readonly name: string }>;
  readonly actions: TeamInviteActions;
  readonly onDone: () => void;
  readonly onCancel: () => void;
  /** Where the form starts; a harness shows each step. */
  readonly initial?: InviteStep;
  readonly initialError?: string | null;
  readonly initialChoice?: Partial<TeamInviteChoice>;
}) {
  const id = useId();
  const [step, setStep] = useState<InviteStep>(initial);
  const [email, setEmail] = useState(initial.step === "address" ? "" : initial.email);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [role, setRole] = useState<TeamRole>(
    initialChoice?.role ?? (roles.includes("developer") ? "developer" : (roles[0] ?? "guest")),
  );
  const [groups, setGroups] = useState<ReadonlyArray<string>>(initialChoice?.groups ?? []);
  const [level, setLevel] = useState<AppAccessLevel>(initialChoice?.level ?? "work");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [submitted, setSubmitted] = useState(false);

  const problem =
    step.step === "address"
      ? addressProblem(email)
      : step.step === "name"
        ? nameProblem(first, last)
        : null;

  const press = (run: () => Promise<void>) => {
    setPending(true);
    setError(null);
    run()
      .catch((cause: unknown) => setError(messageOf(cause)))
      .finally(() => setPending(false));
  };

  const submit = () => {
    if (pending) return;
    setSubmitted(true);
    if (problem !== null) return;
    switch (step.step) {
      case "address": {
        const address = email.trim();
        return press(async () => {
          const next = inviteStepAfterCheck(
            address,
            await actions.check(address),
            actions.shownHere,
          );
          if ("refused" in next) throw new Error(next.refused);
          setSubmitted(false);
          setStep(next);
        });
      }
      case "name":
        setSubmitted(false);
        return setStep({
          step: "access",
          email: step.email,
          invitee: { kind: "new", firstName: first.trim(), lastName: last.trim() },
        });
      case "access": {
        const { invitee } = step;
        return press(async () => {
          // Someone on the team already is changed in the list, never invited again.
          if (invitee.kind === "member") throw new Error(ALREADY_HERE);
          await actions.send(step.email, invitee, {
            role,
            groups: byProject(role) ? groups : [],
            level,
          });
          onDone();
        });
      }
    }
  };

  return (
    <form
      className="flex min-h-0 flex-col"
      data-zerops-surface="team-invite-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>Invite someone to {organizationName}</DialogTitle>
        <DialogDescription>
          {step.step === "address"
            ? "Zerops e-mails them a link to join."
            : step.step === "name"
              ? `${step.email} has no Zerops account yet. Zerops makes one with the invitation.`
              : `What may ${step.email} do here?`}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        {step.step === "address" ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-email`}>E-mail</Label>
            <Input
              aria-invalid={submitted && problem !== null ? true : undefined}
              autoComplete="off"
              autoFocus
              id={`${id}-email`}
              onChange={(event) => setEmail(event.target.value)}
              readOnly={pending}
              type="email"
              value={email}
            />
          </div>
        ) : step.step === "name" ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-first`}>First name</Label>
              <Input
                aria-invalid={submitted && first.trim() === "" ? true : undefined}
                autoFocus
                id={`${id}-first`}
                onChange={(event) => setFirst(event.target.value)}
                value={first}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-last`}>Last name</Label>
              <Input
                aria-invalid={submitted && last.trim() === "" ? true : undefined}
                id={`${id}-last`}
                onChange={(event) => setLast(event.target.value)}
                value={last}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <RadioGroup
              aria-label="Their role"
              disabled={pending}
              onValueChange={(value) => setRole(value as TeamRole)}
              value={role}
            >
              {roles.map((option) => (
                <label className="flex cursor-pointer items-start gap-3" key={option}>
                  <span className="flex h-5 items-center">
                    <Radio value={option} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">
                      {TEAM_ROLE_WORDS[option].label}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {TEAM_ROLE_WORDS[option].hint}
                    </span>
                  </span>
                </label>
              ))}
            </RadioGroup>
            {byProject(role) && projects.length > 0 ? (
              <fieldset className="space-y-2" disabled={pending}>
                <legend className="mb-2 text-sm font-medium text-foreground">
                  Projects <span className="font-normal text-muted-foreground">· optional</span>
                </legend>
                <div className="max-h-44 space-y-2 overflow-y-auto">
                  {projects.map((project) => (
                    <label
                      className="flex cursor-pointer items-center gap-3 text-sm"
                      key={project.groupId}
                    >
                      <Checkbox
                        checked={groups.includes(project.groupId)}
                        onCheckedChange={(checked) =>
                          setGroups((held) =>
                            checked
                              ? [...held, project.groupId]
                              : held.filter((one) => one !== project.groupId),
                          )
                        }
                      />
                      <span className="min-w-0 truncate">{project.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            {byProject(role) && groups.length > 0 ? (
              <RadioGroup
                aria-label="What they may do on those projects"
                disabled={pending}
                onValueChange={(value) => setLevel(value as AppAccessLevel)}
                value={level}
              >
                {LEVELS.map((option) => (
                  <label className="flex cursor-pointer items-start gap-3" key={option.level}>
                    <span className="flex h-5 items-center">
                      <Radio value={option.level} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">
                        {option.label}
                      </span>
                      <span className="block text-sm text-muted-foreground">{option.hint}</span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            ) : null}
          </div>
        )}
        {submitted && problem !== null ? (
          <p className="mt-1.5 text-xs text-status-failed-text" role="alert">
            {problem}
          </p>
        ) : null}
      </DialogPanel>
      <DialogFooter>
        <p
          className="me-auto min-h-4 self-center text-line leading-4 text-status-failed-text"
          role="alert"
        >
          {error}
        </p>
        <Button onClick={onCancel} type="button" variant="ghost">
          Cancel
        </Button>
        <Button aria-busy={pending || undefined} disabled={pending} type="submit">
          {step.step === "access" ? "Send invite" : "Continue"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function TeamInviteDialog({
  open,
  onOpenChange,
  ...form
}: Omit<Parameters<typeof TeamInviteForm>[0], "onDone" | "onCancel"> & {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="max-w-md">
        <TeamInviteForm
          {...form}
          onCancel={() => onOpenChange(false)}
          onDone={() => onOpenChange(false)}
        />
      </DialogPopup>
    </Dialog>
  );
}
