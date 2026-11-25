/**
 * A new Mate asking its person how to work with them (prototype, drawn by the arrival flow's
 * persona states). A persona is chosen once in a Mate's life, so it is asked once, as the Mate's
 * first message, in the card a Mate asks everything in (`AskCard`): while it sets up an existing
 * project, under the setup's ask in the conversation; on a new project, before the person's first
 * message, where the conversation is still empty. The templates about the person are its choices;
 * the main press, named for its result, saves the one picked, and the Mate works that way from its
 * next reply. *Not now* leaves it with none. Either way the Persona page keeps the way back.
 */
import type { LucideIcon } from "lucide-react";

import { AskCard, AskFooter } from "../ask/AskCard";
import type { AskState } from "../ask/ask.logic";
import { Button } from "../ui/button";
import { RadioCard, RadioGroup } from "../ui/radio-group";

/** One template as the ask offers it: its name, what it does and its mark (`personaIcon`). */
export interface PersonaChoice {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly icon: LucideIcon;
}

/** When the Mate asks: while it sets its project up, or before its person's first message. */
export type PersonaAskMoment = "setup" | "start";

const why = (moment: PersonaAskMoment, project: string) =>
  `${moment === "setup" ? `While I set up ${project}` : `Before we start on ${project}`}: how ` +
  "should I talk with you and go about the work? You can change it on my Persona page later.";

export function PersonaAsk(props: {
  readonly mateName: string;
  readonly project: string;
  readonly moment: PersonaAskMoment;
  readonly choices: readonly PersonaChoice[];
  readonly picked: string | null;
  readonly onPick: (key: string) => void;
  readonly state: AskState;
  readonly onChoose: () => void;
  readonly onNotNow: () => void;
  /** Not now, answered again: the choices come back. */
  readonly onAskAgain: () => void;
  readonly onOpenPersonaPage: () => void;
}) {
  const picked = props.choices.find((choice) => choice.key === props.picked);
  return (
    <AskCard
      askId="persona"
      density="full"
      footer={
        <AskFooter
          action={
            props.state.kind === "done" ? (
              <Button onClick={props.onOpenPersonaPage} size="sm" variant="ghost">
                Change
              </Button>
            ) : props.state.kind === "notNow" ? (
              <Button onClick={props.onAskAgain} size="sm" variant="ghost">
                Choose one
              </Button>
            ) : undefined
          }
          density="full"
          main={{
            label: picked === undefined ? "Pick one above" : `Work as ${picked.name}`,
            onPress: props.onChoose,
            disabled: picked === undefined,
          }}
          onNotNow={props.onNotNow}
          state={props.state}
        />
      }
      kind="persona"
      state={props.state.kind}
      title={`Choose how ${props.mateName} works with you`}
      where={null}
      why={{ who: props.mateName, words: why(props.moment, props.project) }}
    >
      <RadioGroup
        aria-label={`How ${props.mateName} works with you`}
        disabled={props.state.kind !== "waiting"}
        layout="columns"
        onValueChange={(next) => {
          if (typeof next === "string") props.onPick(next);
        }}
        value={props.picked}
      >
        {props.choices.map((choice) => {
          const Icon = choice.icon;
          return (
            <RadioCard
              key={choice.key}
              title={
                <>
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  <span className="min-w-0 truncate">{choice.name}</span>
                </>
              }
              value={choice.key}
            >
              {choice.description}
            </RadioCard>
          );
        })}
      </RadioGroup>
    </AskCard>
  );
}
