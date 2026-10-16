/**
 * Pieces of a Mate's arrival other surfaces draw: its services' line, its runtimes still coming
 * up, a spinner and the sign-in phrase with each brand wearing its logo. The arrival itself is one
 * progress row (`ComingBelow`).
 */
import type { BirthRuntimeFact } from "@t3tools/client-runtime/zerops/birthProgress";
import { Fragment, useState } from "react";

import { ClaudeAI, OpenAI } from "~/components/Icons";

import {
  nextRuntimesLine,
  runtimesComing,
  type ArrivalService,
  type RuntimesLine,
} from "~/zerops/mateArrival";

import type { SignInPhrasePart } from "./ZeropsAgentSignIn.logic";

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
