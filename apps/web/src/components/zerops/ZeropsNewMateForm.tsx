/**
 * The New Mate dialog: who the new Mate is, and nothing else.
 *
 * It asks three things — a name, a colour and a shape — and shows the face they make, big, while
 * they are picked: the person sees who they are making. Everything else is decided for them. The
 * Mate gets its own copy of the project with the project's recipe deployed (the tier read from
 * the group repo's `main`), runs its agent, and is called what the project calls its Mates
 * (`proposedEnvironmentName`). A project with no recipe on main still gets its Mate, with nothing
 * in it yet, and the description says so in plain words.
 *
 * Until its person picks, the face follows the name as it is typed: the tint the account would
 * give that name (`newMateTint`, which never takes a tint another Mate wears) and that tint's
 * shape. A pick sticks. The face is written onto the project at birth (`mate:face:`), so the Mate
 * wears it everywhere from its first moment.
 */
import type { EnvironmentRecipeChoice, ZeropsMateFace } from "@t3tools/client-runtime/zerops";
import type { TakenBotNames } from "@t3tools/client-runtime/zerops/projections";
import {
  MATE_SHAPE_IDS,
  MATE_SHAPES,
  MATE_TINT_IDS,
  type MateShapeId,
  type MateTintId,
} from "@t3tools/shared/brand";
import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

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
  type NewMateRecipe,
} from "./ZeropsEnvironmentCreationDialog.logic";
import { MateFace } from "./primitives";

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
  readonly onCancel: () => void;
  readonly onCreate: (choice: NewMateChoice) => void;
}

/** The colours and the shapes by the words a screen reader says for them. */
const TINT_WORDS: Record<MateTintId, string> = {
  coral: "Coral",
  amber: "Amber",
  olive: "Olive",
  sky: "Sky",
  violet: "Violet",
  rose: "Rose",
  sand: "Sand",
  slate: "Slate",
};

const SHAPE_WORDS: Record<MateShapeId, string> = {
  squircle: "Squircle",
  gem: "Gem",
  hexagon: "Hexagon",
  pentagon: "Pentagon",
  clover: "Clover",
  flower: "Flower",
  seal: "Seal",
  pick: "Guitar pick",
};

/** A tint as the stylesheet reads it: the palette's own token, so both themes hold. */
function tintStyle(tint: MateTintId): CSSProperties {
  return { "--new-mate-tint": `var(--zerops-mate-tint-${tint})` } as CSSProperties;
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
  const error = refused ?? addError;
  const bot = botName.replace(/\s+/g, " ").trim();
  const line = adding ? `Adding ${bot}…` : (error ?? words.line);

  const create = (choice: EnvironmentRecipeChoice) => {
    onCreate({ name: proposeName(bot), botName: bot, recipe: choice, face });
  };
  const press = () => {
    if (adding) return;
    setPressed(true);
    if (submit.kind === "create") create(submit.recipe);
    else setPressedFor(submit.kind === "wait" ? recipe : null);
  };

  // The reads a press waited on have arrived: it goes, unless the recipe it was pressed for is
  // not there — a project read as having no recipe after Add was pressed for one with it says
  // so, and waits for another press. A name refused meanwhile is said instead.
  const goes =
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
        <DialogTitle>New Mate</DialogTitle>
        <DialogDescription>
          {/* Both sayings hold one room, so learning the project has no recipe moves nothing. */}
          <span className="grid">
            {(["recipe", "none"] as const).map((saying) => (
              <span
                className={cn(
                  "col-start-1 row-start-1 text-pretty transition-[opacity,visibility] ease-out",
                  // The one leaving is gone before the one arriving shows: never both at once.
                  (saying === "none") !== (recipe === "none")
                    ? "invisible opacity-0 duration-100"
                    : "delay-100 duration-200",
                )}
                key={saying}
              >
                {newMateDescription(groupName, saying)}
              </span>
            ))}
          </span>
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        {/* The face beside what makes it; on a phone, over it. */}
        <div className="flex items-center gap-6 max-sm:flex-col max-sm:gap-4">
          <FacePreview face={face} />
          <div className="flex w-full min-w-0 flex-1 flex-col gap-3.5">
            <Input
              aria-describedby={`${id}-line`}
              aria-invalid={error === undefined ? undefined : true}
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
              placeholder="Name"
              size="lg"
              spellCheck={false}
              value={botName}
            />
            <div className="flex flex-col gap-0.5">
              <PickerRow
                label="Color"
                onPick={(tint) => {
                  setPicked((current) => ({ ...current, tint }));
                }}
                optionStyle={tintStyle}
                options={MATE_TINT_IDS}
                value={face.tint}
                words={TINT_WORDS}
              >
                {() => (
                  <>
                    <circle className="new-mate-ring" cx="18" cy="18" r="15.5" />
                    <circle className="new-mate-mark" cx="18" cy="18" r="12" />
                  </>
                )}
              </PickerRow>
              <PickerRow
                label="Shape"
                onPick={(shape) => {
                  setPicked((current) => ({ ...current, shape }));
                }}
                optionStyle={() => tintStyle(face.tint)}
                options={MATE_SHAPE_IDS}
                value={face.shape}
                words={SHAPE_WORDS}
              >
                {(shape) => (
                  <>
                    {/* Its own outline a gap out: the ring runs parallel to every shape. */}
                    <path
                      className="new-mate-ring"
                      d={MATE_SHAPES[shape].d}
                      transform="translate(1 1) scale(0.34)"
                    />
                    <path
                      className="new-mate-mark"
                      d={MATE_SHAPES[shape].d}
                      transform="translate(5 5) scale(0.26)"
                    />
                  </>
                )}
              </PickerRow>
            </div>
          </div>
        </div>
      </DialogPanel>
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
      </DialogFooter>
    </form>
  );
}

/**
 * One row of a face's pickers: a radio group of real buttons. One stop for Tab — the one picked —
 * and the arrow keys walk the row, picking as they go, as a radio group does. Kept by hand rather
 * than a kit's roving focus, whose stop stays where it started when the pick changes from outside
 * the row: the shape follows the colour until one is picked, and the colour follows the name.
 */
function PickerRow<T extends string>({
  label,
  options,
  value,
  words,
  optionStyle,
  onPick,
  children,
}: {
  readonly label: string;
  readonly options: ReadonlyArray<T>;
  readonly value: T;
  readonly words: Readonly<Record<T, string>>;
  /** The tint an option is drawn in. */
  readonly optionStyle: (option: T) => CSSProperties;
  readonly onPick: (option: T) => void;
  /** An option's mark and its ring, in a 36 px box. */
  readonly children: (option: T) => ReactNode;
}) {
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  const step = (from: T, by: number) => {
    const next = options[(options.indexOf(from) + by + options.length) % options.length];
    if (next === undefined) return;
    onPick(next);
    buttons.current.get(next)?.focus();
  };
  return (
    <div aria-label={label} className="flex justify-between" role="radiogroup">
      {options.map((option) => (
        <button
          aria-checked={option === value}
          aria-label={words[option]}
          className="new-mate-option focus-visible:ring-2 focus-visible:ring-ring"
          data-checked={option === value ? "" : undefined}
          key={option}
          onClick={() => {
            onPick(option);
          }}
          onKeyDown={(event) => {
            const by = ARROW_STEPS[event.key];
            if (by === undefined) return;
            event.preventDefault();
            step(option, by);
          }}
          ref={(node) => {
            if (node === null) buttons.current.delete(option);
            else buttons.current.set(option, node);
          }}
          role="radio"
          style={optionStyle(option)}
          tabIndex={option === value ? 0 : -1}
          type="button"
        >
          <svg aria-hidden="true" className="size-9" viewBox="0 0 36 36">
            {children(option)}
          </svg>
        </button>
      ))}
    </div>
  );
}

const ARROW_STEPS: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/**
 * The face being made, as its hero. A change crossfades: the face before fades out under the
 * new one, which settles from a touch smaller — so a colour or a shape picked, or a name typed,
 * reads as the same somebody turning into someone else rather than a picture swapped. The first
 * paint is still, and reduced motion keeps only the fade.
 */
function FacePreview({ face }: { readonly face: ZeropsMateFace }) {
  const [shown, setShown] = useState<{
    readonly face: ZeropsMateFace;
    readonly before: ZeropsMateFace | undefined;
    readonly turn: number;
  }>({ face, before: undefined, turn: 0 });
  if (shown.face.tint !== face.tint || shown.face.shape !== face.shape) {
    setShown({ face, before: shown.face, turn: shown.turn + 1 });
  }
  return (
    <span className="new-mate-face" data-zerops-surface="new-mate-face">
      {shown.before === undefined ? null : (
        <MateFace
          className="size-28"
          data-new-mate-face="out"
          key={`out-${shown.turn}`}
          onAnimationEnd={(event) => {
            if (event.target !== event.currentTarget) return;
            setShown((current) =>
              current.turn === shown.turn ? { ...current, before: undefined } : current,
            );
          }}
          shape={shown.before.shape}
          size="lg"
          state="idle"
          tint={shown.before.tint}
        />
      )}
      <MateFace
        className="size-28"
        data-new-mate-face={shown.turn === 0 ? undefined : "in"}
        key={`in-${shown.turn}`}
        shape={shown.face.shape}
        size="lg"
        state="idle"
        tint={shown.face.tint}
      />
    </span>
  );
}
