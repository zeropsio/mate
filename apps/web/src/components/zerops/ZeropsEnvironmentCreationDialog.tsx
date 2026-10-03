/**
 * Adding an environment to a group, as a short form.
 *
 * A Mate is somebody: its dialog asks who — a name, a colour, a shape — and
 * decides the rest (`ZeropsNewMateForm`). A stage or a production leaves
 * three things to the person: what the environment is called, whether it
 * runs an agent and what that agent is called, and what application goes in
 * — the group's published recipe, or nothing yet. Everything else follows
 * from the role.
 */
import type {
  EnvironmentRecipeChoice,
  ZeropsEnvironmentRole,
  ZeropsMateFace,
} from "@t3tools/client-runtime/zerops";
import type { TakenBotNames } from "@t3tools/client-runtime/zerops/projections";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { useId, useMemo, useRef, useState } from "react";

import { Button } from "../ui/button";
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
import { Switch } from "../ui/switch";
import { Skeleton } from "../ui/skeleton";
import { cn } from "~/lib/utils";
import { environmentRoleLabel } from "./ZeropsGroupTree.logic";
import {
  hasCreationErrors,
  recipeOptions,
  validateCreationForm,
  type CreationFormErrors,
  type NewMateDoorAction,
  type NewMateDoorClosed,
  type PressStepView,
} from "./ZeropsEnvironmentCreationDialog.logic";
import { ProcessSteps, type ProcessStep } from "./primitives";
import { ZeropsNewMateForm } from "./ZeropsNewMateForm";

export interface EnvironmentCreationChoice {
  readonly name: string;
  readonly withAgent: boolean;
  /** Present when `withAgent`. */
  readonly botName?: string;
  readonly recipe: EnvironmentRecipeChoice;
  /** The face its person picked: present for a Mate. */
  readonly face?: ZeropsMateFace;
}

export interface ZeropsEnvironmentCreationFormProps {
  readonly groupName: string;
  readonly role: ZeropsEnvironmentRole;
  readonly defaultName: string;
  readonly defaultBotName: string;
  /** Another name free on the account, for a Mate's die (`ZeropsNewMateForm`). */
  readonly proposeAnotherName?: ((current: string) => string) | undefined;
  /**
   * What the project calls an environment whose agent goes by `botName`: a
   * Mate after its bot, so renaming Fen to Ada renames "Todo - Fen" to
   * "Todo - Ada"; a stage or a production after its role.
   */
  readonly proposeName: (botName: string) => string;
  readonly defaultWithAgent: boolean;
  /** The account's Mates' names, and whether the listing read them all (`takenBotNames`). */
  readonly takenBotNames: TakenBotNames;
  /** The tier read from the group repo's `main`, when one is merged. */
  readonly tier: Extract<EnvironmentRecipeChoice, { kind: "tier" }> | undefined;
  /** The services that tier declares, for the line under the option. */
  readonly tierServices: ReadonlyArray<string>;
  /** True while the group repo is still being read. */
  readonly tierLoading: boolean;
  /** The tint the account gives a new Mate of this name (`newMateTint`). */
  readonly defaultTintFor: (name: string) => MateTintId;
  /** The shape a name was asked with before (an Add started over); its tint's where none. */
  readonly defaultShapeFor?: ((name: string) => MateShapeId | undefined) | undefined;
  /** Why the project takes no Mate now, in the Mate's form's place (`newMateDoor`). */
  readonly closed?: NewMateDoorClosed | undefined;
  /** The one thing to do while the project takes no Mate, pressed. */
  readonly onDoorAction?: ((action: NewMateDoorAction) => void) | undefined;
  readonly onCancel: () => void;
  readonly onCreate: (choice: EnvironmentCreationChoice) => void;
}

const PRESS_STEP_STATES: Readonly<
  Record<PressStepView["state"], { readonly state: ProcessStep["state"]; readonly label: string }>
> = {
  waiting: { state: "queued", label: "Waiting" },
  active: { state: "running", label: "In progress" },
  done: { state: "done", label: "Done" },
  failed: { state: "failed", label: "Failed" },
};

/** A press's steps, as *Finish setup* on a Mate's view draws them. */
export function PressSteps({
  name,
  steps,
}: {
  readonly name: string;
  readonly steps: ReadonlyArray<PressStepView>;
}) {
  return (
    <ProcessSteps
      aria-label={`Setting up ${name}`}
      steps={steps.map((step) => ({
        id: step.label,
        label: step.label,
        state: PRESS_STEP_STATES[step.state].state,
        stateLabel: PRESS_STEP_STATES[step.state].label,
      }))}
    />
  );
}

/** The form on its own, so it can be rendered and read without a portal. */
export function ZeropsEnvironmentCreationForm(props: ZeropsEnvironmentCreationFormProps) {
  return <CreationForm {...props} />;
}

function CreationForm(props: ZeropsEnvironmentCreationFormProps) {
  if (props.role !== "dev") return <EnvironmentForm {...props} />;
  const { groupName, defaultBotName, proposeName, takenBotNames, tier, tierLoading } = props;
  const { defaultTintFor, defaultShapeFor, closed, onDoorAction, onCancel, onCreate } = props;
  return (
    <ZeropsNewMateForm
      closed={closed}
      defaultBotName={defaultBotName}
      defaultShapeFor={defaultShapeFor}
      defaultTintFor={defaultTintFor}
      groupName={groupName}
      onCancel={onCancel}
      onDoorAction={onDoorAction}
      onCreate={({ name, botName, recipe, face }) => {
        onCreate({ name, withAgent: true, botName, recipe, face });
      }}
      proposeAnotherName={props.proposeAnotherName}
      proposeName={proposeName}
      takenBotNames={takenBotNames}
      tier={tier}
      tierLoading={tierLoading}
    />
  );
}

/** A stage's or a production's form: its name, its agent, its application. */
function EnvironmentForm({
  groupName,
  role,
  defaultName,
  defaultBotName,
  proposeName,
  defaultWithAgent,
  takenBotNames,
  tier,
  tierServices,
  tierLoading,
  onCancel,
  onCreate,
}: ZeropsEnvironmentCreationFormProps) {
  const id = useId();
  const what = environmentWord(role);
  const options = useMemo(
    () => recipeOptions({ roleLabel: what, tier, services: tierServices }),
    [what, tier, tierServices],
  );
  const [name, setName] = useState(defaultName);
  const [nameTouched, setNameTouched] = useState(false);
  const [withAgent, setWithAgent] = useState(defaultWithAgent);
  const [botName, setBotName] = useState(defaultBotName);
  // The best option on offer is the default, and it improves the moment the
  // group repo answers; a choice the person made sticks.
  const [chosenRecipeId, setChosenRecipeId] = useState<string | null>(null);
  const recipeId = chosenRecipeId ?? options[0]?.id ?? "none";
  const [submitted, setSubmitted] = useState(false);

  const errors: CreationFormErrors = validateCreationForm(
    { name, withAgent, botName, recipeId },
    { takenBotNames, options },
  );
  const showErrors = submitted;

  return (
    <form
      className="flex min-h-0 flex-col"
      data-zerops-surface="environment-creation-form"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (hasCreationErrors(errors)) return;
        const option = options.find((entry) => entry.id === recipeId);
        if (option === undefined) return;
        onCreate({
          name: name.trim(),
          withAgent,
          ...(withAgent ? { botName: botName.replace(/\s+/g, " ").trim() } : {}),
          recipe: option.choice,
        });
      }}
    >
      <DialogHeader>
        {/* The title names the thing, the button names what happens to it.
            Carrying one string in both said nothing twice. */}
        <DialogTitle>{`New ${what} environment`}</DialogTitle>
        <DialogDescription>
          A new Zerops project in {groupName}. It takes a couple of minutes to come up.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="flex flex-col gap-5 space-y-0">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-name`}>Environment</Label>
          <Input
            aria-invalid={showErrors && errors.name !== undefined ? true : undefined}
            id={`${id}-name`}
            onChange={(event) => {
              setName(event.target.value);
              setNameTouched(true);
            }}
            value={name}
          />
          {showErrors && errors.name !== undefined ? <FieldError>{errors.name}</FieldError> : null}
        </div>

        <div className="space-y-3">
          <label
            className="flex items-center justify-between gap-3 text-sm"
            htmlFor={`${id}-agent`}
          >
            <span className="flex flex-col gap-0.5">
              <span>Runs an agent</span>
              <span className="text-xs text-muted-foreground">{agentSwitchNote(role)}</span>
            </span>
            <Switch
              checked={withAgent}
              id={`${id}-agent`}
              onCheckedChange={(checked) => {
                setWithAgent(checked);
              }}
            />
          </label>
          {withAgent ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-bot`}>Agent's name</Label>
              <Input
                aria-invalid={showErrors && errors.botName !== undefined ? true : undefined}
                id={`${id}-bot`}
                onChange={(event) => {
                  setBotName(event.target.value);
                  if (!nameTouched) {
                    setName(proposeName(event.target.value.replace(/\s+/g, " ").trim()));
                  }
                }}
                value={botName}
              />
              {showErrors && errors.botName !== undefined ? (
                <FieldError>{errors.botName}</FieldError>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <span className="text-sm">Application</span>
          <RadioGroup
            aria-label="Application"
            className="gap-2"
            onValueChange={(value) => {
              setChosenRecipeId(String(value));
            }}
            value={recipeId}
          >
            {options.map((option) => (
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-[var(--zerops-card-radius)] border border-border/55 px-3 py-2.5 text-sm transition-colors",
                  option.id === recipeId ? "border-primary/40 bg-primary/5" : "hover:bg-accent/50",
                )}
                key={option.id}
              >
                <Radio className="mt-0.5" value={option.id} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span>{option.label}</span>
                  <span className="text-xs text-muted-foreground">{option.detail}</span>
                </span>
              </label>
            ))}
            {tierLoading ? (
              <div
                aria-label="Reading the project's recipe"
                className="flex items-center gap-3 px-3 py-2.5"
                role="status"
              >
                <Skeleton shape="pill" className="size-4" />
                <Skeleton className="h-3.5 w-48" />
              </div>
            ) : null}
          </RadioGroup>
          {showErrors && errors.recipe !== undefined ? (
            <FieldError>{errors.recipe}</FieldError>
          ) : null}
        </div>
      </DialogPanel>

      <DialogFooter>
        <Button onClick={onCancel} type="button" variant="ghost">
          Cancel
        </Button>
        <Button type="submit">
          Add {what} to {groupName}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** What the dialog calls the environment it adds: its role. A Mate has a form of its own. */
function environmentWord(role: ZeropsEnvironmentRole): string {
  return (environmentRoleLabel(role) ?? role).toLowerCase();
}

/**
 * Why this default, in the role's own terms. Production argues for its own
 * "off"; a stage was left with the generic line and so argued for nothing,
 * even though its default is "on".
 */
function agentSwitchNote(role: ZeropsEnvironmentRole): string {
  if (role === "prod") {
    return "Production usually does not: an agent with a shell in production is a separate decision.";
  }
  if (role === "stage") {
    return "A stage is usually a deploy target, so this is only worth it if someone will work here.";
  }
  return "A Zerops Mate container with a coding agent you can talk to.";
}

function FieldError({ children }: { readonly children: string }) {
  return (
    <p className="text-xs text-[var(--zerops-status-failed-text)]" role="alert">
      {children}
    </p>
  );
}

export function ZeropsEnvironmentCreationDialog({
  open,
  onOpenChange,
  ...form
}: ZeropsEnvironmentCreationFormProps & {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  // Add closes it onto the new Mate's page, which takes the focus: never back to what opened it,
  // where a second Enter would open it again over that page.
  const added = useRef(false);
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="max-w-lg" finalFocus={() => !added.current}>
        <ZeropsEnvironmentCreationForm
          {...form}
          onCreate={(choice) => {
            if (choice.withAgent) added.current = true;
            form.onCreate(choice);
          }}
        />
      </DialogPopup>
    </Dialog>
  );
}
