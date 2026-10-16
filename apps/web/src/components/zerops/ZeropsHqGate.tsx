/**
 * The organization's gate (ADR 0001, `hqGate.ts`), in place of the product while the organization
 * has no HQ: an owner or an admin sees it born — each step, the one it is on, and the one that
 * stopped it, with the way on — and anybody else whom to ask, and nothing more.
 */
import { RegistryContext } from "@effect/atom-react";
import { hqBirthProgress, hqBirthRequestId } from "@t3tools/client-runtime/data";
import { HQ_BIRTH_DOING, HQ_BIRTH_STEPS } from "@t3tools/client-runtime/zerops/hq";
import { useCallback, useContext, type ReactNode } from "react";

import { captureAccountLifetime } from "~/zerops/accountLifetime";
import { useAccountOperations } from "~/zerops/accountOperations";
import { hqBirthSite, useAccountHq } from "~/zerops/accountHq";
import { useHqBirths, hqBirthView, type HqBirthView } from "~/zerops/hqBirth";
import type { HqGate } from "~/zerops/hqGate";
import { useAccountData } from "~/zerops/ZeropsAccountData";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { PageStandIn } from "../RoutePending";

import { Button } from "../ui/button";
import { Failure } from "../ui/failure";
import { Progress } from "../ui/progress";
import { StatusPage } from "../ui/status-page";

type ClosedGate = Exclude<HqGate, { readonly kind: "open" }>;

/** The gate over the organization open now; an administrator chooses when to set up HQ. */
export function ZeropsHqGate({ gate }: { readonly gate: ClosedGate }) {
  const { activeOrganization, client } = useZeropsSession();
  const clientId = activeOrganization?.id ?? "";
  const accountHq = useAccountHq(activeOrganization?.id);
  const held = useHqBirths(clientId);
  const registry = useContext(RegistryContext);
  const operations = useAccountOperations();
  const { data } = useAccountData();
  const { reread } = accountHq;
  const bear = useCallback(
    (again: boolean) => {
      const current = registry.get(data.project(hqBirthProgress, clientId));
      if (current?.running || current?.record.step === "done") return;
      const isCurrent = captureAccountLifetime();
      void operations
        .submit(
          { kind: "hq-birth", orgId: clientId, ...hqBirthSite(client), again },
          hqBirthRequestId(clientId, (current?.attempt ?? 0) + 1),
        )
        .then(({ progress }) => {
          if (isCurrent() && progress.stage === "done" && progress.outcome === "succeeded")
            reread();
        });
    },
    [client, clientId, data, operations, registry, reread],
  );
  return (
    <HqGateScreen
      organizationName={activeOrganization?.name ?? "this organization"}
      gate={gate}
      birth={hqBirthView(held)}
      onStart={() => bear(false)}
      onTryAgain={() => bear(true)}
      onReadAgain={reread}
      standIn={<PageStandIn />}
    />
  );
}

/** HQ's setup as measured end to end (about 4½ minutes without a stop): what the row promises. */
export const HQ_BIRTH_ESTIMATE_MS = 5 * 60_000;

export function HqGateScreen({
  organizationName,
  gate,
  birth,
  onStart,
  onTryAgain,
  onReadAgain,
  standIn = null,
}: {
  readonly organizationName: string;
  readonly gate: ClosedGate;
  readonly birth: HqBirthView | undefined;
  readonly onStart?: () => void;
  readonly onTryAgain: () => void;
  readonly onReadAgain: () => void;
  /** What stands in while the members are read: the page's own shape (`PageStandIn`). */
  readonly standIn?: ReactNode;
}) {
  if (gate.kind === "birth") {
    return (
      <HqBirth
        organizationName={organizationName}
        birth={birth}
        onStart={onStart}
        onTryAgain={onTryAgain}
      />
    );
  }
  if (gate.kind === "reading") {
    return gate.failed ? (
      <Failure
        action={<Button onClick={onReadAgain}>Try again</Button>}
        cause={`Couldn't read ${organizationName}'s members from Zerops.`}
        data-zerops-surface="hq-gate"
        size="page"
      />
    ) : (
      // The reload's one stand-in: the page's own shape until the gate knows what stands here.
      <div className="contents" data-zerops-surface="hq-gate">
        {standIn}
      </div>
    );
  }
  return <StatusPage data-zerops-surface="hq-gate" title={gate.line} />;
}

function HqBirth({
  organizationName,
  birth,
  onStart,
  onTryAgain,
}: {
  readonly organizationName: string;
  readonly birth: HqBirthView | undefined;
  readonly onStart: (() => void) | undefined;
  readonly onTryAgain: () => void;
}) {
  if (birth === undefined) {
    return (
      <StatusPage
        actions={
          <Button onClick={onStart} size="lg">
            Set up HQ
          </Button>
        }
        data-zerops-surface="hq-gate"
        title={`Set up HQ for ${organizationName}`}
      >
        <p className="m-0">
          HQ keeps this organization's projects, their code and their Mates, in a project named
          Headquarters in Zerops. It takes about 5 minutes; then you can start your first Mate.
        </p>
      </StatusPage>
    );
  }
  const at = HQ_BIRTH_STEPS.indexOf(birth.step === "done" ? "ready" : birth.step);
  return (
    <StatusPage data-zerops-surface="hq-gate" title={`Setting up HQ for ${organizationName}`}>
      <p className="m-0">
        HQ goes into a project named Headquarters in Zerops. It takes about 5 minutes. Keep this tab
        open while it runs; if it closes, any admin can continue it from where it stopped.
      </p>
      <Progress
        at={at}
        className="mt-3 w-full text-left"
        estimateMs={HQ_BIRTH_ESTIMATE_MS}
        label={`Setting up HQ for ${organizationName}`}
        startedAtMs={birth.startedAt ?? null}
        steps={HQ_BIRTH_STEPS.map((step) => HQ_BIRTH_DOING[step])}
        view={
          birth.kind === "failed"
            ? {
                state: "failed",
                cause: `${HQ_BIRTH_DOING[birth.step]} stopped. ${birth.reason}`,
                action: (
                  <Button onClick={onTryAgain} size="sm">
                    Try again
                  </Button>
                ),
              }
            : birth.step === "done"
              ? { state: "done", result: `HQ is ready for ${organizationName}` }
              : undefined
        }
      />
      {birth.kind === "failed" ? <p className="m-0">Finished steps are kept.</p> : null}
    </StatusPage>
  );
}
