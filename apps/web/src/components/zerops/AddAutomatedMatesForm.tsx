/**
 * *Add automated Mates to <project>*: its own dialog, not New Mate with a switch. Automated Mates
 * belong to the organization — whoever sees the project sees them — so it asks nobody's access;
 * it asks how many (1–3), proposes each one's name and face (each re-rollable, each name
 * editable), says in one paragraph what they do — where their tasks come from, what they run on,
 * what a task may take — and what happens once they are added (`addAutomatedMates.logic.ts`).
 *
 * The faces row always holds three places, so choosing how many moves nothing below it; a Mate
 * added to the row fades in, the one change here a person made.
 */
import type { EnvironmentRecipeChoice, ZeropsMateFace } from "@t3tools/client-runtime/zerops";
import type { TakenBotNames } from "@t3tools/client-runtime/zerops/projections";
import type { MateTintId } from "@t3tools/shared/brand";
import type { HqTaskLimitsView } from "@t3tools/shared/hqIntake";
import { BotIcon } from "lucide-react";
import { useEffect, useEffectEvent, useId, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { KEEP_TAB_OPEN_LINE } from "~/zerops/mateArrival";
import { newMateKeyNote, type AutomatedKeyState } from "~/zerops/automatedMate.logic";

import { Button, InlineButton } from "../ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "../ui/dialog";
import { Label } from "../ui/label";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  AUTOMATED_COUNTS,
  addAutomatedButton,
  addAutomatedTitle,
  automatedCost,
  automatedFaces,
  automatedNames,
  automatedNext,
  automatedSubmit,
  automatedWhatTheyDo,
  type AutomatedSources,
} from "./addAutomatedMates.logic";
import { MateNameInput } from "./MateNameInput";
import { MateFace } from "./primitives";
import type { DraftPeople } from "./projects/accessDraft.logic";
import {
  CHECKING_NAMES,
  newMateRecipe,
  READING_RECIPE,
} from "./ZeropsEnvironmentCreationDialog.logic";
import { ZEROPS_PRICING_URL } from "./whatHappensNext.logic";

/** One automated Mate the form hands over: its name and its face. */
export interface AutomatedMateChoice {
  readonly name: string;
  readonly face: ZeropsMateFace;
}

/** What Add hands over: the Mates, the project's recipe, and the project's people for each. */
export interface AutomatedMatesChoice {
  readonly mates: ReadonlyArray<AutomatedMateChoice>;
  readonly recipe: EnvironmentRecipeChoice;
  readonly userRoles: ReadonlyArray<{ readonly clientUserId: string; readonly roleCode: string }>;
}

export interface AddAutomatedMatesFormProps {
  readonly groupName: string;
  /** The first Mate's name: an Add started over keeps it; else one proposed. */
  readonly firstName?: string | undefined;
  /** A name free on the account and among `taken` (`generateBotName`). */
  readonly propose: (taken: ReadonlyArray<string>) => string;
  readonly takenBotNames: TakenBotNames;
  /** The tint the account gives a new Mate of this name (`newMateTint`). */
  readonly tintFor: (name: string) => MateTintId;
  readonly tier: Extract<EnvironmentRecipeChoice, { kind: "tier" }> | undefined;
  readonly tierLoading: boolean;
  /** Where the project's tasks come from, as read (`automatedSourcesWords`). */
  readonly sources: AutomatedSources;
  /** Whether the organization holds the key they run on, and whether the viewer may set it. */
  readonly keyState: AutomatedKeyState;
  readonly admin: boolean;
  /** What one task may take, and the month's budget; `undefined` where not shown to the viewer. */
  readonly limits: HqTaskLimitsView | undefined;
  /**
   * The people who reach the project now, which every new Mate's project gets at their level there
   * (`useDraftPeople`): HQ shows a Mate to whoever its project's grants let read it.
   */
  readonly people: DraftPeople;
  /** Leaves the dialog for where the organization's key is set (Settings › Automation). */
  readonly onOpenKeySettings?: (() => void) | undefined;
  /** The line forecasting the credit wall before Add (`ZeropsCreditForecast`); absent, none. */
  readonly forecast?: ReactNode;
  /** Storage and notices for the repositories every new Mate will check out. */
  readonly repositories?: ReactNode;
  readonly onCancel: () => void;
  readonly onCreate: (choice: AutomatedMatesChoice) => void;
}

/** While the sources are read, the paragraph holds the room of a line-long sources sentence. */
const HELD_SOURCES: AutomatedSources = { kind: "withheld" };

const READING_PEOPLE = "Reading who reaches this project…";
const PEOPLE_FAILED = "Couldn't read who reaches this project. Close and try again.";
const UPDATE_HQ = "Update HQ to make automated Mates.";

export function AddAutomatedMatesForm(props: AddAutomatedMatesFormProps) {
  const { groupName, propose, takenBotNames, tier, tierLoading, people } = props;
  const key = props.keyState;
  const id = useId();
  const [names, setNames] = useState<ReadonlyArray<string>>(() =>
    automatedNames(props.firstName === undefined ? [] : [props.firstName], 1, propose),
  );
  // Add was pressed: what is wrong is said from then on, and a press waiting on a read goes once
  // it lands.
  const [pressed, setPressed] = useState(false);
  const [waitingPress, setWaitingPress] = useState(false);
  const count = names.length;
  const faces = automatedFaces(names, props.tintFor);
  const recipe = newMateRecipe({ tier, tierLoading });
  const submit = automatedSubmit({ names, appName: groupName, takenBotNames, tier, tierLoading });
  const unsupported = key === "unsupported";
  // Whether a key note may still land is decided by the first frame (the cardinal sin).
  const [holdsKeyNote] = useState(() => key === "unknown");

  const refused = pressed && submit.kind === "refuse" ? submit : undefined;
  const line =
    refused?.error ??
    (people.kind === "failed"
      ? PEOPLE_FAILED
      : unsupported
        ? UPDATE_HQ
        : !waitingPress
          ? undefined
          : submit.kind === "wait"
            ? submit.on === "names"
              ? CHECKING_NAMES
              : READING_RECIPE
            : people.kind === "reading"
              ? READING_PEOPLE
              : undefined);
  const failed = refused !== undefined || people.kind === "failed";

  const ready = submit.kind === "create" && people.kind === "ready" && !unsupported;
  const create = () => {
    if (submit.kind !== "create" || people.kind !== "ready") return;
    props.onCreate({
      mates: names.map((name, index) => ({
        name: name.replace(/\s+/g, " ").trim(),
        face: faces[index]!,
      })),
      recipe: submit.recipe,
      userRoles: people.userRoles,
    });
  };
  const press = () => {
    if (unsupported || people.kind === "failed") return;
    setPressed(true);
    if (ready) create();
    else setWaitingPress(submit.kind === "wait" || people.kind === "reading");
  };
  const go = useEffectEvent(create);
  const goes = waitingPress && ready;
  useEffect(() => {
    if (goes) go();
  }, [goes]);

  const rename = (index: number, name: string) => {
    setNames((current) => current.map((one, at) => (at === index ? name : one)));
    setWaitingPress(false);
  };
  const whatTheyDo = (keyState: AutomatedKeyState, sources: AutomatedSources = props.sources) => {
    const note = newMateKeyNote(keyState, props.admin);
    return (
      <>
        {automatedWhatTheyDo({
          count,
          sources,
          key: keyState,
          limits: props.limits,
        }).join(" ")}
        {note?.kind !== "missing" ? null : note.canSet ? (
          props.onOpenKeySettings === undefined ? (
            " Set it in Settings › Automation."
          ) : (
            <>
              {" "}
              <InlineButton onClick={props.onOpenKeySettings} type="button">
                Set it in Settings › Automation
              </InlineButton>
            </>
          )
        ) : (
          " An Owner or Admin of your organization sets it."
        )}
      </>
    );
  };

  return (
    <form
      className="flex min-h-0 flex-col"
      data-zerops-surface="add-automated-mates"
      onSubmit={(event) => {
        event.preventDefault();
        press();
      }}
    >
      <DialogHeader>
        <DialogTitle>{addAutomatedTitle(groupName)}</DialogTitle>
        <DialogDescription>
          They belong to the organization: whoever sees this project sees them.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-4">
            <Label id={`${id}-count`}>How many</Label>
            <ToggleGroup
              aria-labelledby={`${id}-count`}
              onValueChange={(next) => {
                const chosen = Number(next[0]);
                if (!AUTOMATED_COUNTS.some((one) => one === chosen)) return;
                setNames((current) => automatedNames(current, chosen, (taken) => propose(taken)));
                setWaitingPress(false);
              }}
              value={[String(count)]}
            >
              {AUTOMATED_COUNTS.map((one) => (
                <Toggle
                  aria-label={one === 1 ? "1 Mate" : `${String(one)} Mates`}
                  key={one}
                  value={String(one)}
                >
                  <span className="tabular-nums">{one}</span>
                </Toggle>
              ))}
            </ToggleGroup>
          </div>
          {/* Three places always: how many changes which are filled, never the height. */}
          <ul className="grid grid-cols-3 gap-3" data-zerops-automated-mates="">
            {AUTOMATED_COUNTS.map((place, index) => {
              const name = names[index];
              const face = faces[index];
              if (name === undefined || face === undefined)
                return <li aria-hidden className="invisible" key={place} />;
              return (
                <li
                  className={cn(
                    "flex min-w-0 flex-col items-center gap-2.5",
                    index > 0 && "animate-zerops-appear motion-reduce:animate-none",
                  )}
                  data-zerops-automated-mate={index}
                  key={place}
                >
                  <MateFace
                    className="size-14"
                    shape={face.shape}
                    size={64}
                    state="idle"
                    tint={face.tint}
                  />
                  <MateNameInput
                    describedBy={`${id}-line`}
                    id={`${id}-name-${String(index)}`}
                    invalid={refused?.index === index}
                    label={count === 1 ? "Name" : `Name ${String(index + 1)}`}
                    onAnother={() => {
                      rename(index, propose(names.filter((_one, at) => at !== index).concat(name)));
                    }}
                    onValueChange={(typed) => {
                      rename(index, typed);
                    }}
                    value={name}
                  />
                </li>
              );
            })}
          </ul>
          <section className="flex flex-col gap-1" aria-labelledby={`${id}-what`}>
            <h3
              className="flex items-center gap-1.5 text-xs leading-4 font-medium text-muted-foreground"
              id={`${id}-what`}
            >
              <BotIcon aria-hidden className="size-3.5" />
              What they do
            </h3>
            {/* A key note learned after the first frame lands in room held for it, and the
                sources in a line's height held for them: nothing under it moves. */}
            <div className="grid min-h-10 text-sm text-pretty">
              {holdsKeyNote ? (
                <p
                  aria-hidden
                  className="invisible col-start-1 row-start-1"
                  data-zerops-automated-key-note="held"
                >
                  {whatTheyDo(
                    "missing",
                    props.sources.kind === "reading" ? HELD_SOURCES : props.sources,
                  )}
                </p>
              ) : null}
              {props.sources.kind === "reading" ? (
                <p
                  aria-hidden
                  className="invisible col-start-1 row-start-1"
                  data-zerops-automated-sources="held"
                >
                  {whatTheyDo(key, HELD_SOURCES)}
                </p>
              ) : null}
              <p className="col-start-1 row-start-1" data-zerops-automated-what="">
                {whatTheyDo(key)}
              </p>
            </div>
          </section>
          <section
            aria-labelledby={`${id}-next`}
            className="flex flex-col gap-1 rounded-xl bg-muted/60 px-3.5 pt-2.5 pb-3"
            data-zerops-surface="what-happens-next"
          >
            <h3 className="text-xs leading-4 font-medium text-muted-foreground" id={`${id}-next`}>
              What happens next
            </h3>
            <p className="text-line leading-5" data-zerops-automated-next="">
              {automatedNext(count, recipe === "none" ? "none" : "recipe")}
            </p>
            <p className="text-line leading-5 text-muted-foreground">{KEEP_TAB_OPEN_LINE}</p>
          </section>
          {props.forecast}
          {props.repositories}
          <p className="text-sm text-muted-foreground" data-zerops-mate-cost="">
            {automatedCost(names)}{" "}
            <InlineButton render={<a href={ZEROPS_PRICING_URL} rel="noreferrer" target="_blank" />}>
              Zerops pricing
            </InlineButton>
          </p>
        </div>
      </DialogPanel>
      <DialogFooter>
        <p
          aria-live="polite"
          className={cn(
            "me-auto min-h-4 self-center text-line leading-4",
            failed ? "text-status-failed-text" : "text-muted-foreground",
          )}
          id={`${id}-line`}
        >
          {line}
        </p>
        <Button onClick={props.onCancel} type="button" variant="ghost">
          Cancel
        </Button>
        <Button
          aria-busy={(waitingPress && !failed) || undefined}
          disabled={unsupported || people.kind === "failed" || (waitingPress && !failed)}
          type="submit"
        >
          {addAutomatedButton(count)}
        </Button>
      </DialogFooter>
    </form>
  );
}
