/**
 * The composer's top offering a persona to a Mate that holds none (prototype, drawn by the arrival
 * flow's persona states): its face, "How should Wren work with you?", and the templates about the
 * person as presses, each saying what it does on hover; *More* opens the Persona page, the cross
 * hides the offer. It sits where the person writes their first message — over the empty
 * conversation of a new project's Mate, and over the composer under a stand-up's ask — so a
 * persona chosen before the first message shapes the first reply, and one chosen later the next.
 *
 * Once chosen, the same place confirms it (`PersonaChosenStrip`) with a way back; the persona's
 * name then stays after the Mate's on the conversation's line (`MatePersonaPress`).
 */
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import type { LucideIcon } from "lucide-react";
import { XIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { MateFace } from "../zerops/primitives";

/** One template the offer shows: its name, what it does and its mark (`personaIcon`). */
export interface PersonaOfferChoice {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly icon: LucideIcon;
}

interface OfferMate {
  readonly name: string;
  readonly shape?: MateShapeId | undefined;
  readonly tint: MateTintId;
}

/** "its first reply" before the Mate has answered anything, "its next reply" after. */
const fromReply = (firstReply: boolean) => (firstReply ? "its first reply" : "its next reply");

const STRIP =
  "grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 border-rule border-b pt-3 pe-2.5 pb-3 ps-4";

function Glyph(props: { readonly icon: LucideIcon }) {
  const Icon = props.icon;
  return <Icon aria-hidden="true" />;
}

export function PersonaOfferStrip(props: {
  readonly mate: OfferMate;
  readonly choices: readonly PersonaOfferChoice[];
  /** The Mate has not answered yet: the choice shapes its first reply. */
  readonly firstReply: boolean;
  readonly onChoose: (key: string) => void;
  readonly onMore: () => void;
  readonly onDismiss: () => void;
}) {
  const { mate } = props;
  return (
    <section
      aria-label={`How should ${mate.name} work with you?`}
      className={STRIP}
      data-composer-top="persona-offer"
    >
      <MateFace shape={mate.shape} size={24} state="idle" tint={mate.tint} />
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground text-line leading-4.5">
          How should {mate.name} work with you?
        </p>
        <p className="truncate text-muted-foreground text-line leading-4.5">
          Pick a persona for {fromReply(props.firstReply)}. You can change it any time.
        </p>
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label="Not now"
              className="-my-1 justify-self-end self-start"
              onClick={props.onDismiss}
              size="icon-sm"
              variant="ghost-muted"
            >
              <XIcon aria-hidden="true" />
            </Button>
          }
        />
        <TooltipPopup side="top">Not now: {mate.name}'s name keeps the way in</TooltipPopup>
      </Tooltip>
      <div className="col-start-2 col-end-4 flex flex-wrap items-center gap-1.5">
        {props.choices.map((choice) => (
          <Tooltip key={choice.key}>
            <TooltipTrigger
              render={
                <Button
                  data-persona-offer={choice.key}
                  onClick={() => props.onChoose(choice.key)}
                  size="xs"
                  variant="secondary"
                />
              }
            >
              <Glyph icon={choice.icon} />
              {choice.name}
            </TooltipTrigger>
            <TooltipPopup className="max-w-64" side="top">
              {choice.description}
            </TooltipPopup>
          </Tooltip>
        ))}
        <Button onClick={props.onMore} size="xs" variant="ghost-muted">
          More…
        </Button>
      </div>
    </section>
  );
}

/** The offer answered: the persona the Mate now works with, from which reply, and a way back. */
export function PersonaChosenStrip(props: {
  readonly mate: OfferMate;
  readonly choice: PersonaOfferChoice;
  readonly firstReply: boolean;
  readonly onUndo: () => void;
}) {
  const { mate, choice } = props;
  return (
    <section
      aria-label={`${mate.name} works as ${choice.name}`}
      className={STRIP}
      data-composer-top="persona-chosen"
    >
      <MateFace shape={mate.shape} size={24} state="idle" tint={mate.tint} />
      <div className="min-w-0">
        <p className="flex min-w-0 items-center gap-1 font-medium text-foreground text-line leading-4.5 [&_svg]:size-3.5 [&_svg]:shrink-0">
          <span className="shrink-0">{mate.name} works as</span>
          <Glyph icon={choice.icon} />
          <span className="truncate">
            {choice.name} from {fromReply(props.firstReply)}
          </span>
        </p>
        <p className="truncate text-muted-foreground text-line leading-4.5">{choice.description}</p>
      </div>
      <Button onClick={props.onUndo} size="xs" variant="ghost">
        Undo
      </Button>
    </section>
  );
}
