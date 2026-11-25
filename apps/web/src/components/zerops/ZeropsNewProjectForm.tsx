/**
 * New project, as a page in the main column beside the menu (`/zerops/new`, `ZeropsNewProjectRoute`),
 * in two steps (the owner, 2026-11-23: "make the UI minimal"):
 *
 * 1. The project: what the person wants to build, its name, and *Start a project*. Folded under
 *    *Advanced options*, who can open it and the region it runs in, as tiles with this browser's
 *    latency to each, only where the account has more than one.
 * 2. Its first Mate: its face large, its name under it, *Shuffle* for another name, and *Change
 *    style*, which opens the face's colours and shapes as a ring around it (`MateFaceRing`).
 *    *Add <name> to your project* creates both; *Back to project options* returns to the first step,
 *    which keeps what was typed and chosen.
 *
 * Every choice has its default, so a name and two presses start a project. A name that will not do,
 * or what Create waits on, is said under the button; the credit forecast under that. Create hands
 * over at once; the person lands on the first Mate's own view.
 */
import type { LocationChoice } from "@t3tools/client-runtime/data";
import type { ZeropsMateFace } from "@t3tools/client-runtime/zerops";
import type { ProjectGrant } from "@t3tools/client-runtime/zerops/projectAccess";
import type { TakenBotNames } from "@t3tools/client-runtime/zerops/projections";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import {
  CheckIcon,
  ChevronDownIcon,
  InfoIcon,
  MapPinIcon,
  PencilIcon,
  ShuffleIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { RadioCard, RadioGroup } from "../ui/radio-group";
import { SectionHeader } from "../ui/section";
import { Spinner } from "../ui/spinner";
import { MateFacePicker, MateFaceRing } from "./MateFacePicker";
import { MateNameInput } from "./MateNameInput";
import { MateNameText } from "./MateNameText";
import { useMateShuffle } from "./useMateShuffle";
import type { ProjectAccessSlot } from "./projects/ProjectAccessChips";
import {
  faceName,
  newMateFace,
  newMateWords,
  offeredBotName,
} from "./ZeropsEnvironmentCreationDialog.logic";
import { newProjectButton, regionPlace } from "./ZeropsNewProjectForm.logic";

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
  /** Offers a name as the proposal (*Shuffle*'s roll), never as one the person typed. */
  readonly propose: (offer: string) => void;
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
  const propose = (offer: string) => {
    setProposal(offer);
    setTyped(null);
  };
  const another = taken.complete
    ? () => {
        propose(input.proposeAnotherName(botName.replace(/\s+/g, " ").trim()));
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
    propose,
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
 * Where it lives, as tiles, each with this browser's latency to it — only where the account has
 * more than one place.
 */
export function NewProjectLocation({ form }: { readonly form: NewProjectForm }) {
  const { locations, locationId, onLocation, creating, retry, closed } = form.input;
  if (closed !== undefined || locations.length <= 1) return null;
  const held = creating || retry !== undefined;
  return (
    <div className="region" data-zerops-surface="region">
      <SectionHeader id={REGION_LABEL} level={3} title="Where the services should run" />
      <RadioGroup
        aria-labelledby={REGION_LABEL}
        disabled={held}
        layout="row"
        onValueChange={(picked) => {
          const location = locations.find((candidate) => candidate.id === picked);
          if (location !== undefined) onLocation(location.id);
        }}
        value={locationId}
      >
        {locations.map((location) => {
          const place = regionPlace(location.name);
          // Holds its line while unmeasured, so a sample coming in moves nothing.
          const latency = location.latencyMs === undefined ? null : `${location.latencyMs} ms`;
          return (
            <RadioCard
              align="center"
              aria-label={location.name}
              key={location.id}
              title={<span className="truncate">{place.name}</span>}
              value={location.id}
            >
              {place.city === undefined ? null : (
                <span className="flex max-w-full items-center gap-1">
                  <MapPinIcon aria-hidden className="size-3.5 shrink-0" />
                  <span className="truncate">{place.city}</span>
                </span>
              )}
              <span className="mt-2 block min-h-4.5 max-w-full truncate tabular-nums">
                {latency === null ? null : `Latency: ${latency}`}
              </span>
            </RadioCard>
          );
        })}
      </RadioGroup>
      <ul className="region-notes">
        <li>
          <InfoIcon aria-hidden />
          Pick the region closest to your users. That gives them the lowest latency.
        </li>
        <li>
          <InfoIcon aria-hidden />
          GDPR requirements often point to EU hosting.
        </li>
      </ul>
    </div>
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
  label,
  className,
  buttonRef,
  rolling = false,
}: {
  readonly form: NewProjectForm;
  readonly size?: "md" | "lg";
  /** Its words where they never change as the names are typed; by default what it makes. */
  readonly label?: string;
  readonly className?: string;
  readonly buttonRef?: RefObject<HTMLButtonElement | null>;
  /** A shuffle still rolling: nothing is made of a face and a name about to change. */
  readonly rolling?: boolean;
}) {
  const { creating, retry } = form.input;
  return (
    <Button
      aria-busy={creating || undefined}
      className={className}
      data-zerops-new-project="create"
      ref={buttonRef}
      disabled={form.held || rolling}
      size={size}
      type="submit"
    >
      {creating ? <Spinner size="md" /> : null}
      {retry === undefined
        ? (label ?? newProjectButton({ projectName: form.name, botName: form.botName }))
        : "Try again"}
    </Button>
  );
}

/** The page's one field: the project's name, its placeholder the label it needs. */
function NewProjectNameInput({
  form,
  inputRef,
}: {
  readonly form: NewProjectForm;
  readonly inputRef: RefObject<HTMLInputElement | null>;
}) {
  return (
    <Input
      aria-describedby={form.unnamed ? LINE : undefined}
      aria-invalid={form.unnamed || undefined}
      aria-label="Project name"
      autoComplete="off"
      id={PROJECT_FIELD}
      onChange={(event) => {
        form.setName(event.target.value);
      }}
      placeholder="Project name…"
      readOnly={form.input.creating}
      ref={inputRef}
      size="hero"
      spellCheck={false}
      value={form.name}
    />
  );
}

/** The page: the project's step, then its first Mate's. */
export function ZeropsNewProjectPage(input: NewProjectFormInput) {
  const nameField = useRef<HTMLInputElement>(null);
  const addMate = useRef<HTMLButtonElement>(null);
  const form = useNewProjectForm(input, nameField);
  const [step, setStep] = useState<"project" | "mate">("project");
  const [styling, setStyling] = useState(false);
  const { closed, access, forecast, proposeAnotherName, creating } = input;
  const shuffle = useMateShuffle({
    name: form.botName,
    pickTint: form.pickTint,
    pickShape: form.pickShape,
    setName: form.propose,
    // Until every name is read no proposal is offered, so the roll keeps the name.
    proposeAnotherName: form.another === undefined ? undefined : proposeAnotherName,
  });
  // Each step opens on what it asks, where a keyboard is at hand: the name, then the Mate's press.
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    (step === "project" ? nameField : addMate).current?.focus();
  }, [step]);
  if (closed !== undefined)
    return (
      <NewProjectPageFrame>
        <h1 className="new-project-heading">What do you want to build?</h1>
        <p className="new-project-closed">{closed}</p>
      </NewProjectPageFrame>
    );
  if (step === "mate")
    return (
      <NewProjectPageFrame centered>
        <NewProjectFormFrame className="new-project-form new-project-mate" form={form}>
          <MateFaceRing
            face={form.face}
            onPickShape={form.pickShape}
            onPickTint={form.pickTint}
            open={styling}
          />
          <h1 className="new-project-heading">
            <MateNameText
              describedBy={LINE}
              onValueChange={form.nameMate}
              readOnly={creating}
              value={form.botName}
            />
          </h1>
          <div className="new-project-mate-acts">
            {/* Pills, so they read as tools on the Mate rather than the page's next step. */}
            <Button
              aria-busy={shuffle.rolling || undefined}
              disabled={creating}
              onClick={shuffle.roll}
              shape="round"
              size="sm"
              variant="secondary"
            >
              <ShuffleIcon aria-hidden />
              Shuffle
            </Button>
            <Button
              aria-expanded={styling}
              disabled={creating}
              shape="round"
              size="sm"
              variant="secondary"
              onClick={() => {
                setStyling(!styling);
              }}
            >
              {styling ? <CheckIcon aria-hidden /> : <PencilIcon aria-hidden />}
              {styling ? "Confirm style" : "Change style"}
            </Button>
          </div>
          <CreateProjectButton
            buttonRef={addMate}
            rolling={shuffle.rolling}
            className="w-full"
            form={form}
            // By the name as typed; with none yet, the Mate it will be.
            label={`Add ${form.botName.replace(/\s+/g, " ").trim() || "mate"} to your project`}
            size="lg"
          />
          <NewProjectLine className="text-center" form={form} />
          {forecast}
          <Button
            className="w-full"
            data-zerops-new-project="back"
            disabled={creating}
            onClick={() => {
              setStyling(false);
              setStep("project");
            }}
            size="lg"
            type="button"
            variant="ghost-muted"
          >
            Back to project options
          </Button>
        </NewProjectFormFrame>
      </NewProjectPageFrame>
    );
  return (
    <NewProjectPageFrame>
      <h1 className="new-project-heading">What do you want to build?</h1>
      <form
        className="new-project-form"
        data-zerops-surface="new-project-form"
        onSubmit={(event) => {
          event.preventDefault();
          // A nameless press asks for the name, at the name; a named one goes on to the Mate.
          if (form.name.trim().length === 0) form.press();
          else setStep("mate");
        }}
      >
        <div className="new-project-primary">
          <NewProjectNameInput form={form} inputRef={nameField} />
          <Button className="w-full" data-zerops-new-project="start" size="lg" type="submit">
            Start a project
          </Button>
          <p aria-live="polite" className="new-project-unnamed" id={LINE}>
            {form.unnamed ? NAME_YOUR_PROJECT : null}
          </p>
        </div>
        <div className="new-project-advanced">
          <Collapsible className="flex flex-col">
            <CollapsibleTrigger className="inline-flex cursor-pointer items-center gap-1.5 self-center rounded-full px-4 py-2 font-medium text-body text-muted-foreground leading-4.5 outline-ring outline-offset-2 hover:text-foreground focus-visible:outline-2 ">
              Project access & region setup
              <ChevronDownIcon
                aria-hidden
                className="size-4 transition-transform duration-200 ease-out-strong in-data-panel-open:rotate-180"
              />
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div className="new-project-advanced-fields">
                <NewProjectLocation form={form} />
                {access === undefined ? null : access(form.setUserRoles)}
              </div>
            </CollapsiblePanel>
          </Collapsible>
        </div>
      </form>
    </NewProjectPageFrame>
  );
}

function NewProjectPageFrame({
  centered = false,
  children,
}: {
  /** Centred in the column, both ways: the Mate's step, which does not grow. */
  readonly centered?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <section
      className="new-project-page"
      data-centered={centered ? "" : undefined}
      data-zerops-surface="new-project"
    >
      <div className="new-project-stage">{children}</div>
    </section>
  );
}
