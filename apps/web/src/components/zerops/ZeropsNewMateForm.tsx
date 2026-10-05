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
import type { TakenBotNames } from "@t3tools/client-runtime/zerops/projections";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { useEffect, useEffectEvent, useId, useState } from "react";

import { Button } from "../ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "../ui/dialog";
import { Label } from "../ui/label";
import { cn } from "~/lib/utils";
import {
  faceName,
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
import { WhatHappensNext } from "./WhatHappensNext";
import { newMateNext } from "./whatHappensNext.logic";

/** What the form hands over: the Mate's own name, which its project's is built from, the recipe and the face. */
export interface NewMateChoice {
  readonly name: string;
  readonly recipe: EnvironmentRecipeChoice;
  readonly face: ZeropsMateFace;
}

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
}

/** A room that opens and gives itself back in one move: a grid row from 0fr to 1fr. */
const ROOM_CLASS =
  "grid transition-[grid-template-rows] duration-200 ease-(--ease-out-strong) motion-reduce:transition-none";

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
}: ZeropsNewMateFormProps) {
  const id = useId();
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
    onCreate({ name: bot, recipe: choice, face });
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
        <DialogTitle>{`New Mate on ${groupName}`}</DialogTitle>
      </DialogHeader>
      {/* Why the project takes no Mate now, where it takes none: its room opens as the form
          gives its own back below, so the dialog's height follows in one move. */}
      <div
        className={ROOM_CLASS}
        style={{ gridTemplateRows: closed === undefined ? "0fr" : "1fr" }}
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
        style={{ gridTemplateRows: closed === undefined ? "1fr" : "0fr" }}
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
              {/* What happens once it is added, both ways the project may read: learning it has
                  nothing to deploy changes the words and moves nothing. */}
              <WhatHappensNext
                versions={[
                  {
                    key: "recipe",
                    next: newMateNext({ groupName, botName, recipe: "recipe" }),
                    shown: recipe !== "none",
                  },
                  {
                    key: "none",
                    next: newMateNext({ groupName, botName, recipe: "none" }),
                    shown: recipe === "none",
                  },
                ]}
              />
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
