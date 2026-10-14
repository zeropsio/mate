/**
 * Inviting someone to a project: their e-mail, checked with Zerops; their name where the address
 * has no Zerops account yet; then how much they may do, and *Send invite*. Each press waits for
 * Zerops's answer in the dialog and says a refusal there; the dialog closes once the invitation
 * landed and the project's people show it.
 */
import type { AppAccessLevel } from "@t3tools/client-runtime/zerops/appAccess";
import type { Invitee } from "@t3tools/client-runtime/data";
import { useId, useState } from "react";

import { Button } from "../../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../ui/dialog";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Radio, RadioGroup } from "../../ui/radio-group";
import {
  addressProblem,
  INVITE_LEVELS,
  inviteStepAfterCheck,
  nameProblem,
  type InviteStep,
} from "./projectInvite.logic";

export interface ProjectInviteActions {
  /** Asks Zerops who the address is; rejects with what to tell the person. */
  readonly check: (
    email: string,
  ) => Promise<{ readonly kind: "existing"; readonly userId: string } | { readonly kind: "new" }>;
  /** Sends the invitation; rejects with what to tell the person. */
  readonly send: (email: string, invitee: Invitee, level: AppAccessLevel) => Promise<void>;
}

const FIRST_STEP: InviteStep = { step: "address" };

const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Zerops didn't take the invitation.";

export function ProjectInviteForm({
  projectName,
  actions,
  onDone,
  onCancel,
  initial = FIRST_STEP,
  initialError = null,
}: {
  readonly projectName: string;
  readonly actions: ProjectInviteActions;
  readonly onDone: () => void;
  readonly onCancel: () => void;
  /** Where the form starts; a harness shows each step. */
  readonly initial?: InviteStep;
  readonly initialError?: string | null;
}) {
  const id = useId();
  const [step, setStep] = useState<InviteStep>(initial);
  const [email, setEmail] = useState(initial.step === "address" ? "" : initial.email);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [level, setLevel] = useState<AppAccessLevel>("work");
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
          const answer = await actions.check(address);
          setSubmitted(false);
          setStep(inviteStepAfterCheck(address, answer));
        });
      }
      case "name":
        setSubmitted(false);
        return setStep({
          step: "access",
          email: step.email,
          invitee: { kind: "new", firstName: first.trim(), lastName: last.trim() },
        });
      case "access":
        return press(async () => {
          await actions.send(step.email, step.invitee, level);
          onDone();
        });
    }
  };

  return (
    <form
      className="flex min-h-0 flex-col"
      data-zerops-surface="invite-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>Invite someone to {projectName}</DialogTitle>
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
          <RadioGroup
            aria-label="What they may do"
            disabled={pending}
            onValueChange={(value) => setLevel(value as AppAccessLevel)}
            value={level}
          >
            {INVITE_LEVELS.map((option) => (
              <label className="flex cursor-pointer items-start gap-3" key={option.level}>
                <span className="flex h-5 items-center">
                  <Radio value={option.level} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{option.label}</span>
                  <span className="block text-sm text-muted-foreground">{option.hint}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
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

export function ProjectInviteDialog({
  open,
  onOpenChange,
  ...form
}: Omit<Parameters<typeof ProjectInviteForm>[0], "onDone" | "onCancel"> & {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="max-w-md">
        <ProjectInviteForm
          {...form}
          onCancel={() => onOpenChange(false)}
          onDone={() => onOpenChange(false)}
        />
      </DialogPopup>
    </Dialog>
  );
}
