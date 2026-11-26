/**
 * A new Mate asking its person how to work with them, as its first message (`matePersonaAsked`),
 * in the card a Mate asks everything in (`AskCard`): the templates about the person as choices, and
 * a main press named for its result that saves the one picked. Nothing else answers it but writing
 * to the Mate, which the note says; once answered it says how the Mate works, with the way to the
 * Persona page to change it.
 */
import { PREMADE_PERSONA_TEMPLATES } from "@t3tools/shared/personaTemplates";
import { type ReactNode, useEffect, useState } from "react";

import { cn } from "~/lib/utils";
import type { MatePersonaAskView, PersonaAskMoment } from "./useMatePersonaAsk";
import { AskCard, AskFooter } from "../ask/AskCard";
import { Button } from "../ui/button";
import { RadioCard, RadioGroup } from "../ui/radio-group";
import { personaIcon } from "./personaIcon";

/** The templates about the person, as the ask offers them: how the Mate talks with them. */
export const PERSONA_CHOICES = PREMADE_PERSONA_TEMPLATES.filter(
  (template) => template.about === "you",
).map((template) => ({
  key: template.id,
  name: template.name,
  description: template.description,
  icon: personaIcon({ source: "premade", id: template.id, revision: template.revision }),
}));

const why = (moment: PersonaAskMoment, project: string) =>
  `${moment === "setup" ? `While I set up ${project}` : `Before we start on ${project}`}: how ` +
  "should I talk with you and go about the work? You can change it on my Persona page later.";

export function PersonaAsk(props: MatePersonaAskView) {
  const { state } = props;
  const picked = PERSONA_CHOICES.find((choice) => choice.key === props.picked);
  return (
    <AskCard
      askId="persona"
      density="full"
      footer={
        <AskFooter
          action={
            state.kind === "done" ? (
              <Button onClick={props.onOpenPersonaPage} size="sm" variant="ghost">
                Change
              </Button>
            ) : state.kind === "failed" ? (
              <Button onClick={props.onChoose} size="sm" variant="ghost">
                Try again
              </Button>
            ) : undefined
          }
          density="full"
          main={{
            label: picked === undefined ? "Pick one above" : `Work as ${picked.name}`,
            onPress: props.onChoose,
            disabled: picked === undefined,
          }}
          note={`Or just write to ${props.mateName}: it works its own way until you pick.`}
          state={state}
        />
      }
      kind="persona"
      state={state.kind}
      title={`Choose how ${props.mateName} works with you`}
      where={null}
      why={{ who: props.mateName, words: why(props.moment, props.project) }}
    >
      <RadioGroup
        aria-label={`How ${props.mateName} works with you`}
        disabled={state.kind === "working" || state.kind === "done"}
        layout="columns"
        onValueChange={(next) => {
          if (typeof next === "string") props.onPick(next);
        }}
        value={props.picked}
      >
        {PERSONA_CHOICES.map((choice) => {
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

/**
 * A new project's ask above its composer, in the column's flow, so the composer and the headline
 * over it make room for it; folding, it closes that room on the move's curve and the composer
 * glides back to the middle (`usePersonaAskFold`). At once where the person asked for less motion.
 */
export function PersonaAskFold(props: { readonly folding: boolean; readonly children: ReactNode }) {
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-260 ease-in-out-strong motion-reduce:transition-none",
        props.folding ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr]",
      )}
      data-persona-ask={props.folding ? "folding" : "asking"}
      inert={props.folding}
    >
      <div className={cn("min-h-0", props.folding && "overflow-hidden")}>
        <div className="mx-auto w-full max-w-3xl pb-4">{props.children}</div>
      </div>
    </div>
  );
}

/** How long a new project's ask holds the line that it was answered before it folds away. */
const ANSWERED_HOLD_MS = 900;
/** How long it takes to fold (`--duration-slow`). */
const FOLD_MS = 260;

/**
 * Where a new project's ask stands: asking, then once answered — the line saying so held a beat —
 * folding away as the empty conversation's headline unfolds in its place; null once gone.
 */
export function usePersonaAskFold(ask: MatePersonaAskView | null): "asking" | "folding" | null {
  const answered = ask?.state.kind === "done";
  const [phase, setPhase] = useState<"asking" | "folding" | "gone">("asking");
  useEffect(() => {
    if (phase === "gone" || (phase === "asking" && !answered)) return;
    const timer = window.setTimeout(
      () => setPhase(phase === "asking" ? "folding" : "gone"),
      phase === "asking" ? ANSWERED_HOLD_MS : FOLD_MS,
    );
    return () => window.clearTimeout(timer);
  }, [answered, phase]);
  return ask === null || phase === "gone" ? null : phase;
}
