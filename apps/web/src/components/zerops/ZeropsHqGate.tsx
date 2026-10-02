/**
 * The organization's gate (ADR 0001, `hqGate.ts`), in place of the product while the organization
 * has no HQ: an owner or an admin sees it born — each step, the one it is on, and the one that
 * stopped it, with the way on — and anybody else whom to ask, and nothing more.
 */
import {
  findOfficialHq,
  HQ_BIRTH_DOING,
  HQ_BIRTH_STEPS,
  runHqBirth,
} from "@t3tools/client-runtime/zerops/hq";
import { CheckIcon, CircleAlertIcon } from "lucide-react";
import { useCallback, useEffect } from "react";

import { cn } from "~/lib/utils";
import { hqBirthDeps, hqBirthSite, useAccountHq } from "~/zerops/accountHq";
import { bearHq, hqBirthView, useHqBirths, type HqBirthView } from "~/zerops/hqBirth";
import type { HqGate } from "~/zerops/hqGate";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";

type ClosedGate = Exclude<HqGate, { readonly kind: "open" }>;

/** The gate over the organization open now; its birth starts the moment it shows. */
export function ZeropsHqGate({ gate }: { readonly gate: ClosedGate }) {
  const { activeOrganization, client, user } = useZeropsSession();
  const userId = user?.id;
  const clientId = activeOrganization?.id ?? "";
  const accountHq = useAccountHq(activeOrganization?.id);
  const held = useHqBirths((state) => state.byOrg[clientId]);
  const { reread } = accountHq;
  const bear = useCallback(
    (startOver: boolean) =>
      bearHq({
        clientId,
        run: (record, moved) =>
          runHqBirth({
            record,
            clientId,
            userId,
            ...hqBirthSite(client),
            deps: hqBirthDeps(client),
            moved,
          }),
        alreadyBorn: async () =>
          findOfficialHq(await client.listOrganizationMembers(clientId)).kind === "official",
        // Its anchor is in the member list now: the gate opens once it is read again.
        onBorn: reread,
        startOver,
      }),
    [client, clientId, reread, userId],
  );
  const birthDue = gate.kind === "birth" && held === undefined;
  useEffect(() => {
    if (birthDue) bear(false);
  }, [bear, birthDue]);
  return (
    <HqGateScreen
      organizationName={activeOrganization?.name ?? "this organization"}
      gate={gate}
      birth={hqBirthView(held)}
      onTryAgain={() => bear(false)}
      onStartOver={() => bear(true)}
      onReadAgain={reread}
    />
  );
}

export function HqGateScreen({
  organizationName,
  gate,
  birth,
  onTryAgain,
  onStartOver,
  onReadAgain,
}: {
  readonly organizationName: string;
  readonly gate: ClosedGate;
  readonly birth: HqBirthView | undefined;
  readonly onTryAgain: () => void;
  readonly onStartOver: () => void;
  readonly onReadAgain: () => void;
}) {
  return (
    <main
      className="flex h-full min-h-0 flex-1 flex-col items-center justify-center p-8"
      data-zerops-surface="hq-gate"
    >
      <div className="flex w-full max-w-md flex-col gap-4">
        {gate.kind === "birth" ? (
          <HqBirth
            organizationName={organizationName}
            birth={birth}
            onTryAgain={onTryAgain}
            onStartOver={onStartOver}
          />
        ) : gate.kind === "reading" ? (
          gate.failed ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-foreground" role="alert">
                Couldn't read {organizationName}'s members from Zerops.
              </p>
              <Button size="sm" variant="secondary" onClick={onReadAgain}>
                Try again
              </Button>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Spinner size="sm" />
              Reading {organizationName}…
            </p>
          )
        ) : (
          <p className="text-sm text-foreground" role="status">
            {gate.line}
          </p>
        )}
      </div>
    </main>
  );
}

function HqBirth({
  organizationName,
  birth,
  onTryAgain,
  onStartOver,
}: {
  readonly organizationName: string;
  readonly birth: HqBirthView | undefined;
  readonly onTryAgain: () => void;
  readonly onStartOver: () => void;
}) {
  const at =
    birth === undefined ? 0 : HQ_BIRTH_STEPS.indexOf(birth.step === "done" ? "ready" : birth.step);
  const finished = birth?.kind === "running" && birth.step === "done";
  return (
    <>
      <div className="space-y-1">
        <h1 className="text-xl font-medium text-foreground">
          Setting up Mate for {organizationName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Mate keeps this organization's applications in its HQ, a project named Headquarters in
          Zerops. Setting it up takes a few minutes; it goes on where it stopped if you leave.
        </p>
      </div>
      <ol className="flex flex-col gap-2">
        {HQ_BIRTH_STEPS.map((step, index) => {
          const state =
            finished || index < at
              ? "done"
              : index > at
                ? "waiting"
                : birth?.kind === "failed"
                  ? "failed"
                  : "running";
          return (
            <li
              className={cn(
                "flex items-center gap-2 text-sm",
                state === "waiting" ? "text-muted-foreground" : "text-foreground",
                state === "failed" && "text-status-failed-text",
              )}
              data-hq-birth-step={state}
              key={step}
            >
              <span className="flex size-4 shrink-0 items-center justify-center">
                {state === "done" ? (
                  <CheckIcon className="size-4" />
                ) : state === "running" ? (
                  <Spinner size="sm" />
                ) : state === "failed" ? (
                  <CircleAlertIcon className="size-4" />
                ) : null}
              </span>
              <span>{HQ_BIRTH_DOING[step]}</span>
            </li>
          );
        })}
      </ol>
      {birth?.kind === "failed" ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-status-failed-text" role="alert">
            {birth.reason}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={onTryAgain}>
              Try again
            </Button>
            {birth.startOver ? (
              <Button size="sm" variant="ghost" onClick={onStartOver}>
                Start over
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
