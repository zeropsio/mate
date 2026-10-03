/**
 * The Mate's own steps while it comes up (`arrivalSteps`), as the arrival's slot draws them: one
 * row a step — its mark, its words, how long it took — the services its copy of the project brings
 * on a quieter line under the first, and the person's own step last, with their picture: "You
 * sign Wren in with your Claude or ChatGPT subscription", each brand wearing its logo.
 */
import type { BirthRuntimeFact } from "@t3tools/client-runtime/zerops/birthProgress";
import { Fragment, useState, type ReactNode } from "react";

import { ClaudeAI, OpenAI } from "~/components/Icons";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

import {
  nextRuntimesLine,
  runtimesComing,
  type ArrivalService,
  type ArrivalStep,
  type ArrivalSubstep,
  type RuntimesLine,
} from "~/zerops/mateArrival";

import { Avatar } from "./primitives";
import type { SignInPhrasePart } from "./ZeropsAgentSignIn.logic";

/** The person, as their own step wears them. */
export interface ArrivalYou {
  readonly initials: string;
  readonly avatarUrl: string | null;
}

export function ZeropsArrivalSteps({
  steps,
  you,
}: {
  readonly steps: ReadonlyArray<ArrivalStep>;
  readonly you: ArrivalYou | null;
}) {
  return (
    <ol
      aria-label="How far it has got"
      className="arrival-steps"
      data-zerops-surface="arrival-steps"
    >
      {steps.map((step) => (
        <li
          className="arrival-step"
          data-arrival-step={step.id}
          data-state={step.state}
          key={step.id}
        >
          <span className="arrival-step-mark">
            <ArrivalStepGlyph state={step.state} you={you} />
          </span>
          <span
            className="arrival-step-label"
            data-spans-time={step.time === undefined && step.note === undefined ? "" : undefined}
          >
            {step.phrase === undefined ? step.label : <SignInPhrase parts={step.phrase} />}
            {step.why === undefined ? null : (
              <span className="arrival-step-why"> · {step.why}</span>
            )}
          </span>
          {step.time === undefined && step.note === undefined ? null : (
            <span className="arrival-step-time">
              {step.time}
              {step.time !== undefined && step.note !== undefined ? (
                <span className="arrival-step-note"> of {step.note}</span>
              ) : (
                step.note
              )}
            </span>
          )}
          {step.substeps === undefined ? null : <ArrivalSubsteps steps={step.substeps} />}
          {step.services === undefined ? null : (
            <div className="arrival-step-sub">
              <ArrivalServices services={step.services} />
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

const SUBSTEP_STATE_WORDS: Readonly<Record<ArrivalSubstep["state"], string>> = {
  done: "done",
  active: "in progress",
  waiting: "waiting",
  failed: "stopped",
  unfinished: "not finished",
};

/**
 * The steps this tab runs, under the row they make: one small mark and the words each, quieter
 * than the steps — where one stopped, why, in its place, on its one line.
 */
function ArrivalSubsteps({ steps }: { readonly steps: ReadonlyArray<ArrivalSubstep> }) {
  return (
    <ol aria-label="In this tab" className="arrival-step-sub arrival-substeps">
      {steps.map((step) => (
        <li
          aria-label={
            step.state === "unfinished"
              ? `${step.label}${step.why === undefined ? "." : `: ${step.why}`}`
              : `${step.label}: ${SUBSTEP_STATE_WORDS[step.state]}${step.why === undefined ? "" : `. ${step.why}`}`
          }
          className="arrival-substep"
          data-arrival-substep={step.id}
          data-state={step.state}
          key={step.id}
        >
          <span className="arrival-substep-mark">
            {/* Not finished, it waits on nobody here: the waiting mark, never a stop's. */}
            <ArrivalStepGlyph state={step.state === "unfinished" ? "waiting" : step.state} />
          </span>
          {/* One line, whatever it says: a long reason is cut, whole on hover and to a reader. */}
          {step.why === undefined ? (
            <span className="arrival-substep-label">{step.label}</span>
          ) : (
            <Tooltip>
              <TooltipTrigger render={<span className="arrival-substep-label" />}>
                {step.label}
                {step.state === "unfinished" ? (
                  `: ${step.why}`
                ) : (
                  <span className="arrival-step-why"> · {step.why}</span>
                )}
              </TooltipTrigger>
              <TooltipPopup side="top">{step.why}</TooltipPopup>
            </Tooltip>
          )}
        </li>
      ))}
    </ol>
  );
}

const SERVICE_STATE_WORDS: Readonly<Record<ArrivalService["state"], string>> = {
  ok: "running",
  busy: "coming up",
  waiting: "waiting",
  failed: "stopped",
  empty: "stays empty until something is released to it",
};

/** A project's services, one name and one dot each, quieter than the steps above them. */
export function ArrivalServices({
  services,
}: {
  readonly services: ReadonlyArray<ArrivalService>;
}) {
  return (
    <ul className="arrival-services" data-zerops-surface="arrival-services">
      {services.map((service) => (
        <li
          aria-label={`${service.name}: ${SERVICE_STATE_WORDS[service.state]}`}
          className="arrival-service"
          data-state={service.state}
          key={service.name}
        >
          <span aria-hidden="true" className="arrival-service-dot" />
          {service.name}
        </li>
      ))}
    </ul>
  );
}

/**
 * Under the sign-in, the runtimes still coming up after the Mate answered — "appdev appstage
 * coming up", one dot each as on the workspace step, in its order. Nothing for runtimes already
 * up; once all are, its words fade and its place stays until the sign-in goes (`nextRuntimesLine`).
 */
export function ArrivalRuntimesLine({
  runtimes,
}: {
  readonly runtimes: ReadonlyArray<BirthRuntimeFact> | undefined;
}) {
  const read = runtimesComing(runtimes);
  const [held, setHeld] = useState<{
    readonly line: RuntimesLine;
    readonly services: ReadonlyArray<ArrivalService>;
  }>({ line: "none", services: [] });
  // An unread listing (it blinks between reads) says nothing: the line stays as it stands.
  const line = nextRuntimesLine(
    held.line,
    runtimes === undefined ? undefined : read?.coming === true,
  );
  // Its last names are kept for a read that has none any more: its place stays drawn, faded.
  const services = read?.services ?? held.services;
  if (line !== held.line) setHeld({ line, services });
  if (line === "none") return null;
  return (
    <div
      aria-hidden={line === "settled" ? true : undefined}
      className="arrival-runtimes"
      data-state={line}
      data-zerops-surface="arrival-runtimes"
    >
      <ArrivalServices services={services} />
      <span>coming up</span>
    </div>
  );
}

/**
 * A step's mark: done a soft check, under way an arc turning a notch at a time (R6), waiting an
 * empty ring, stopped a cross, and the person's own step their picture.
 */
export function ArrivalStepGlyph({
  state,
  you = null,
}: {
  readonly state: ArrivalStep["state"];
  readonly you?: ArrivalYou | null;
}): ReactNode {
  switch (state) {
    case "done":
      return (
        <svg aria-hidden="true" className="arrival-glyph" viewBox="0 0 16 16">
          <circle className="arrival-glyph-ok-bg" cx="8" cy="8" r="8" />
          <path className="arrival-glyph-ok-ink" d="M4.9 8.3 7 10.3 11.1 6" />
        </svg>
      );
    case "active":
      return <ArrivalSpinner className="arrival-glyph" />;
    case "waiting":
      return (
        <svg aria-hidden="true" className="arrival-glyph" viewBox="0 0 16 16">
          <circle className="arrival-glyph-wait" cx="8" cy="8" r="6.25" />
        </svg>
      );
    case "failed":
      return (
        <svg aria-hidden="true" className="arrival-glyph" viewBox="0 0 16 16">
          <circle className="arrival-glyph-fail-bg" cx="8" cy="8" r="8" />
          <path className="arrival-glyph-fail-ink" d="M5.7 5.7l4.6 4.6M10.3 5.7l-4.6 4.6" />
        </svg>
      );
    case "you":
      return (
        <span className="arrival-glyph-you">
          <Avatar
            className="size-full"
            initials={you?.initials ?? ""}
            size="xs"
            src={you?.avatarUrl ?? null}
          />
        </span>
      );
  }
}

/** Something under way: a ring and its arc, turning a notch at a time. */
export function ArrivalSpinner({ className }: { readonly className: string }) {
  return (
    <svg aria-hidden="true" className={className} data-arrival-spinner viewBox="0 0 16 16">
      <circle className="arrival-glyph-track" cx="8" cy="8" r="6.4" />
      <path className="arrival-glyph-arc" d="M8 1.6a6.4 6.4 0 0 1 6.4 6.4" />
    </svg>
  );
}

/**
 * The words that tell a person they will sign a Mate in (`signInPhrase`), with each subscription
 * they name wearing its agent's own logo, the size of the text around it — the arrival's own step,
 * and the add dialogs' *What happens next*.
 */
export function SignInPhrase({ parts }: { readonly parts: ReadonlyArray<SignInPhrasePart> }) {
  return parts.map((part, index) => {
    const key = `${String(index)}:${part.text}`;
    if (part.agentId === undefined) return <Fragment key={key}>{part.text}</Fragment>;
    const Logo = part.agentId === "claude-code" ? ClaudeAI : OpenAI;
    return (
      <span className="whitespace-nowrap" data-agent-brand={part.agentId} key={key}>
        <Logo aria-hidden="true" className="me-[0.25em] inline-block size-[1em] align-[-0.14em]" />
        {part.text}
      </span>
    );
  });
}
