/**
 * The New Mate dialog: who the new Mate is, and what happens once it is added.
 *
 * It asks three things — a name, a colour and a shape — and shows the face they make, big, while
 * they are picked: the person sees who they are making. Everything else is decided for them. The
 * Mate gets its own copy of the project with the project's recipe deployed (the tier read from
 * the group repo's `main`), runs its agent, and is called what the project calls its Mates
 * (`proposedEnvironmentName`). A project with no recipe on main and no Mate yet still gets its
 * first, with nothing in it yet. The dialog ends with what happens next, with honest times
 * (`newMateNext`, board D1): the family New project belongs to (`ZeropsNewProjectForm`).
 *
 * A project that takes no Mate now — its Mates have not written its recipe yet, or it cannot be
 * read (`newMateDoor`) — gets no form: the description says why, and the one thing to do about it
 * stands where Add stood. The form gives its room back as the reason takes its own, in one move,
 * so the title and the buttons stay where they stood when the door shuts after the recipe is read.
 *
 * Until its person picks, the face follows the name as it is typed or rolled: the tint the account
 * would give that name (`newMateTint`, which never takes a tint another Mate wears) and that
 * tint's shape. A pick sticks. The face is HQ's record from the Mate's birth (its registration),
 * so the Mate wears it everywhere from its first moment.
 */
import type { EnvironmentRecipeChoice, ZeropsMateFace } from "@t3tools/client-runtime/zerops";
import type { ProjectGrant } from "@t3tools/client-runtime/zerops/projectAccess";
import type { TakenBotNames } from "@t3tools/client-runtime/zerops/projections";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { useEffect, useEffectEvent, useId, useState, type ReactNode } from "react";

import { Button, InlineButton } from "../ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "../ui/dialog";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { cn } from "~/lib/utils";
import { newMateKeyNote, type AutomatedKeyState } from "~/zerops/automatedMate.logic";
import {
  faceName,
  newMateDoorTitle,
  newMateFace,
  newMateRecipe,
  newMateSubmit,
  newMateWords,
  READING_RECIPE,
  type NewMateDoorAction,
  type NewMateDoorClosed,
  type NewMateRecipe,
} from "./ZeropsEnvironmentCreationDialog.logic";
import { MateFacePicker } from "./MateFacePicker";
import { MateNameInput } from "./MateNameInput";
import type { ProjectAccessSlot } from "./projects/ProjectAccessChips";
import { WhatHappensNext } from "./WhatHappensNext";
import { newMateCost, newMateNext, ZEROPS_PRICING_URL } from "./whatHappensNext.logic";

/** What the form hands over: the Mate's own name, which its project's is built from, the recipe and the face. */
export interface NewMateChoice {
  readonly name: string;
  readonly recipe: EnvironmentRecipeChoice;
  readonly face: ZeropsMateFace;
  /** Who reaches its project beyond their organization role, as chosen in the form. */
  readonly userRoles?: ReadonlyArray<ProjectGrant>;
  /** Made automated: it takes tasks from GitHub issues, on the organization's API key. */
  readonly automated?: true;
}

/** The Automated choice's one line. */
export const NEW_MATE_AUTOMATED_LINE =
  "Takes tasks from your GitHub issues and works them on your organization's API key. Nobody signs in to it.";
/** Beside the choice, where the organization holds no API key for automated Mates yet. */
export const NEW_MATE_NO_KEY_LINE = "Your organization has no API key for it yet.";
/** After it, for one who can't set the key: who does. */
const NEW_MATE_KEY_SETTER_LINE = "An Owner or Admin of your organization sets it.";
/** In its place, where HQ turned out older than automated Mates after the choice was offered. */
const NEW_MATE_UPDATE_HQ_LINE = "Update HQ to make automated Mates.";

export interface ZeropsNewMateFormProps {
  readonly groupName: string;
  /** The name proposed for it, free on the account (`generateBotName`). */
  readonly defaultBotName: string;
  /** Another name free on the account, never the one given: the die at the name's end. */
  readonly proposeAnotherName?: ((current: string) => string) | undefined;
  /** The account's Mates' names, and whether the listing read them all (`takenBotNames`). */
  readonly takenBotNames: TakenBotNames;
  /** The tier read from the group repo's `main`, when one is merged. */
  readonly tier: Extract<EnvironmentRecipeChoice, { kind: "tier" }> | undefined;
  /** True while the group repo is still being read. */
  readonly tierLoading: boolean;
  /** The tint the account gives a new Mate of this name (`newMateTint`). */
  readonly defaultTintFor: (name: string) => MateTintId;
  /** The shape a name was asked with before (an Add started over); its tint's where none. */
  readonly defaultShapeFor?: ((name: string) => MateShapeId | undefined) | undefined;
  /** Why the project takes no Mate now, and what to do about it (`newMateDoor`): no form. */
  readonly closed?: NewMateDoorClosed | undefined;
  /** The one thing to do while the project takes no Mate, pressed. */
  readonly onDoorAction?: ((action: NewMateDoorAction) => void) | undefined;
  readonly onCancel: () => void;
  readonly onCreate: (choice: NewMateChoice) => void;
  /** Who will reach its project, as people chips; absent, the form says nothing of access. */
  readonly access?: ProjectAccessSlot | undefined;
  /** The line forecasting the credit wall before Create (`ZeropsCreditForecast`); absent, none. */
  readonly forecast?: ReactNode;
  /**
   * The Automated choice, whether the organization holds the API key it runs on, and whether the
   * viewer may set it (an Owner or Admin): `missing` says so beside the choice — with the way to
   * where it is set for one who can, else who sets it. Absent, or `unsupported` (an HQ older
   * than automated Mates) when the dialog opens: no choice offered.
   */
  readonly automation?: { readonly key: AutomatedKeyState; readonly admin: boolean } | undefined;
  /** The Automated choice made already: an Add started over that was automated. */
  readonly defaultAutomated?: boolean | undefined;
  /** Leaves the dialog for where the organization's API key is set (Settings › Zerops). */
  readonly onOpenKeySettings?: (() => void) | undefined;
}

/**
 * A room that opens and gives itself back in one move: a grid row from 0fr to 1fr. It may shrink
 * below its content (`min-h-0`, rows `minmax(0, 1fr)`), so a long form scrolls inside the dialog's
 * panel and its footer — Add — stays in view: an organization with many people pushed Add below
 * the window, and a press there closed the dialog instead.
 */
const ROOM_CLASS =
  "grid min-h-0 transition-[grid-template-rows] duration-200 ease-(--ease-out-strong) motion-reduce:transition-none";
const ROOM_OPEN = "minmax(0, 1fr)";

export function ZeropsNewMateForm({
  groupName,
  defaultBotName,
  proposeAnotherName,
  takenBotNames,
  tier,
  tierLoading,
  defaultTintFor,
  defaultShapeFor,
  closed,
  onDoorAction,
  onCancel,
  onCreate,
  access,
  forecast,
  automation,
  defaultAutomated = false,
  onOpenKeySettings,
}: ZeropsNewMateFormProps) {
  const id = useId();
  const [chosenAutomated, setAutomated] = useState(defaultAutomated);
  // Whether it is offered, and whether the key's note holds its room, are decided by the first
  // frame: what is read after it changes the words, never what is there (the cardinal sin).
  const [offersAutomated] = useState(
    () => automation !== undefined && automation.key !== "unsupported",
  );
  const [holdsKeyNote] = useState(() => automation?.key === "unknown");
  // An HQ found unable to make one after the choice was offered: it stays, unavailable.
  const automatedUnavailable = automation === undefined || automation.key === "unsupported";
  const automated = chosenAutomated && !automatedUnavailable;
  const keyNote =
    automation === undefined ? null : newMateKeyNote(automation.key, automation.admin);
  const [userRoles, setUserRoles] = useState<ReadonlyArray<ProjectGrant>>([]);
  const [botName, setBotName] = useState(defaultBotName);
  // The last name typed: a blank field keeps the face it had rather than flashing another.
  const [heldName, setHeldName] = useState(defaultBotName);
  const [picked, setPicked] = useState<{
    readonly tint?: MateTintId | undefined;
    readonly shape?: MateShapeId | undefined;
  }>({});
  // Add was pressed before everything it needs was read, knowing the recipe as it then stood;
  // it goes the moment the rest is read. A name changed since lets it go.
  const [pressedFor, setPressedFor] = useState<NewMateRecipe | null>(null);
  // Add was pressed: from then on what is wrong with the name is said, as it is typed.
  const [pressed, setPressed] = useState(false);
  // A press waiting on the recipe is dropped once the project is read as taking no Mate: were the
  // door to open later, Add goes only when pressed again.
  if (closed !== undefined && pressedFor !== null) setPressedFor(null);
  // The last reason said: it keeps its words while its room gives itself back, after the door opens.
  const [reason, setReason] = useState(closed?.reason);
  if (closed !== undefined && closed.reason !== reason) setReason(closed.reason);

  const face = newMateFace({
    name: faceName(botName, heldName),
    picked,
    defaultTint: defaultTintFor,
    defaultShape: defaultShapeFor,
  });
  const recipe = newMateRecipe({ tier, tierLoading });
  const submit = newMateSubmit({ botName, appName: groupName, takenBotNames, tier, tierLoading });
  const waiting = pressedFor !== null && submit.kind === "wait";
  const words = newMateWords({
    groupName,
    botName,
    recipe,
    waitingOn: submit.kind === "wait" && waiting ? submit.on : null,
  });
  const refused = pressed && submit.kind === "refuse" ? submit.error : undefined;
  const error = closed === undefined ? refused : undefined;
  const bot = botName.replace(/\s+/g, " ").trim();
  const action = closed?.action;
  const line =
    closed !== undefined
      ? action?.kind === "retry" && action.busy
        ? READING_RECIPE
        : undefined
      : (error ?? words.line);

  const name = (typed: string) => {
    setBotName(typed);
    setPressedFor(null);
    const named = typed.replace(/\s+/g, " ").trim();
    if (named.length > 0) setHeldName(named);
  };
  const create = (choice: EnvironmentRecipeChoice) => {
    onCreate({
      name: bot,
      recipe: choice,
      face,
      ...(userRoles.length === 0 ? {} : { userRoles }),
      ...(automated ? { automated: true as const } : {}),
    });
  };
  const press = () => {
    if (closed !== undefined) return;
    setPressed(true);
    if (submit.kind === "create") create(submit.recipe);
    else setPressedFor(submit.kind === "wait" ? recipe : null);
  };

  // The reads a press waited on have arrived: it goes, unless the recipe it was pressed for is
  // not there — a project read as having no recipe after Add was pressed for one with it says
  // so, and waits for another press. A name refused meanwhile is said instead.
  const goes =
    closed === undefined &&
    pressedFor !== null &&
    submit.kind === "create" &&
    (submit.recipe.kind === "tier" || pressedFor === "none");
  const go = useEffectEvent(() => {
    if (submit.kind === "create") create(submit.recipe);
  });
  useEffect(() => {
    if (goes) go();
  }, [goes]);

  return (
    <form
      className="flex min-h-0 flex-col"
      data-zerops-surface="new-mate-form"
      onSubmit={(event) => {
        event.preventDefault();
        press();
      }}
    >
      <DialogHeader>
        {/* Refused, it leads with why: never a title promising a form it then takes back. */}
        <DialogTitle>{newMateDoorTitle(groupName, closed)}</DialogTitle>
        {closed === undefined ? (
          <p className="text-sm text-muted-foreground">Works on this project only.</p>
        ) : null}
      </DialogHeader>
      {/* Why the project takes no Mate now, where it takes none: its room opens as the form
          gives its own back below, so the dialog's height follows in one move. */}
      <div
        className={ROOM_CLASS}
        style={{ gridTemplateRows: closed === undefined ? "0fr" : ROOM_OPEN }}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={cn(
              "px-6 pt-1 pb-6 text-pretty transition-[opacity,visibility] ease-out",
              // The form is gone before the reason shows: never both at once.
              closed === undefined ? "invisible opacity-0 duration-100" : "delay-100 duration-200",
            )}
          >
            <DialogDescription>{closed?.reason ?? reason}</DialogDescription>
          </div>
        </div>
      </div>
      {/* While the project takes no Mate the form gives its room back, easing shut rather than
          leaving a blank under the reason: a grid row from 1fr to 0fr, so the dialog's height
          follows without a measurement. It stays mounted, out of sight and out of reach, keeping
          what was typed and picked for a door that opens again. */}
      <div
        className={ROOM_CLASS}
        style={{ gridTemplateRows: closed === undefined ? ROOM_OPEN : "0fr" }}
      >
        <div className="min-h-0 overflow-hidden">
          <DialogPanel>
            <div
              className={cn(
                "flex flex-col gap-5 transition-[opacity,visibility] ease-out",
                closed === undefined
                  ? "delay-100 duration-200"
                  : "invisible opacity-0 duration-100",
              )}
              inert={closed !== undefined}
            >
              <MateFacePicker
                face={face}
                onPickShape={(shape) => {
                  setPicked((current) => ({ ...current, shape }));
                }}
                onPickTint={(tint) => {
                  setPicked((current) => ({ ...current, tint }));
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${id}-name`}>Name</Label>
                  <MateNameInput
                    describedBy={`${id}-line`}
                    id={`${id}-name`}
                    invalid={refused !== undefined}
                    label="Name"
                    onAnother={
                      proposeAnotherName === undefined
                        ? undefined
                        : () => {
                            name(proposeAnotherName(bot));
                          }
                    }
                    onValueChange={name}
                    value={botName}
                  />
                </div>
              </MateFacePicker>
              {!offersAutomated ? null : (
                <div
                  className="flex items-start justify-between gap-4"
                  data-zerops-surface="new-mate-automated"
                >
                  <div className="grid min-w-0 gap-1">
                    <Label htmlFor={`${id}-automated`}>Automated</Label>
                    <p className="text-sm text-muted-foreground" id={`${id}-automated-line`}>
                      {NEW_MATE_AUTOMATED_LINE}
                    </p>
                    {keyNote === null && !holdsKeyNote ? null : (
                      // One cell: a note held from the first frame lands in the room the
                      // longest one it can be takes, so nothing under it moves.
                      <div
                        className="grid"
                        data-zerops-new-mate-key-note={holdsKeyNote ? "held" : "shown"}
                      >
                        {holdsKeyNote ? (
                          <p aria-hidden className="invisible col-start-1 row-start-1 text-sm">
                            {NEW_MATE_NO_KEY_LINE}{" "}
                            {automation?.admin === true
                              ? "Set it in Settings › Zerops"
                              : NEW_MATE_KEY_SETTER_LINE}
                          </p>
                        ) : null}
                        {keyNote === null ? null : (
                          <p
                            className="col-start-1 row-start-1 text-sm text-muted-foreground"
                            data-zerops-new-mate-no-key=""
                          >
                            {keyNote.kind === "update" ? (
                              NEW_MATE_UPDATE_HQ_LINE
                            ) : (
                              <>
                                {NEW_MATE_NO_KEY_LINE}{" "}
                                {!keyNote.canSet ? (
                                  NEW_MATE_KEY_SETTER_LINE
                                ) : onOpenKeySettings === undefined ? (
                                  "Set it in Settings › Zerops."
                                ) : (
                                  <InlineButton onClick={onOpenKeySettings} type="button">
                                    Set it in Settings › Zerops
                                  </InlineButton>
                                )}
                              </>
                            )}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <Switch
                    aria-describedby={`${id}-automated-line`}
                    checked={automated}
                    disabled={automatedUnavailable}
                    id={`${id}-automated`}
                    onCheckedChange={setAutomated}
                  />
                </div>
              )}
              {/* What happens once it is added, both ways the project may read: learning it has
                  nothing to deploy changes the words and moves nothing. */}
              <WhatHappensNext
                versions={[
                  {
                    key: "recipe",
                    next: newMateNext({ groupName, botName, recipe: "recipe", automated }),
                    shown: recipe !== "none",
                  },
                  {
                    key: "none",
                    next: newMateNext({ groupName, botName, recipe: "none", automated }),
                    shown: recipe === "none",
                  },
                ]}
              />
              {access === undefined ? null : access(setUserRoles)}
              {forecast}
              <p className="text-sm text-muted-foreground" data-zerops-mate-cost="">
                {newMateCost(botName)}{" "}
                <InlineButton
                  render={<a href={ZEROPS_PRICING_URL} rel="noreferrer" target="_blank" />}
                >
                  Zerops pricing
                </InlineButton>
              </p>
            </div>
          </DialogPanel>
        </div>
      </div>
      <DialogFooter>
        {/* The one quiet line, beside the button it is about: what Add waits on, or why it
            refused. The footer holds its room. */}
        <p
          aria-live="polite"
          className={cn(
            "me-auto min-h-4 self-center text-line leading-4",
            error === undefined ? "text-muted-foreground" : "text-status-failed-text",
          )}
          id={`${id}-line`}
        >
          {line}
        </p>
        {closed === undefined ? (
          <>
            <Button onClick={onCancel} type="button" variant="ghost">
              Cancel
            </Button>
            <Button aria-busy={waiting || undefined} disabled={waiting} type="submit">
              {words.button}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onCancel} type="button" variant="ghost">
              Close
            </Button>
            {/* Where Add stood: the one thing to do about it, where there is one. */}
            {action === undefined ? null : (
              <Button
                aria-busy={(action.kind === "retry" && action.busy) || undefined}
                disabled={action.kind === "retry" && action.busy}
                onClick={() => {
                  onDoorAction?.(action);
                }}
                type="button"
              >
                {action.label}
              </Button>
            )}
          </>
        )}
      </DialogFooter>
    </form>
  );
}
