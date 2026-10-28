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
import { useId, useMemo, useRef, useState, type ReactNode } from "react";
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
  environmentSheetSubmit,
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
import type { DraftPeople } from "./projects/accessDraft.logic";

export interface EnvironmentCreationChoice {
  /** A Mate's own name, which its project's is built from; a stage's or a production's whole project name. */
  readonly name: string;
  readonly withAgent: boolean;
  readonly recipe: EnvironmentRecipeChoice;
  /** The face its person picked: present for a Mate. */
  readonly face?: ZeropsMateFace;
  /** Who reaches its project beyond their organization role, as chosen in the form. */
  readonly userRoles?: ReadonlyArray<ProjectGrant>;
  /** A Mate made automated (*Add automated Mates*): it takes tasks on the organization's key. */
  readonly automated?: true;
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
  /**
   * The project's people, which the one sheet gives the new environment at their level there
   * without asking (`useDraftPeople`); absent, it sends none.
   */
  readonly people?: DraftPeople | undefined;
  /** Opens the change that adds the project's setup files, where one waits to be merged. */
  readonly onSetupChange?: (() => void) | undefined;
  /** The line forecasting the credit wall before Create (`ZeropsCreditForecast`); absent, none. */
  readonly forecast?: ReactNode;
  /** Storage and notices for this project's attached repositories when adding a Mate. */
  readonly repositories?: ReactNode;
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
      forecast={props.forecast}
      repositories={props.repositories}
      proposeAnotherName={props.proposeAnotherName}
      takenBotNames={takenBotNames}
      tier={tier}
      tierLoading={recipe === "reading"}
    />
  );
}

/**
 * A stage or a production, as one sheet: what it is for in one line, where it goes, one button —
 * asking nothing the project already says: its name after the project, its recipe, no agent. Its
 * own form (the name, an agent, the application) and a branch of the person's Git repository are
 * the sheet's quiet ways out (the owner delegated the call on 2026-10-15: adding an environment is
 * one sheet, like putting it live).
 */
function EnvironmentDestinationForm(props: ZeropsEnvironmentCreationFormProps) {
  const [view, setView] = useState<"sheet" | "form" | "git">("sheet");
  if (view === "git" && props.git !== undefined)
    return (
      <GitEnvironmentForm
        {...props.git}
        groupName={props.groupName}
        defaultName={props.defaultName}
        tier={props.role === "prod" ? "production" : "stage"}
        onBack={() => setView("sheet")}
        onCancel={props.onCancel}
      />
    );
  if (view === "form") return <EnvironmentForm {...props} onBack={() => setView("sheet")} />;
  return (
    <EnvironmentSheet {...props} onGit={() => setView("git")} onYourself={() => setView("form")} />
  );
}

/** The sheet's quiet ways out: blue words, their text on the words' edge. */
/** A quiet way out of the sheet: a link Button, its text on the words' edge. */
const SHEET_LINK = "-ms-2 self-start";

function EnvironmentSheet(
  props: ZeropsEnvironmentCreationFormProps & {
    readonly onYourself: () => void;
    readonly onGit: () => void;
  },
) {
  const { groupName, role, defaultName, tier, tierServices, recipe } = props;
  const what = environmentWord(role);
  const options = recipeOptions({ roleLabel: what, tier, services: tierServices, recipe });
  const submit = environmentSheetSubmit({
    name: defaultName,
    withAgent: props.defaultWithAgent,
    options,
    recipe,
    people: props.people,
  });
  const held = submit.kind === "held" ? submit.reason : undefined;
  const gitOffered = props.git?.offered.add === true;
  return (
    <form
      className="flex min-h-0 flex-col"
      data-zerops-surface="environment-destination-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (submit.kind === "create") props.onCreate(submit.choice);
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {role === "prod" ? `Set up production for ${groupName}` : `Add a stage to ${groupName}`}
        </DialogTitle>
        <DialogDescription>
          {role === "prod"
            ? "Where your releases go live."
            : "A place to try merged changes before they go live."}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-6">
          <section aria-label="Where" className="flex flex-col gap-1">
            <h3 className="text-muted-foreground text-xs">Where</h3>
            <p className="font-medium text-foreground text-sm">{defaultName}</p>
            <p className="text-muted-foreground text-sm">
              {/* The person's project is the application: this is a copy of it, never a second
                  project (the run's owner read "a new Zerops project" as another in the menu). */}
              A separate copy of {groupName} with its own address, ready in a few minutes.
            </p>
          </section>
          <div className="flex flex-col gap-1">
            <Button className={SHEET_LINK} onClick={props.onYourself} size="sm" variant="link">
              Change its name or services…
            </Button>
            {props.git === undefined ? null : (
              <>
                <Button
                  className={SHEET_LINK}
                  disabled={!gitOffered}
                  onClick={props.onGit}
                  size="sm"
                  variant="link"
                >
                  Use a branch in your Git repository instead…
                </Button>
                {gitOffered ? null : (
                  <p className="text-muted-foreground text-xs">
                    {props.git.unavailableReason ?? "HQ has not said yet."}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </DialogPanel>
      <DialogFooter>
        {held === undefined ? null : (
          <div className="me-auto flex flex-col items-start self-center" role="status">
            <p className="text-muted-foreground text-sm">{held}</p>
            {submit.kind === "held" &&
            submit.action === "setup-change" &&
            props.onSetupChange !== undefined ? (
              <Button className={SHEET_LINK} onClick={props.onSetupChange} size="sm" variant="link">
                Review the setup change
              </Button>
            ) : null}
          </div>
        )}
        <Button disabled={held !== undefined} type="submit">
          {role === "prod" ? "Set up production" : "Add stage"}
        </Button>
      </DialogFooter>
    </form>
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
  forecast,
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
          A separate copy of {groupName}. It takes a few minutes to come up.
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
              <span>Has its own Mate</span>
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
          <span className="text-sm">Starts with</span>
          <RadioGroup
            aria-label="Starts with"
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
                    variant="secondary"
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

        {access === undefined ? null : access(setUserRoles)}
        {forecast}
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
    return "Production usually does not: a Mate with a shell in production is a separate decision.";
  }
  if (role === "stage") {
    return "Only if someone will build directly in stage.";
  }
  return "A Mate you can talk to, with a workspace of its own.";
}

export function FieldError({ children }: { readonly children: string }) {
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
        // Refused, the footer's Close is its one way out: never a second one in its corner.
        showCloseButton={form.closed === undefined}
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
