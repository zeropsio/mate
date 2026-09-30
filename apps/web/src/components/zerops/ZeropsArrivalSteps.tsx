/**
 * The Mate's own steps while it comes up (`arrivalSteps`), as the arrival's slot draws them: one
 * row a step — its mark, its words, how long it took — the services its copy of the project brings
 * on a quieter line under the first, and the person's own step last, with their picture: "You
 * sign Wren in", next.
 */
import type { ReactNode } from "react";

import type { ArrivalService, ArrivalStep } from "~/zerops/mateArrival";

import { Avatar } from "./primitives";

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
          <span className="arrival-step-label">
            {step.label}
            {step.why === undefined ? null : (
              <span className="arrival-step-why"> · {step.why}</span>
            )}
          </span>
          <span className="arrival-step-time">
            {step.time}
            {step.time !== undefined && step.note !== undefined && step.state !== "you" ? (
              <span className="arrival-step-note"> of {step.note}</span>
            ) : (
              step.note
            )}
          </span>
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
