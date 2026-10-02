/**
 * The New project dialog: New Mate with the project's name on top (board D1, the owner,
 * 2026-09-30), hosted over whatever the person is looking at (`ZeropsNewProjectHost`).
 *
 * It asks the project's name — and where it lives, only where the account has more than one
 * place — then who its first Mate is: a name, a colour and a shape, beside the face they make,
 * with the picker and the rules New Mate uses. Until its person picks, the face follows the name
 * as it is typed or rolled (the tint the account would give it, and that tint's shape); a pick
 * sticks. A name that will not do is said beside the button once it is pressed; while the
 * account's Mates' names are still being read, the button waits and says so.
 *
 * It ends, as New Mate does, with what happens next (`newProjectNext`): HQ where the
 * organization has none, then the project and its Mate, then the person signs it in and tells it what
 * to build. Create hands over at once; the person lands on the first Mate's own view.
 */
import type { ZeropsMateFace } from "@t3tools/client-runtime/zerops";
import type { TakenBotNames } from "@t3tools/client-runtime/zerops/projections";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { useState } from "react";

import { cn } from "~/lib/utils";

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
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { MateFacePicker } from "./MateFacePicker";
import { FormOrPress, type PressingView } from "./ZeropsEnvironmentCreationDialog";
import { MateNameInput } from "./MateNameInput";
import { WhatHappensNext } from "./WhatHappensNext";
import { newProjectNext } from "./whatHappensNext.logic";
import {
  faceName,
  newMateFace,
  newMateSubmit,
  newMateWords,
} from "./ZeropsEnvironmentCreationDialog.logic";
import { newProjectButton } from "./ZeropsNewProjectForm.logic";

/** What the form hands over: the project's name, its first Mate's, and the Mate's face. */
export interface NewProjectChoice {
  readonly name: string;
  readonly botName: string;
  readonly face: ZeropsMateFace;
}

export interface ZeropsNewProjectFormProps {
  /** The platform's locations; only more than one is a choice to offer. */
  readonly locations: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly locationId: string | null;
  readonly onLocation: (id: string) => void;
  /** The locations, or whether the organization has its HQ, are still being read: the button waits, with a spinner. */
  readonly loading: boolean;
  /** Why the locations could not be read; `null` when they were. */
  readonly locationError: string | null;
  /** The first Mate's name proposed, free on the account (`generateBotName`). */
  readonly defaultBotName: string;
  /** Another name free on the account, never the one given: the die at the name's end. */
  readonly proposeAnotherName?: ((current: string) => string) | undefined;
  /** The account's Mates' names, and whether the listing read them all (`takenBotNames`). */
  readonly takenBotNames: TakenBotNames;
  /** The tint the account gives a new Mate of this name (`newMateTint`). */
  readonly defaultTintFor: (name: string) => MateTintId;
  /** Create was pressed: its first Mate's view is on its way, and a second press makes nothing. */
  readonly creating: boolean;
  /** Why nothing can be created here, in the form's place; Close is all there is. */
  readonly closed?: string | undefined;
  readonly onCancel: () => void;
  readonly onCreate: (choice: NewProjectChoice) => void;
}

const PROJECT_FIELD = "zerops-new-project";
const MATE_FIELD = "zerops-new-project-mate";
const LINE = "zerops-new-project-line";

export function ZeropsNewProjectForm({
  locations,
  locationId,
  onLocation,
  loading,
  locationError,
  defaultBotName,
  proposeAnotherName,
  takenBotNames: taken,
  defaultTintFor,
  creating,
  closed,
  onCancel,
  onCreate,
}: ZeropsNewProjectFormProps) {
  const [name, setName] = useState("");
  const [botName, setBotName] = useState(defaultBotName);
  // The last name typed: a blank field keeps the face it had rather than flashing another.
  const [heldName, setHeldName] = useState(defaultBotName);
  const [picked, setPicked] = useState<{
    readonly tint?: MateTintId | undefined;
    readonly shape?: MateShapeId | undefined;
  }>({});
  // Create was pressed: from then on what is wrong with the Mate's name is said, as it is typed.
  const [pressed, setPressed] = useState(false);

  const face = newMateFace({
    name: faceName(botName, heldName),
    picked,
    defaultTint: defaultTintFor,
  });
  // A new project has no recipe to wait on: only the name, new on the account.
  const submit = newMateSubmit({
    botName,
    takenBotNames: taken,
    tier: undefined,
    tierLoading: false,
  });
  const refused = pressed && submit.kind === "refuse" ? submit.error : undefined;
  const failed = refused ?? locationError ?? undefined;
  const line =
    failed ??
    newMateWords({
      groupName: name,
      botName,
      recipe: "none",
      waitingOn: submit.kind === "wait" ? submit.on : null,
    }).line;

  const nameMate = (typed: string) => {
    setBotName(typed);
    const named = typed.replace(/\s+/g, " ").trim();
    if (named.length > 0) setHeldName(named);
  };
  const press = () => {
    if (creating || closed !== undefined) return;
    setPressed(true);
    if (submit.kind !== "create" || name.trim().length === 0) return;
    onCreate({ name: name.trim(), botName: botName.replace(/\s+/g, " ").trim(), face });
  };

  return (
    <form
      className="flex min-h-0 flex-col"
      data-zerops-surface="new-project-form"
      onSubmit={(event) => {
        event.preventDefault();
        press();
      }}
    >
      <DialogHeader>
        <DialogTitle>New project</DialogTitle>
        {closed === undefined ? null : <DialogDescription>{closed}</DialogDescription>}
      </DialogHeader>
      {closed === undefined ? (
        <DialogPanel>
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={PROJECT_FIELD}>Project name</Label>
              <Input
                autoComplete="off"
                id={PROJECT_FIELD}
                onChange={(event) => {
                  setName(event.target.value);
                }}
                placeholder="Acme CRM"
                readOnly={creating}
                spellCheck={false}
                value={name}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={MATE_FIELD}>Its first Mate</Label>
              <MateFacePicker
                compact
                face={face}
                onPickShape={(shape) => {
                  if (!creating) setPicked((current) => ({ ...current, shape }));
                }}
                onPickTint={(tint) => {
                  if (!creating) setPicked((current) => ({ ...current, tint }));
                }}
              >
                <MateNameInput
                  describedBy={LINE}
                  id={MATE_FIELD}
                  invalid={refused !== undefined}
                  onAnother={
                    proposeAnotherName === undefined
                      ? undefined
                      : () => {
                          nameMate(proposeAnotherName(botName.replace(/\s+/g, " ").trim()));
                        }
                  }
                  onValueChange={nameMate}
                  readOnly={creating}
                  value={botName}
                />
              </MateFacePicker>
            </div>
            <WhatHappensNext
              versions={[
                {
                  key: "next",
                  next: newProjectNext({
                    projectName: name,
                    botName,
                  }),
                  shown: true,
                },
              ]}
            />
          </div>
        </DialogPanel>
      ) : null}
      <DialogFooter>
        {/* Where it lives: a quiet choice at the footer's start, only where the account has
            more than one place (board D1). */}
        {closed === undefined && locations.length > 1 ? (
          <Select
            disabled={creating}
            onValueChange={(value) => {
              if (value !== null) onLocation(value);
            }}
            value={locationId}
          >
            <SelectTrigger aria-label="Location" className="w-auto">
              <SelectValue placeholder="Location">
                {locations.find((location) => location.id === locationId)?.name ?? "Location"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {locations.map((location) => (
                <SelectItem key={location.id} value={location.id}>
                  {location.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : null}
        {/* The one quiet line, beside the button it is about: what it waits on, or why the
            Mate's name will not do. The footer holds its room. */}
        <p
          aria-live="polite"
          className={cn(
            "me-auto min-h-4 self-center text-line leading-4",
            failed === undefined ? "text-muted-foreground" : "text-status-failed-text",
          )}
          id={LINE}
        >
          {line}
        </p>
        {closed === undefined ? (
          <>
            <Button disabled={creating} onClick={onCancel} type="button" variant="ghost">
              Cancel
            </Button>
            <Button
              aria-busy={creating || loading || undefined}
              data-zerops-new-project="create"
              disabled={
                creating ||
                name.trim().length === 0 ||
                loading ||
                locationError !== null ||
                (locations.length > 0 && !locationId) ||
                submit.kind === "wait"
              }
              type="submit"
            >
              {creating || loading ? <Spinner size="md" /> : null}
              {newProjectButton({ projectName: name, botName })}
            </Button>
          </>
        ) : (
          <Button onClick={onCancel} type="button" variant="ghost">
            Close
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}

/** The form in its dialog, New Mate's size: what the host opens, and what the harness draws. */
export function ZeropsNewProjectDialog({
  onOpenChange,
  pressing,
  ...form
}: ZeropsNewProjectFormProps & {
  readonly onOpenChange: (open: boolean) => void;
  /**
   * The press under way, in the form's place: the dialog stays on it until the first Mate needs
   * no browser (its project marked closed off), so a tab closed meanwhile is a person's choice.
   */
  readonly pressing?: PressingView | undefined;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogPopup className="max-w-lg">
        <FormOrPress pressing={pressing}>
          <ZeropsNewProjectForm {...form} />
        </FormOrPress>
      </DialogPopup>
    </Dialog>
  );
}
