/**
 * The New Mate dialog: who the new Mate is, as the New project page's Mate step asks it
 * (`ZeropsNewProjectPage`, pen.dev v4WZU): its face big, the colours and shapes opening as a ring
 * around it (*Edit style*, `MateFaceRing`), its name, typed in place (`MateNameText`), *Shuffle style* rolling a new face and name, and
 * Add. *Mate access & persona setup* opens how it works with its person (`NewMatePersona`) and who can
 * work with it, under the rest, the dialog scrolling down to them. Everything else is decided for them. The Mate gets its own copy of the project
 * with the project's recipe deployed (the tier read from the group repo's `main`), runs its agent,
 * and is called what the project calls its Mates (`proposedEnvironmentName`). A project with no
 * recipe on main and no Mate yet still gets its first, with nothing in it yet.
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
import type { MatePersona } from "@t3tools/contracts";
import type { ProjectGrant } from "@t3tools/client-runtime/zerops/projectAccess";
import type { TakenBotNames } from "@t3tools/client-runtime/zerops/projections";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { CheckIcon, ChevronDownIcon, PencilIcon, ShuffleIcon } from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Button } from "../ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { prefersReducedMotion } from "~/lib/reducedMotion";
import { cn } from "~/lib/utils";
import {
  faceName,
  newMateDoorTitle,
  newMateFace,
  newMateRecipe,
  newMateWords,
  offeredBotName,
  READING_RECIPE,
} from "./ZeropsEnvironmentCreationDialog.logic";
import {
  type NewMateDoorAction,
  type NewMateDoorClosed,
  type NewMateRecipe,
} from "@t3tools/client-runtime/zerops/newMateDoor";
import { NewMatePersona } from "../persona/NewMatePersona";
import { MateFaceRing } from "./MateFacePicker";
import { MateNameText } from "./MateNameText";
import type { ProjectAccessSlot } from "./projects/ProjectAccessChips";
import { PressLine } from "./PressLine";
import { useMateShuffle } from "./useMateShuffle";

/** What the form hands over: the Mate's own name, which its project's is built from, the recipe and the face. */
interface NewMateChoice {
  readonly name: string;
  readonly recipe: EnvironmentRecipeChoice;
  readonly face: ZeropsMateFace;
  /** Who reaches its project beyond their organization role, as chosen in the form. */
  readonly userRoles?: ReadonlyArray<ProjectGrant>;
  /** How it works with its person, from the start: its stand-up already runs with it. */
  readonly persona?: MatePersona;
}

interface ZeropsNewMateFormProps {
  readonly groupName: string;
  /** The name to propose, offered once the account's names vouch for it. */
  readonly defaultBotName: string;
  /** The name an Add started over was asked with: the person's own, never swapped. */
  readonly askedBotName?: string | undefined;
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
  askedBotName,
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
}: ZeropsNewMateFormProps) {
  const id = useId();
  const [userRoles, setUserRoles] = useState<ReadonlyArray<ProjectGrant>>([]);
  const [persona, setPersona] = useState<MatePersona | null>(null);
  const [typed, setTyped] = useState<string | null>(askedBotName ?? null);
  const [proposal, setProposal] = useState(defaultBotName);
  // The last name typed: a blank field keeps the face it had rather than flashing another.
  const [heldName, setHeldName] = useState(askedBotName ?? defaultBotName);
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

  const offered = offeredBotName({
    typed,
    proposal,
    appName: groupName,
    takenBotNames,
    tier,
    tierLoading,
    another: proposeAnotherName,
  });
  // A proposal swapped under a waiting press is not the name that was pressed: the press lets go.
  if (offered.proposal !== proposal) {
    setProposal(offered.proposal);
    setPressedFor(null);
  }
  const { botName, submit } = offered;

  const face = newMateFace({
    name: faceName(botName, heldName),
    picked,
    defaultTint: defaultTintFor,
    defaultShape: defaultShapeFor,
  });
  const recipe = newMateRecipe({ tier, tierLoading });
  const bot = botName.replace(/\s+/g, " ").trim();
  const waiting = pressedFor !== null && submit.kind === "wait";
  const words = newMateWords({
    groupName,
    botName,
    recipe,
    // Pressed with no name yet: it says what it waits on, and the person presses the name it offers.
    waitingOn: submit.kind === "wait" && (waiting || (pressed && bot === "")) ? submit.on : null,
  });
  const refused = pressed && submit.kind === "refuse" ? submit.error : undefined;
  const error = closed === undefined ? refused : undefined;
  const action = closed?.action;
  const line =
    closed !== undefined
      ? action?.kind === "retry" && action.busy
        ? READING_RECIPE
        : undefined
      : (error ?? words.line);

  const name = (value: string) => {
    setTyped(value);
    setPressedFor(null);
    const called = value.replace(/\s+/g, " ").trim();
    if (called.length > 0) setHeldName(called);
  };
  const create = (choice: EnvironmentRecipeChoice) => {
    onCreate({
      name: bot,
      recipe: choice,
      face,
      ...(userRoles.length === 0 ? {} : { userRoles }),
      ...(persona === null ? {} : { persona }),
    });
  };
  const press = () => {
    if (closed !== undefined) return;
    setPressed(true);
    if (submit.kind === "create") create(submit.recipe);
    else setPressedFor(submit.kind === "wait" && bot !== "" ? recipe : null);
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

  // *Mate access & persona setup* open: the persona and who can work with it, under the Mate.
  const [options, setOptions] = useState(false);
  // *Edit style* open: the colours and shapes stand as a ring around the face.
  const [styling, setStyling] = useState(false);
  const optionsRoom = useOptionsGlide(options);
  const shuffle = useMateShuffle({
    name: bot,
    pickTint: (tint) => {
      setPicked((current) => ({ ...current, tint }));
    },
    pickShape: (shape) => {
      setPicked((current) => ({ ...current, shape }));
    },
    // A rolled name is a proposal, as the die's was: never the person's typed one.
    setName: (next) => {
      setProposal(next);
      setTyped(null);
      setPressedFor(null);
    },
    // Until every name is read no proposal is offered, so the roll keeps the name.
    proposeAnotherName: takenBotNames.complete ? proposeAnotherName : undefined,
  });

  return (
    // As wide as the dialog, so its options can stand 24 px from the dialog's edges whatever
    // the scrollbar's gutter takes (100cqw against the body's 100%).
    <form
      className="@container flex min-h-0 flex-col"
      data-options={options ? "" : undefined}
      data-zerops-surface="new-mate-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!shuffle.rolling) press();
      }}
    >
      <DialogHeader>
        {/* Refused, it leads with why: never a title promising a form it then takes back. */}
        <DialogTitle>{newMateDoorTitle(groupName, closed)}</DialogTitle>
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
              "px-6 pt-1 pb-6 text-pretty transition-[opacity,visibility] ease-out-strong",
              // The form is gone before the reason shows: never both at once.
              closed === undefined ? "invisible opacity-0 duration-150" : "delay-100 duration-200",
            )}
          >
            <DialogDescription>{closed?.reason ?? reason}</DialogDescription>
          </div>
        </div>
      </div>
      {/* While the project takes no Mate the form gives its room back, easing shut rather than
          leaving a blank under the reason: a grid row from 1fr to 0fr, so the dialog's height
          follows without a measurement. It stays mounted, out of sight and out of reach, keeping
          what was picked for a door that opens again. */}
      <div
        className={ROOM_CLASS}
        style={{ gridTemplateRows: closed === undefined ? ROOM_OPEN : "0fr" }}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={cn(
              // The scrollbar the open options bring takes no width: nothing moves sideways.
              "scrollbar-gutter-both max-h-full overflow-y-auto overscroll-contain transition-[opacity,visibility] ease-out-strong",
              closed === undefined ? "delay-100 duration-200" : "invisible opacity-0 duration-150",
            )}
            inert={closed !== undefined}
          >
            {/* The face ring, the name and its two presses, centred. */}
            <div className="flex flex-col items-center px-6 pb-8">
              <MateFaceRing
                className="my-3"
                face={face}
                onPickShape={(shape) => {
                  setPicked((current) => ({ ...current, shape }));
                }}
                onPickTint={(tint) => {
                  setPicked((current) => ({ ...current, tint }));
                }}
                open={styling}
                size="dialog"
              />
              {/* The Mate's name, at the headline's size, cut to one line. */}
              <p className="m-0 max-w-full truncate text-display tracking-tight text-foreground">
                <MateNameText
                  describedBy={`${id}-line`}
                  invalid={refused !== undefined}
                  onValueChange={name}
                  value={botName}
                />
              </p>
              <div className="mt-4 flex justify-center gap-1">
                <Button
                  aria-busy={shuffle.rolling || undefined}
                  onClick={shuffle.roll}
                  size="md"
                  type="button"
                  variant="secondary"
                >
                  <ShuffleIcon aria-hidden />
                  Shuffle style
                </Button>
                <Button
                  aria-expanded={styling}
                  onClick={() => {
                    setStyling(!styling);
                  }}
                  size="md"
                  type="button"
                  variant="secondary"
                >
                  {styling ? <CheckIcon aria-hidden /> : <PencilIcon aria-hidden />}
                  {styling ? "Confirm style" : "Edit style"}
                </Button>
              </div>
            </div>
            {/* The options open as a glide, the dialog growing with them (`useOptionsGlide`),
                their words fading in behind it. */}
            <div
              className="group/room max-h-0 overflow-hidden transition-[max-height] duration-260 ease-in-out-strong motion-reduce:transition-none"
              data-open={options ? "" : undefined}
              ref={optionsRoom}
            >
              <div className="min-h-0 overflow-hidden" inert={!options}>
                <div className="mx-[calc(24px-(100cqw-100%)/2)] pb-2 opacity-0 transition-opacity duration-200 ease-out-strong group-data-open/room:opacity-100 group-data-open/room:delay-200 group-data-open/room:duration-260">
                  <NewMatePersona mate={bot} onChange={setPersona} persona={persona} />
                  {/* Who can work with it: 20 px under the persona's rule, its press 20 px under
                      its line. */}
                  {access === undefined ? null : (
                    <div className="*:mt-5 *:gap-5">{access(setUserRoles, bot)}</div>
                  )}
                </div>
              </div>
            </div>
            {forecast}
          </div>
        </div>
      </div>
      {closed === undefined ? (
        // The line saying what Add does over the press, a rule above while the options show.
        <div
          className={cn(
            "flex flex-col gap-2.5 px-6 py-4",
            options ? "border-t border-border" : undefined,
          )}
        >
          <Button
            aria-busy={waiting || undefined}
            className="w-full"
            disabled={waiting || shuffle.rolling}
            size="lg"
            type="submit"
          >
            {words.button}
          </Button>
          {/* The one quiet line under the button it is about: what Add waits on, or why it
              refused. Saying nothing, it gives the foot's gap back. */}
          <PressLine
            className="text-center empty:-mt-2.5"
            id={`${id}-line`}
            refusal={error}
            waiting={error === undefined ? line : undefined}
          />
          <Button
            aria-expanded={options}
            className="w-full"
            onClick={() => {
              setStyling(false);
              setOptions(!options);
            }}
            size="lg"
            type="button"
            variant="ghost-muted"
          >
            {options ? "Close" : "Mate access & persona setup"}
            <ChevronDownIcon
              aria-hidden
              className={cn(
                "transition-[rotate] duration-200 ease-out-strong",
                options ? "rotate-180" : undefined,
              )}
            />
          </Button>
        </div>
      ) : (
        <DialogFooter>
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
          <PressLine className="sr-only" id={`${id}-line`} waiting={line} />
        </DialogFooter>
      )}
    </form>
  );
}

/**
 * The options' room opening and shutting as one glide of the dialog. It grows only as far as the
 * dialog can (the window's room), then lets go, the rest scrolled to: a glide to the options' whole
 * height would spend its first frames reaching the window's edge and stand still after, a jump.
 * Shutting, it leaves from what shows.
 */
function useOptionsGlide(open: boolean) {
  const room = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useLayoutEffect(() => {
    const element = room.current;
    if (element === null) return;
    if (first.current || prefersReducedMotion()) {
      first.current = false;
      element.style.maxHeight = open ? "none" : "0px";
      return;
    }
    const body = element.parentElement;
    const popup = element.closest<HTMLElement>("[data-slot=dialog-popup]");
    let to: number;
    if (open) {
      const free = window.innerHeight - (popup?.getBoundingClientRect().height ?? 0) - 48;
      to = Math.max(0, Math.min(element.scrollHeight, free));
      element.style.maxHeight = "0px";
    } else {
      body?.scrollTo({ top: 0 });
      const shown =
        (body?.getBoundingClientRect().bottom ?? 0) - element.getBoundingClientRect().top;
      element.style.maxHeight = `${String(Math.max(0, Math.min(element.offsetHeight, shown)))}px`;
      to = 0;
    }
    void element.offsetHeight;
    element.style.maxHeight = `${String(to)}px`;
    const settle = (event: TransitionEvent) => {
      if (event.target !== element || event.propertyName !== "max-height") return;
      if (open) element.style.maxHeight = "none";
    };
    element.addEventListener("transitionend", settle);
    return () => element.removeEventListener("transitionend", settle);
  }, [open]);
  return room;
}
