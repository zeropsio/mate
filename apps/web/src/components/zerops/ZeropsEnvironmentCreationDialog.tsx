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
  type CloneSourceSummary,
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
  readonly defaultWithAgent: boolean;
  readonly takenBotNames: ReadonlyArray<string>;
  readonly storeRecipeAvailable: boolean;
  readonly cloneSources: ReadonlyArray<CloneSourceSummary & { readonly yaml: string }>;
  readonly cloneSourcesLoading: boolean;
  readonly onCancel: () => void;
  readonly onCreate: (choice: EnvironmentCreationChoice) => void;
}

/** The form on its own, so it can be rendered and read without a portal. */
export function ZeropsEnvironmentCreationForm({
  groupName,
  role,
  defaultName,
  defaultBotName,
  defaultWithAgent,
  takenBotNames,
  storeRecipeAvailable,
  cloneSources,
  cloneSourcesLoading,
  onCancel,
  onCreate,
}: ZeropsEnvironmentCreationFormProps) {
  const id = useId();
  const roleLabel = environmentRoleLabel(role) ?? role;
  const options = useMemo(
    () => recipeOptions({ roleLabel, storeRecipeAvailable, sources: cloneSources }),
    [cloneSources, roleLabel, storeRecipeAvailable],
  );
  const [name, setName] = useState(defaultName);
  const [withAgent, setWithAgent] = useState(defaultWithAgent);
  const [botName, setBotName] = useState(defaultBotName);
  // The best option on offer is the default, and it may improve while the
  // siblings' exports are still being read; a choice the person made sticks.
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
          }}
          value={name}
        />
        {showErrors && errors.name !== undefined ? <FieldError>{errors.name}</FieldError> : null}
      </div>

      <div className="space-y-3">
        <label className="flex items-center justify-between gap-3 text-sm" htmlFor={`${id}-agent`}>
          <span className="flex flex-col gap-0.5">
            <span>Runs an agent</span>
            <span className="text-xs text-muted-foreground">
              {role === "prod"
                ? "Production usually does not: an agent with a shell in production is a separate decision."
                : "A Zerops Mate container with a coding agent you can talk to."}
            </span>
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
          {cloneSourcesLoading ? (
            <div
              aria-label="Reading the group's environments"
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
          <DialogTitle>
            Add {roleLabel.toLowerCase()} to {form.groupName}
          </DialogTitle>
          <DialogDescription>
            A new Zerops project in this group. It takes a couple of minutes to come up.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <ZeropsEnvironmentCreationForm {...form} />
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
