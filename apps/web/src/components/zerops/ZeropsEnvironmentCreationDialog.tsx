/**
 * Adding an environment to a group, as a short form.
 *
 * A Mate is somebody: its dialog asks who — a name, a colour, a shape — and
 * decides the rest (`ZeropsNewMateForm`), its project named in full after its application. A
 * stage or a production in Zerops leaves three things to the person: what the
 * environment is called — the one name its project has, an agent in it going
 * by it too — whether it runs an agent, and what application goes in — the
 * group's published recipe, or nothing yet. Everything else follows from the
 * role.
 */
import type {
  EnvironmentRecipeChoice,
  ZeropsEnvironmentRole,
  ZeropsMateFace,
} from "@t3tools/client-runtime/zerops";
import type { ProjectGrant } from "@t3tools/client-runtime/zerops/projectAccess";
import type { TakenBotNames } from "@t3tools/client-runtime/zerops/projections";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { useId, useMemo, useRef, useState } from "react";
import { GitEnvironmentForm, type GitEnvironmentFormProps } from "./GitEnvironmentForm";

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
import { cn } from "~/lib/utils";
import { environmentRoleLabel } from "./ZeropsGroupTree.logic";
import {
  creationRecipeHold,
  hasCreationErrors,
  recipeOptions,
  validateCreationForm,
  type CreationFormErrors,
  type CreationRecipe,
  type NewMateDoorAction,
  type NewMateDoorClosed,
  type PressStepView,
} from "./ZeropsEnvironmentCreationDialog.logic";
import { ProcessSteps, type ProcessStep } from "./primitives";
import { ZeropsNewMateForm } from "./ZeropsNewMateForm";
import type { ProjectAccessSlot } from "./projects/ProjectAccessChips";

export interface EnvironmentCreationChoice {
  /** A Mate's own name, which its project's is built from; a stage's or a production's whole project name. */
  readonly name: string;
  readonly withAgent: boolean;
  readonly recipe: EnvironmentRecipeChoice;
  /** The face its person picked: present for a Mate. */
  readonly face?: ZeropsMateFace;
  /** Who reaches its project beyond their organization role, as chosen in the form. */
  readonly userRoles?: ReadonlyArray<ProjectGrant>;
}

export interface ZeropsEnvironmentCreationFormProps {
  readonly groupName: string;
  readonly role: ZeropsEnvironmentRole;
  /**
   * The name the form starts with: a Mate's own, or a stage's or a
   * production's suggested after its project and role (`proposedEnvironmentName`).
   */
  readonly defaultName: string;
  /** Another name free on the account, for a Mate's die (`ZeropsNewMateForm`). */
  readonly proposeAnotherName?: ((current: string) => string) | undefined;
  readonly defaultWithAgent: boolean;
  /** The account's Mates' names, and whether the listing read them all (`takenBotNames`). */
  readonly takenBotNames: TakenBotNames;
  /** The tier read from the group repo's `main`, when one is merged. */
  readonly tier: Extract<EnvironmentRecipeChoice, { kind: "tier" }> | undefined;
  /** The services that tier declares, for the line under the option. */
  readonly tierServices: ReadonlyArray<string>;
  /**
   * Where the project's recipe stands (`creationRecipe`): being read, or what HQ answered — a
   * recipe, none on `main`, or a read that failed. Only "none" says there is no recipe.
   */
  readonly recipe: CreationRecipe;
  /** A recipe that could not be read is being read again (`useZeropsGroupRecipe`). */
  readonly recipeRereading?: boolean | undefined;
  /** Reads a recipe that could not be read again: *Try again*. */
  readonly onRecipeRetry?: (() => void) | undefined;
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
  /** Who will reach the new project, as people chips; absent, the form says nothing of access. */
  readonly access?: ProjectAccessSlot | undefined;
  readonly git?:
    | Omit<GitEnvironmentFormProps, "groupName" | "tier" | "defaultName" | "onCancel" | "onBack">
    | undefined;
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
  if (props.role !== "dev") return <EnvironmentDestinationForm {...props} />;
  const { groupName, defaultName, takenBotNames, tier, recipe } = props;
  const { defaultTintFor, defaultShapeFor, closed, onDoorAction, onCancel, onCreate } = props;
  return (
    <ZeropsNewMateForm
      closed={closed}
      defaultBotName={defaultName}
      defaultShapeFor={defaultShapeFor}
      defaultTintFor={defaultTintFor}
      groupName={groupName}
      onCancel={onCancel}
      onDoorAction={onDoorAction}
      onCreate={({ name, recipe, face, userRoles }) => {
        onCreate({
          name,
          withAgent: true,
          recipe,
          face,
          ...(userRoles === undefined ? {} : { userRoles }),
        });
      }}
      access={props.access}
      proposeAnotherName={props.proposeAnotherName}
      takenBotNames={takenBotNames}
      tier={tier}
      tierLoading={recipe === "reading"}
    />
  );
}

function EnvironmentDestinationForm(props: ZeropsEnvironmentCreationFormProps) {
  const [target, setTarget] = useState("zerops");
  const [continued, setContinued] = useState(false);
  if (!continued) {
    return (
      <form
        className="flex min-h-0 flex-col"
        data-zerops-surface="environment-destination-form"
        onSubmit={(event) => {
          event.preventDefault();
          setContinued(true);
        }}
      >
        <DialogHeader>
          <DialogTitle>
            New {props.role === "prod" ? "production" : "stage"} environment
          </DialogTitle>
          <DialogDescription>
            {props.role === "prod"
              ? "Production is where a release goes"
              : "Stage is where merged changes go"}
            : a Zerops project Mate deploys, or a branch in your repository, where whatever you have
            set up there takes over.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-2">
            <span className="text-sm">Where does it go?</span>
            <RadioGroup aria-label="Where does it go?" value={target} onValueChange={setTarget}>
              <label className="flex items-start gap-3 rounded-lg border p-4 text-sm">
                <Radio value="zerops" />
                <span className="space-y-1">
                  <span className="block font-medium">A Zerops project</span>
                  <span className="block text-muted-foreground">
                    A new Zerops project in {props.groupName}. It takes a couple of minutes to come
                    up.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-lg border p-4 text-sm">
                <Radio value="git" disabled={props.git?.offered.add !== true} />
                <span className="space-y-1">
                  <span className="block font-medium">A branch in your Git repository</span>
                  <span className="block text-muted-foreground">
                    {props.git?.offered.add === true
                      ? "Mate pushes there. What that repository does with a push is up to how it is set up."
                      : (props.git?.unavailableReason ?? "HQ has not said yet.")}
                  </span>
                </span>
              </label>
            </RadioGroup>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" type="button" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={target === "git" && props.git?.offered.add !== true}>
            Continue
          </Button>
        </DialogFooter>
      </form>
    );
  }
  return target === "git" && props.git !== undefined ? (
    <GitEnvironmentForm
      {...props.git}
      groupName={props.groupName}
      defaultName={props.defaultName}
      tier={props.role === "prod" ? "production" : "stage"}
      onBack={() => setContinued(false)}
      onCancel={props.onCancel}
    />
  ) : (
    <EnvironmentForm {...props} onBack={() => setContinued(false)} />
  );
}

/** A stage's or a production's form: its name, its agent, its application. */
function EnvironmentForm({
  groupName,
  role,
  defaultName,
  defaultWithAgent,
  tier,
  tierServices,
  recipe,
  recipeRereading,
  onRecipeRetry,
  onCancel,
  onCreate,
  onBack,
  access,
}: ZeropsEnvironmentCreationFormProps & { readonly onBack?: (() => void) | undefined }) {
  const id = useId();
  const [userRoles, setUserRoles] = useState<ReadonlyArray<ProjectGrant>>([]);
  const what = environmentWord(role);
  const options = useMemo(
    () => recipeOptions({ roleLabel: what, tier, services: tierServices, recipe }),
    [what, tier, tierServices, recipe],
  );
  // A recipe being read, or one that could not be read, holds Add: what is created comes from it.
  const held = creationRecipeHold(recipe);
  const [name, setName] = useState(defaultName);
  const [withAgent, setWithAgent] = useState(defaultWithAgent);
  // The best option on offer is the default, and it improves the moment the
  // group repo answers; a choice the person made sticks.
  const [chosenRecipeId, setChosenRecipeId] = useState<string | null>(null);
  const recipeId = chosenRecipeId ?? options[0]?.id ?? "none";
  const [submitted, setSubmitted] = useState(false);

  const errors: CreationFormErrors = validateCreationForm(
    { name, withAgent, recipeId },
    { options, recipe },
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
          recipe: option.choice,
          ...(userRoles.length === 0 ? {} : { userRoles }),
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
            {held === undefined ? null : (
              <div className="flex items-center justify-between gap-3 px-3 py-2.5" role="status">
                <span className="text-xs text-muted-foreground">{held}</span>
                {recipe === "unreadable" && onRecipeRetry !== undefined ? (
                  <Button
                    aria-busy={recipeRereading === true || undefined}
                    disabled={recipeRereading === true}
                    onClick={onRecipeRetry}
                    type="button"
                    variant="outline"
                  >
                    Try again
                  </Button>
                ) : null}
              </div>
            )}
          </RadioGroup>
          {showErrors && held === undefined && errors.recipe !== undefined ? (
            <FieldError>{errors.recipe}</FieldError>
          ) : null}
        </div>

        {access === undefined ? null : (
          <div className="space-y-2">
            <span className="text-sm">Project access</span>
            {access(setUserRoles)}
          </div>
        )}
      </DialogPanel>

      <DialogFooter>
        <Button onClick={onBack ?? onCancel} type="button" variant="ghost">
          {onBack === undefined ? "Cancel" : "Back"}
        </Button>
        <Button disabled={held !== undefined} type="submit">
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
  landsElsewhere = false,
  fallbackFocus,
  ...form
}: ZeropsEnvironmentCreationFormProps & {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /**
   * Add closes it onto another page, which takes the focus (Add a Mate, onto the new Mate's):
   * never back to what opened it, where a second Enter would open it again over that page. Any
   * other caller keeps the person where they were, the focus back where it came from.
   */
  readonly landsElsewhere?: boolean;
  /** A surviving control for the same project when navigation removed the opener. */
  readonly fallbackFocus?: (() => HTMLElement | null) | undefined;
}) {
  const added = useRef(false);
  const opener = useRef(typeof document === "undefined" ? null : document.activeElement);
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup
        className="max-w-lg"
        finalFocus={() => {
          if (added.current) return false;
          if (opener.current?.isConnected && opener.current !== document.body) return true;
          const fallback = fallbackFocus?.();
          fallback?.scrollIntoView({ block: "nearest", inline: "nearest" });
          return fallback ?? true;
        }}
      >
        <ZeropsEnvironmentCreationForm
          {...form}
          onCreate={(choice) => {
            if (landsElsewhere) added.current = true;
            form.onCreate(choice);
          }}
        />
      </DialogPopup>
    </Dialog>
  );
}
