/**
 * The New Mate dialog: who the new Mate is, and nothing else.
 *
 * It asks three things — a name, a colour and a shape — and shows the face they make, big, while
 * they are picked: the person sees who they are making. Everything else is decided for them. The
 * Mate gets its own copy of the project with the project's recipe deployed (the tier read from
 * the group repo's `main`), runs its agent, and is called what the project calls its Mates
 * (`proposedEnvironmentName`). A project with no recipe on main and no Mate yet still gets its
 * first, with nothing in it yet, and the description says so in plain words.
 *
 * A project that takes no Mate now — its Mates have not written its recipe yet, or it cannot be
 * read (`newMateDoor`) — gets no form: the description says why, and the one thing to do about it
 * stands where Add stood. The form keeps its room out of sight and out of reach, so the title and
 * the buttons stay where they stood when the door shuts after the recipe is read.
 *
 * Until its person picks, the face follows the name as it is typed: the tint the account would
 * give that name (`newMateTint`, which never takes a tint another Mate wears) and that tint's
 * shape. A pick sticks. The face is written onto the project at birth (`mate:face:`), so the Mate
 * wears it everywhere from its first moment.
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
import { Input } from "../ui/input";
import { cn } from "~/lib/utils";
import {
  faceName,
  newMateDescription,
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

/** What the form hands over: the environment's name, its agent's, the recipe and the face. */
export interface NewMateChoice {
  readonly name: string;
  readonly botName: string;
  readonly recipe: EnvironmentRecipeChoice;
  readonly face: ZeropsMateFace;
}

export interface ZeropsNewMateFormProps {
  readonly groupName: string;
  /** The name proposed for it, free on the account (`generateBotName`). */
  readonly defaultBotName: string;
  /** What the project calls a Mate of this name: `Acme Docs - Quinn`, numbered when taken. */
  readonly proposeName: (botName: string) => string;
  /** The account's Mates' names, and whether the listing read them all (`takenBotNames`). */
  readonly takenBotNames: TakenBotNames;
  /** The tier read from the group repo's `main`, when one is merged. */
  readonly tier: Extract<EnvironmentRecipeChoice, { kind: "tier" }> | undefined;
  /** True while the group repo is still being read. */
  readonly tierLoading: boolean;
  /** The tint the account gives a new Mate of this name (`newMateTint`). */
  readonly defaultTintFor: (name: string) => MateTintId;
  /**
   * Add went through and the platform is being asked for the Mate's project: a second, and the
   * person lands on the new Mate. Nothing is pressed twice or closed half way meanwhile.
   */
  readonly adding?: boolean | undefined;
  /** Why the platform refused the last Add, before it took any project; Add tries again. */
  readonly addError?: string | undefined;
  /** Why the project takes no Mate now, and what to do about it (`newMateDoor`): no form. */
  readonly closed?: NewMateDoorClosed | undefined;
  /** The one thing to do while the project takes no Mate, pressed. */
  readonly onDoorAction?: ((action: NewMateDoorAction) => void) | undefined;
  readonly onCancel: () => void;
  readonly onCreate: (choice: NewMateChoice) => void;
}

export function ZeropsNewMateForm({
  groupName,
  defaultBotName,
  proposeName,
  takenBotNames,
  tier,
  tierLoading,
  defaultTintFor,
  adding = false,
  addError,
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
  const [selected, setSelected] = useState(false);
  // A press waiting on the recipe is dropped once the project is read as taking no Mate: were the
  // door to open later, Add goes only when pressed again.
  if (closed !== undefined && pressedFor !== null) setPressedFor(null);
  // The last reason said: it keeps its room, and fades with its words, after the door opens.
  const [reason, setReason] = useState(closed?.reason);
  if (closed !== undefined && closed.reason !== reason) setReason(closed.reason);

  const face = newMateFace({
    name: faceName(botName, heldName),
    picked,
    defaultTint: defaultTintFor,
  });
  const recipe = newMateRecipe({ tier, tierLoading });
  const submit = newMateSubmit({ botName, takenBotNames, tier, tierLoading });
  const waiting = pressedFor !== null && submit.kind === "wait";
  const words = newMateWords({
    groupName,
    botName,
    recipe,
    waitingOn: submit.kind === "wait" && waiting ? submit.on : null,
  });
  const refused = pressed && submit.kind === "refuse" ? submit.error : undefined;
  const error = closed === undefined ? (refused ?? addError) : undefined;
  const bot = botName.replace(/\s+/g, " ").trim();
  const action = closed?.action;
  const line =
    closed !== undefined
      ? action?.kind === "retry" && action.busy
        ? READING_RECIPE
        : undefined
      : adding
        ? `Adding ${bot}…`
        : (error ?? words.line);

  const create = (choice: EnvironmentRecipeChoice) => {
    onCreate({ name: proposeName(bot), botName: bot, recipe: choice, face });
  };
  const press = () => {
    if (adding || closed !== undefined) return;
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

  const sayings = [
    {
      key: "recipe",
      text: newMateDescription({ groupName, botName, recipe: "recipe" }),
      shown: closed === undefined && recipe !== "none",
    },
    {
      key: "none",
      text: newMateDescription({ groupName, botName, recipe: "none" }),
      shown: closed === undefined && recipe === "none",
    },
    { key: "closed", text: closed?.reason ?? reason, shown: closed !== undefined },
  ];

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
        <DialogTitle>New Mate</DialogTitle>
        <DialogDescription>
          {/* Every saying holds one room, so learning the project has no recipe, or takes no
              Mate, moves nothing. */}
          <span className="grid">
            {sayings.map(({ key, text, shown }) => (
              <span
                aria-hidden={shown ? undefined : true}
                className={cn(
                  "col-start-1 row-start-1 text-pretty transition-[opacity,visibility] ease-out",
                  // The one leaving is gone before the one arriving shows: never both at once.
                  shown ? "delay-100 duration-200" : "invisible opacity-0 duration-100",
                )}
                key={key}
              >
                {text}
              </span>
            ))}
          </span>
        </DialogDescription>
      </DialogHeader>
      {/* While the project takes no Mate the form gives its room back, easing shut rather than
          leaving a blank under the reason: a grid row from 1fr to 0fr, so the dialog's height
          follows without a measurement. It stays mounted, out of sight and out of reach, keeping
          what was typed and picked for a door that opens again. */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-(--ease-out-strong) motion-reduce:transition-none"
        style={{ gridTemplateRows: closed === undefined ? "1fr" : "0fr" }}
      >
        <div className="min-h-0 overflow-hidden">
          <DialogPanel>
            <div
              className={cn(
                "transition-[opacity,visibility] ease-out",
                closed === undefined
                  ? "delay-100 duration-200"
                  : "invisible opacity-0 duration-100",
              )}
              inert={closed !== undefined}
            >
              <MateFacePicker
                face={face}
                onPickShape={(shape) => {
                  if (!adding) setPicked((current) => ({ ...current, shape }));
                }}
                onPickTint={(tint) => {
                  if (!adding) setPicked((current) => ({ ...current, tint }));
                }}
              >
                <Input
                  aria-describedby={`${id}-line`}
                  aria-invalid={refused === undefined ? undefined : true}
                  aria-label="Name"
                  autoComplete="off"
                  onChange={(event) => {
                    const typed = event.target.value;
                    setBotName(typed);
                    setPressedFor(null);
                    const name = typed.replace(/\s+/g, " ").trim();
                    if (name.length > 0) setHeldName(name);
                  }}
                  onFocus={(event) => {
                    // The proposed name is taken whole by the first key typed over it.
                    if (selected) return;
                    setSelected(true);
                    event.currentTarget.select();
                  }}
                  // While the platform takes the Mate's project, what made it stays as it was: the
                  // name reads, and nothing typed or picked changes the Mate on its way.
                  readOnly={adding}
                  placeholder="Name"
                  size="lg"
                  spellCheck={false}
                  value={botName}
                />
              </MateFacePicker>
            </div>
          </DialogPanel>
        </div>
      </div>
      <DialogFooter>
        {/* The one quiet line, beside the button it is about: what Add waits on, why it
            refused, or that there is no recipe to deploy. The footer holds its room. */}
        <p
          aria-live="polite"
          className={cn(
            "me-auto min-h-4 self-center text-line leading-4",
            adding || error === undefined ? "text-muted-foreground" : "text-status-failed-text",
          )}
          id={`${id}-line`}
        >
          {line}
        </p>
        {closed === undefined ? (
          <>
            <Button disabled={adding} onClick={onCancel} type="button" variant="ghost">
              Cancel
            </Button>
            <Button
              aria-busy={waiting || adding || undefined}
              disabled={waiting || adding}
              type="submit"
            >
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
