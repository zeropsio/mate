/**
 * The New project dialog: New Mate with the project's name on top (board D1, the owner,
 * 2026-09-30), hosted over whatever the person is looking at (`ZeropsNewProjectHost`).
 *
 * It asks the project's name — and where it lives, only where the account has more than one
 * place — then who its first Mate is: a name beside the face it makes, the colour and the shape
 * behind *Change look*, with the picker and the rules New Mate uses. Who can open the project is
 * one line, the people opened only to change it. The dialog stands in the window's middle, sized
 * to what it asks; only its body scrolls where the window is too short. Until its person picks, the face follows the name
 * as it is typed or rolled (the tint the account would give it, and that tint's shape); a pick
 * sticks. A name that will not do is said beside the button once it is pressed; while the
 * account's Mates' names are still being read, the button waits and says so.
 *
 * It ends, as New Mate does, with what happens next (`newProjectNext`): HQ where the
 * organization has none, then the project and its Mate, then the person signs it in and tells it what
 * to build. Create hands over at once; the person lands on the first Mate's own view.
 */
import type { LocationChoice } from "@t3tools/client-runtime/data";
import type { ZeropsMateFace } from "@t3tools/client-runtime/zerops";
import type { ProjectGrant } from "@t3tools/client-runtime/zerops/projectAccess";
import type { TakenBotNames } from "@t3tools/client-runtime/zerops/projections";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { GaugeIcon } from "lucide-react";
import { useRef, useState, type ReactNode, type RefObject } from "react";

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
import { MateNameInput } from "./MateNameInput";
import type { ProjectAccessSlot } from "./projects/ProjectAccessChips";
import { WhatHappensNext } from "./WhatHappensNext";
import { newProjectNext } from "./whatHappensNext.logic";
import {
  faceName,
  newMateFace,
  newMateWords,
  offeredBotName,
} from "./ZeropsEnvironmentCreationDialog.logic";
import { newProjectButton } from "./ZeropsNewProjectForm.logic";

/** What the form hands over: the project's name, its first Mate's, and the Mate's face. */
export interface NewProjectChoice {
  readonly name: string;
  readonly botName: string;
  readonly face: ZeropsMateFace;
  /** Who reaches its first Mate's project beyond their organization role, as chosen here. */
  readonly userRoles?: ReadonlyArray<ProjectGrant>;
}

/** What a New project form is given: its host's reads, and what Create hands over to. */
export interface NewProjectFormInput {
  /** The platform's locations; only more than one is a choice to offer. */
  readonly locations: ReadonlyArray<LocationChoice>;
  readonly locationId: string | null;
  readonly onLocation: (id: string) => void;
  /** The locations, or whether the organization has its HQ, are still being read: the button waits, with a spinner. */
  readonly loading: boolean;
  /** Why the locations could not be read; `null` when they were. */
  readonly locationError: string | null;
  /** The first Mate's name to propose, offered once the account's names vouch for it. */
  readonly defaultBotName: string;
  /** Another name free on the account, never the one given. */
  readonly proposeAnotherName: (current: string) => string;
  /** The account's Mates' names, and whether the listing read them all (`takenBotNames`). */
  readonly takenBotNames: TakenBotNames;
  /** The tint the account gives a new Mate of this name (`newMateTint`). */
  readonly defaultTintFor: (name: string) => MateTintId;
  /** Create was pressed: its first Mate's view is on its way, and a second press makes nothing. */
  readonly creating: boolean;
  readonly retry?: { readonly reason: string; readonly send: () => void } | undefined;
  /** Why nothing can be created here, in the form's place; Close is all there is. */
  readonly closed?: string | undefined;
  readonly onCreate: (choice: NewProjectChoice) => void;
  /** Who will reach its first Mate's project, as people chips; absent, nothing of access. */
  readonly access?: ProjectAccessSlot | undefined;
  /** The line forecasting the credit wall before Create (`ZeropsCreditForecast`); absent, none. */
  readonly forecast?: ReactNode;
}

interface ZeropsNewProjectFormProps extends NewProjectFormInput {
  readonly onCancel: () => void;
  /** The project's name field, where its dialog puts the focus as it opens. */
  readonly nameField?: RefObject<HTMLInputElement | null>;
}

/** What a Create pressed with no project name says, at the name. */
const NAME_YOUR_PROJECT = "Name your project.";

const PROJECT_FIELD = "zerops-new-project";
const REGION_LABEL = "zerops-new-project-region";
const MATE_FIELD = "zerops-new-project-mate";
const LINE = "zerops-new-project-line";

/**
 * A New project form's state, wherever it is drawn — the dialog (`ZeropsNewProjectForm`) or an
 * account's first run (`FirstRunScreen`), which draws the same fields in its own place.
 */
export interface NewProjectForm {
  readonly input: NewProjectFormInput;
  readonly name: string;
  readonly setName: (name: string) => void;
  readonly botName: string;
  /** The Mate as it is called while its name is typed: a blank field keeps the last name. */
  readonly calledName: string;
  readonly nameMate: (typed: string) => void;
  /** The die at the name's end; absent until every name is read. */
  readonly another: (() => void) | undefined;
  readonly face: ZeropsMateFace;
  readonly pickTint: (tint: MateTintId) => void;
  readonly pickShape: (shape: MateShapeId) => void;
  /** Why the Mate's name will not do, once Create was pressed. */
  readonly refused: string | undefined;
  /** Create was pressed with no project name. */
  readonly unnamed: boolean;
  /** What is wrong, said beside the button; none when nothing is. */
  readonly failed: string | undefined;
  /** The one quiet line beside the button: what is wrong, or what it waits on; none when neither. */
  readonly line: string | undefined;
  /** Create cannot be pressed now: it is on its way, or what it needs is still being read. */
  readonly held: boolean;
  readonly press: () => void;
  readonly setUserRoles: (roles: ReadonlyArray<ProjectGrant>) => void;
}

/** The form's state; `nameField` is the project's name field, which a nameless Create focuses. */
export function useNewProjectForm(
  input: NewProjectFormInput,
  nameField: RefObject<HTMLInputElement | null>,
): NewProjectForm {
  const { defaultBotName, takenBotNames: taken, creating, retry, closed } = input;
  const [name, setName] = useState("");
  const [userRoles, setUserRoles] = useState<ReadonlyArray<ProjectGrant>>([]);
  const [typed, setTyped] = useState<string | null>(null);
  const [proposal, setProposal] = useState(defaultBotName);
  // A new project has no recipe to wait on: only the name, new on the account.
  const named = offeredBotName({
    typed,
    proposal,
    takenBotNames: taken,
    tier: undefined,
    tierLoading: false,
    another: input.proposeAnotherName,
  });
  if (named.proposal !== proposal) setProposal(named.proposal);
  const { botName, submit } = named;
  // The last name typed: a blank field keeps the face it had rather than flashing another.
  const [heldName, setHeldName] = useState(defaultBotName);
  const [picked, setPicked] = useState<{
    readonly tint?: MateTintId | undefined;
    readonly shape?: MateShapeId | undefined;
  }>({});
  // Create was pressed: from then on what is wrong with the Mate's name is said, as it is typed.
  const [pressed, setPressed] = useState(false);

  const calledName = faceName(botName, heldName);
  const face = newMateFace({
    name: calledName,
    picked,
    defaultTint: input.defaultTintFor,
  });
  const refused = pressed && submit.kind === "refuse" ? submit.error : undefined;
  // Create stays on with no project name: its press asks for one, at the name.
  const unnamed = pressed && name.trim().length === 0;
  const failed =
    retry?.reason ??
    (unnamed ? NAME_YOUR_PROJECT : undefined) ??
    refused ??
    input.locationError ??
    undefined;
  const line =
    failed ??
    newMateWords({
      groupName: name,
      botName,
      recipe: "none",
      waitingOn: submit.kind === "wait" ? submit.on : null,
    }).line;
  const held =
    creating ||
    (retry === undefined &&
      (input.loading ||
        input.locationError !== null ||
        (input.locations.length > 0 && !input.locationId) ||
        submit.kind === "wait"));

  const nameMate = (value: string) => {
    setTyped(value);
    const called = value.replace(/\s+/g, " ").trim();
    if (called.length > 0) setHeldName(called);
  };
  const another = taken.complete
    ? () => {
        setProposal(input.proposeAnotherName(botName.replace(/\s+/g, " ").trim()));
        setTyped(null);
      }
    : undefined;
  const press = () => {
    if (creating || closed !== undefined) return;
    if (retry !== undefined) {
      retry.send();
      return;
    }
    setPressed(true);
    if (name.trim().length === 0) {
      nameField.current?.focus();
      return;
    }
    if (submit.kind !== "create") return;
    input.onCreate({
      name: name.trim(),
      botName: botName.replace(/\s+/g, " ").trim(),
      face,
      ...(userRoles.length === 0 ? {} : { userRoles }),
    });
  };
  return {
    input,
    name,
    setName,
    botName,
    calledName,
    nameMate,
    another,
    face,
    pickTint: (tint) => {
      if (!creating) setPicked((current) => ({ ...current, tint }));
    },
    pickShape: (shape) => {
      if (!creating) setPicked((current) => ({ ...current, shape }));
    },
    refused,
    unnamed,
    failed,
    line,
    held,
    press,
    setUserRoles,
  };
}

/** The form element: Enter anywhere in it presses Create. */
export function NewProjectFormFrame({
  form,
  className,
  children,
}: {
  readonly form: NewProjectForm;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <form
      className={className}
      data-zerops-surface="new-project-form"
      onSubmit={(event) => {
        event.preventDefault();
        form.press();
      }}
    >
      {children}
    </form>
  );
}

/** The fields, held still while Create is on its way or a retry is offered. */
export function NewProjectFields({
  form,
  className,
  children,
}: {
  readonly form: NewProjectForm;
  readonly className: string;
  readonly children: ReactNode;
}) {
  return (
    <fieldset
      className={className}
      disabled={form.input.creating || form.input.retry !== undefined}
    >
      {children}
    </fieldset>
  );
}

export function ProjectNameField({
  form,
  inputRef,
  size = "default",
}: {
  readonly form: NewProjectForm;
  /** The field the form's `nameField` names. */
  readonly inputRef: RefObject<HTMLInputElement | null>;
  /** `xl` where the form is the page's hero (the first run's card). */
  readonly size?: "default" | "xl" | undefined;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={PROJECT_FIELD}>Project name</Label>
      <Input
        aria-describedby={form.unnamed ? LINE : undefined}
        aria-invalid={form.unnamed || undefined}
        autoComplete="off"
        id={PROJECT_FIELD}
        onChange={(event) => {
          form.setName(event.target.value);
        }}
        placeholder="e.g. Acme CRM"
        readOnly={form.input.creating}
        ref={inputRef}
        size={size}
        spellCheck={false}
        value={form.name}
      />
    </div>
  );
}

/**
 * Who the first Mate is: its name, with the die, and its look — folded behind *Change look* in the
 * dialog, or apart, the rows under the name, where the page draws the face as its hero.
 */
export function FirstMateField({
  form,
  label,
  look,
  size,
}: {
  readonly form: NewProjectForm;
  readonly label: string;
  readonly look: "folded" | "apart";
  /** `xl` where the form is the page's hero (the first run's card). */
  readonly size?: "default" | "xl" | undefined;
}) {
  const { creating } = form.input;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={MATE_FIELD}>{label}</Label>
      <MateFacePicker
        apart={look === "apart"}
        face={form.face}
        folded={look === "folded"}
        onPickShape={form.pickShape}
        onPickTint={form.pickTint}
      >
        <MateNameInput
          describedBy={LINE}
          id={MATE_FIELD}
          invalid={form.refused !== undefined}
          onAnother={form.another}
          onValueChange={form.nameMate}
          readOnly={creating}
          size={size}
          value={form.botName}
        />
      </MateFacePicker>
    </div>
  );
}

/**
 * Where it lives: a quiet choice, only where the account has more than one place (board D1) — in
 * the dialog's footer, or as tiles among the fields (`tiles`, the first run's card), each with this
 * browser's latency to it.
 */
export function NewProjectLocation({
  form,
  className,
  tiles = false,
}: {
  readonly form: NewProjectForm;
  readonly className?: string;
  readonly tiles?: boolean;
}) {
  const { locations, locationId, onLocation, creating, retry, closed } = form.input;
  if (closed !== undefined || locations.length <= 1) return null;
  const held = creating || retry !== undefined;
  if (tiles)
    return (
      <div className="flex flex-col gap-1.5">
        <Label id={REGION_LABEL} render={<h3 />}>
          Region
        </Label>
        <div aria-labelledby={REGION_LABEL} className="region-tiles" role="radiogroup">
          {locations.map((location) => (
            <button
              aria-checked={location.id === locationId}
              className="region-tile"
              disabled={held}
              key={location.id}
              onClick={() => {
                onLocation(location.id);
              }}
              role="radio"
              type="button"
            >
              <span className="region-tile-name">{location.name}</span>
              {/* Holds its line while unmeasured, so a sample coming in moves nothing. */}
              <span className="region-tile-latency">
                {location.latencyMs === undefined ? null : (
                  <>
                    <GaugeIcon aria-hidden />
                    {location.latencyMs} ms
                  </>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  return (
    <Select
      disabled={held}
      onValueChange={(value) => {
        if (value !== null) onLocation(value);
      }}
      value={locationId}
    >
      <SelectTrigger aria-label="Region" className={cn("w-auto", className)}>
        <SelectValue placeholder="Region">
          {locations.find((location) => location.id === locationId)?.name ?? "Region"}
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
  );
}

/**
 * The one quiet line, beside the button it is about: what it waits on, or why the Mate's name
 * will not do. It holds its room.
 */
export function NewProjectLine({
  form,
  className,
}: {
  readonly form: NewProjectForm;
  readonly className?: string;
}) {
  return (
    <p
      aria-live="polite"
      className={cn(
        "min-h-4 text-line leading-4",
        form.failed === undefined ? "text-muted-foreground" : "text-status-failed-text",
        className,
      )}
      id={LINE}
    >
      {form.line}
    </p>
  );
}

/**
 * Create, by what it makes ("Create Acme CRM with Quinn"). It spins only once pressed: a read the
 * form makes again on its own never says something is happening that the person did not ask for.
 */
export function CreateProjectButton({
  form,
  size = "md",
}: {
  readonly form: NewProjectForm;
  readonly size?: "md" | "lg";
}) {
  const { creating, retry } = form.input;
  return (
    <Button
      aria-busy={creating || undefined}
      data-zerops-new-project="create"
      disabled={form.held}
      size={size}
      type="submit"
    >
      {creating ? <Spinner size="md" /> : null}
      {retry === undefined
        ? newProjectButton({ projectName: form.name, botName: form.botName })
        : "Try again"}
    </Button>
  );
}

export function ZeropsNewProjectForm({
  onCancel,
  nameField: givenNameField,
  ...input
}: ZeropsNewProjectFormProps) {
  const ownNameField = useRef<HTMLInputElement>(null);
  const nameField = givenNameField ?? ownNameField;
  const form = useNewProjectForm(input, nameField);
  const { closed, creating, access, forecast } = input;
  return (
    <NewProjectFormFrame className="flex min-h-0 flex-col" form={form}>
      <DialogHeader>
        <DialogTitle>New project</DialogTitle>
        {closed === undefined ? null : <DialogDescription>{closed}</DialogDescription>}
      </DialogHeader>
      {closed === undefined ? (
        <DialogPanel>
          <NewProjectFields className="flex flex-col gap-5" form={form}>
            <ProjectNameField form={form} inputRef={nameField} />
            <FirstMateField form={form} label="Its first Mate" look="folded" />
            <WhatHappensNext
              versions={[
                {
                  key: "next",
                  next: newProjectNext({ projectName: form.name, botName: form.botName }),
                  shown: true,
                },
              ]}
            />
            {access === undefined ? null : access(form.setUserRoles)}
            {forecast}
          </NewProjectFields>
        </DialogPanel>
      ) : null}
      <DialogFooter>
        {/* At the footer's start; on a phone the footer stacks from its foot: the place leads
            it, over the line. */}
        <NewProjectLocation className="max-sm:order-2" form={form} />
        <NewProjectLine className="me-auto self-center max-sm:order-1 max-sm:me-0" form={form} />
        {closed === undefined ? (
          <>
            <Button disabled={creating} onClick={onCancel} type="button" variant="ghost">
              Cancel
            </Button>
            <CreateProjectButton form={form} />
          </>
        ) : (
          <Button onClick={onCancel} type="button" variant="ghost">
            Close
          </Button>
        )}
      </DialogFooter>
    </NewProjectFormFrame>
  );
}

/** The form in its dialog, New Mate's size: what the host opens, and what the harness draws. */
export function ZeropsNewProjectDialog({
  onOpenChange,
  open = true,
  ...form
}: ZeropsNewProjectFormProps & {
  readonly onOpenChange: (open: boolean) => void;
  /** Held shut until what it says is read, so it opens whole (`ZeropsNewProjectHost`). */
  readonly open?: boolean;
}) {
  // Create closes it onto the first Mate's page, which takes the focus: never back to what opened
  // it, where a second Enter would open it again over that page.
  const created = useRef(false);
  // It opens on the project's name, ready to type.
  const nameField = useRef<HTMLInputElement>(null);
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup
        className="max-w-lg"
        finalFocus={() => !created.current}
        initialFocus={nameField}
        placement="center"
      >
        <ZeropsNewProjectForm
          {...form}
          nameField={nameField}
          onCreate={(choice) => {
            created.current = true;
            form.onCreate(choice);
          }}
        />
      </DialogPopup>
    </Dialog>
  );
}
