/**
 * Pieces of a Mate's arrival other surfaces draw: its services' line, its runtimes still coming
 * up and the sign-in phrase with each brand wearing its logo. The arrival itself is one
 * progress row (`ComingBelow`).
 */
import type { BirthRuntimeFact } from "@t3tools/client-runtime/zerops/birthProgress";
import { Fragment, useState } from "react";

import { Badge, type BadgeTone } from "../ui/badge";
import { ZeropsAgentLogo } from "./ZeropsAgentLogo";

import {
  nextRuntimesLine,
  runtimesComing,
  type ArrivalService,
  type RuntimesLine,
} from "~/zerops/mateArrival";

import type { SignInPhrasePart } from "@t3tools/client-runtime/zerops/agentSignIn";

/** A service's state as the kit's dot: a hollow one where nothing runs yet or ever will. */
const SERVICE_DOT: Readonly<
  Record<ArrivalService["state"], { readonly tone: BadgeTone; readonly hollow: boolean }>
> = {
  ok: { tone: "success", hollow: false },
  busy: { tone: "info", hollow: false },
  waiting: { tone: "neutral", hollow: true },
  failed: { tone: "danger", hollow: false },
  empty: { tone: "neutral", hollow: true },
};

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
          <Badge
            dot
            hollow={SERVICE_DOT[service.state].hollow}
            tone={SERVICE_DOT[service.state].tone}
          >
            {service.name}
          </Badge>
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
 * The words that tell a person they will sign a Mate in (`signInPhrase`), with each subscription
 * they name wearing its agent's own logo, the size of the text around it — the arrival's own step,
 * and the add dialogs' *What happens next*.
 */
export function SignInPhrase({ parts }: { readonly parts: ReadonlyArray<SignInPhrasePart> }) {
  return parts.map((part, index) => {
    const key = `${String(index)}:${part.text}`;
    if (part.agentId === undefined) return <Fragment key={key}>{part.text}</Fragment>;
    return (
      <span className="whitespace-nowrap" data-agent-brand={part.agentId} key={key}>
        <ZeropsAgentLogo
          agentId={part.agentId}
          className="me-[0.25em] inline-block size-[1em] align-[-0.14em]"
        />
        {part.text}
      </span>
    );
  });
}
