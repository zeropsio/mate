/**
 * Adding an environment to a group, as a short form.
 *
 * Three things are the person's to decide and nothing else: what the
 * environment is called, whether it runs an agent and what that agent is
 * called, and what application goes in — the group's published recipe, a
 * clone of a sibling, or nothing yet. Everything else follows from the role.
 */
import type {
  EnvironmentRecipeChoice,
  ZeropsEnvironmentRole,
} from "@t3tools/client-runtime/zerops";
import { useId, useMemo, useState } from "react";

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
} from "./ZeropsEnvironmentCreationDialog.logic";

export interface EnvironmentCreationChoice {
  readonly name: string;
  readonly withAgent: boolean;
  /** Present when `withAgent`. */
  readonly botName?: string;
  readonly recipe: EnvironmentRecipeChoice;
}

export interface ZeropsEnvironmentCreationFormProps {
  readonly groupName: string;
  readonly role: ZeropsEnvironmentRole;
  readonly defaultName: string;
  readonly defaultBotName: string;
  /**
   * The name to propose for a bot's name, while the person has not named the
   * environment by hand: a Mate is named after its bot, so renaming Fen to
   * Ada renames "Todo - Fen" to "Todo - Ada" until the name field is touched.
   */
  readonly proposeName?: ((botName: string) => string) | undefined;
  readonly defaultWithAgent: boolean;
  readonly takenBotNames: ReadonlyArray<string>;
  /** The tier read from the group repo's `main`, when one is merged. */
  readonly tier: Extract<EnvironmentRecipeChoice, { kind: "tier" }> | undefined;
  /** The services that tier declares, for the line under the option. */
  readonly tierServices: ReadonlyArray<string>;
  /** True while the group repo is still being read. */
  readonly tierLoading: boolean;
  readonly onCancel: () => void;
  readonly onCreate: (choice: EnvironmentCreationChoice) => void;
}

/** The form on its own, so it can be rendered and read without a portal. */
export function ZeropsEnvironmentCreationForm({
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
  const roleLabel = environmentRoleLabel(role) ?? role;
  const options = useMemo(
    () => recipeOptions({ roleLabel, tier, services: tierServices }),
    [roleLabel, tier, tierServices],
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
      className="flex flex-col gap-5"
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
        <label className="flex items-center justify-between gap-3 text-sm" htmlFor={`${id}-agent`}>
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
                if (!nameTouched && proposeName !== undefined) {
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
              <Skeleton className="size-4 rounded-full" />
              <Skeleton className="h-3.5 w-48" />
            </div>
          ) : null}
        </RadioGroup>
        {showErrors && errors.recipe !== undefined ? (
          <FieldError>{errors.recipe}</FieldError>
        ) : null}
      </div>

      <DialogFooter className="px-0 pb-0">
        <Button onClick={onCancel} type="button" variant="ghost">
          Cancel
        </Button>
        <Button type="submit">
          Add {roleLabel.toLowerCase()} to {groupName}
        </Button>
      </DialogFooter>
    </form>
  );
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
  const roleLabel = environmentRoleLabel(form.role) ?? form.role;
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          {/* The title names the thing, the button names what happens to it.
              Carrying one string in both said nothing twice. */}
          <DialogTitle>New {roleLabel.toLowerCase()} environment</DialogTitle>
          <DialogDescription>
            A new Zerops project in {form.groupName}. It takes a couple of minutes to come up.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <ZeropsEnvironmentCreationForm {...form} />
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
