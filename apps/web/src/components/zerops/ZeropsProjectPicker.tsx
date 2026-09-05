/**
 * The Zerops project picker: every container the signed-in account can reach,
 * grouped into connected / ready / unavailable. The grouping decisions all
 * live in `deriveZeropsCandidates`; this file only renders them.
 */

import { RotateCcwIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { FlatCard, MicroLabel, Pill, StatusDot } from "./primitives";
import {
  connectionStatusText,
  type EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";
import {
  groupZeropsCandidates,
  type ZeropsCandidate,
} from "@t3tools/client-runtime/zerops/candidates";
import type { ZeropsContainerHealth } from "@t3tools/client-runtime/zerops/provisioning";
import { readZeropsToolKind } from "@t3tools/client-runtime/zerops";

type PresentedZeropsCandidate = ZeropsCandidate & {
  readonly connection?: EnvironmentConnectionPresentation;
};

type CandidateStatus = {
  readonly label: string;
  readonly pulse?: boolean;
  readonly tone: "ok" | "busy" | "attention" | "failed" | "off";
};

function candidateDetail(candidate: PresentedZeropsCandidate): string {
  const connection = candidate.connection;
  if (connection !== undefined && connection.phase !== "connected") {
    return connection.phase === "available" ? "Connecting..." : connectionStatusText(connection);
  }
  return candidate.reason ?? candidate.containerOrigin ?? candidate.project.id;
}

function isConnectionInFlight(candidate: PresentedZeropsCandidate): boolean {
  const phase = candidate.connection?.phase;
  return phase === "available" || phase === "connecting" || phase === "reconnecting";
}

function CandidateRow({
  candidate,
  action,
  busy,
  detail,
  status,
}: {
  readonly candidate: PresentedZeropsCandidate;
  readonly action?: ReactNode | undefined;
  readonly busy: boolean;
  readonly detail?: string | undefined;
  readonly status: CandidateStatus;
}) {
  return (
    <li className="min-w-0">
      <FlatCard
        aria-busy={busy}
        className="flex h-full min-w-0 flex-col gap-4 p-4"
        data-zerops-project-card="true"
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <StatusDot
            label={status.label}
            tone={status.tone}
            {...(status.pulse === undefined ? {} : { pulse: status.pulse })}
          />
          {candidate.service ? (
            <Badge size="sm" variant="outline">
              {candidate.service.name}
            </Badge>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <MicroLabel className="text-muted-foreground">Project</MicroLabel>
          <h3 className="mt-1 truncate text-base font-medium text-foreground">
            {candidate.project.name}
          </h3>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {detail ?? candidateDetail(candidate)}
          </p>
        </div>
        {action ? <div className="mt-auto">{action}</div> : null}
      </FlatCard>
    </li>
  );
}

function CandidateGroup({
  title,
  description,
  candidates,
  busyCandidateKeys,
  renderAction,
  renderPresentation,
  status,
}: {
  readonly title: string;
  readonly description: string;
  readonly candidates: ReadonlyArray<PresentedZeropsCandidate>;
  readonly busyCandidateKeys?: ReadonlySet<string> | undefined;
  readonly renderAction?: ((candidate: PresentedZeropsCandidate) => ReactNode) | undefined;
  readonly renderPresentation?:
    | ((candidate: PresentedZeropsCandidate) => {
        readonly detail?: string;
        readonly status: CandidateStatus;
      })
    | undefined;
  readonly status: CandidateStatus;
}) {
  if (candidates.length === 0) return null;
  const labelId = `zerops-project-group-${title.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <section aria-labelledby={labelId} className="space-y-3">
      <div>
        <h2 id={labelId} className="text-sm font-semibold text-foreground">
          {title}
        </h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {candidates.map((candidate) => {
          const presentation = renderPresentation?.(candidate);
          return (
            <CandidateRow
              key={candidate.key}
              candidate={candidate}
              action={renderAction?.(candidate)}
              busy={busyCandidateKeys?.has(candidate.key) ?? false}
              detail={presentation?.detail}
              status={presentation?.status ?? status}
            />
          );
        })}
      </ul>
    </section>
  );
}

function readyCandidatePresentation(
  candidate: PresentedZeropsCandidate,
  health: ZeropsContainerHealth | undefined,
): { readonly detail?: string; readonly status: CandidateStatus } {
  if (candidate.connection?.error) {
    return {
      detail: candidateDetail(candidate),
      status:
        candidate.connection.phase === "error"
          ? { label: "Connection failed", tone: "failed" }
          : { label: "Reconnecting", tone: "attention" },
    };
  }
  if (candidate.connection?.phase === "error") {
    return {
      detail: candidateDetail(candidate),
      status: { label: "Connection failed", tone: "failed" },
    };
  }
  if (isConnectionInFlight(candidate)) {
    return {
      detail: candidateDetail(candidate),
      status: {
        label: candidate.connection?.phase === "reconnecting" ? "Reconnecting" : "Connecting",
        pulse: true,
        tone: "busy",
      },
    };
  }
  switch (health) {
    case "predates-mate":
      return {
        detail: "Zerops Mate is not enabled yet.",
        status: { label: "Needs Zerops Mate", tone: "attention" },
      };
    case "unreachable":
      return {
        detail: "Container is not answering.",
        status: { label: "Not answering", tone: "attention" },
      };
    case "initializing":
      return {
        detail: "Zerops Mate is starting.",
        status: { label: "Starting", pulse: true, tone: "busy" },
      };
    case "ready":
      return { status: { label: "Ready", tone: "ok" } };
    default:
      return { status: { label: "Checking", pulse: true, tone: "busy" } };
  }
}

/** What a row says and offers, given what its container answered. */
function readyRowAction(input: {
  readonly candidate: PresentedZeropsCandidate;
  readonly health: ZeropsContainerHealth | undefined;
  readonly onConnect: ((candidate: ZeropsCandidate) => void) | undefined;
  readonly onEnable: ((candidate: ZeropsCandidate) => void) | undefined;
  readonly busy: boolean;
}): ReactNode {
  const { busy, candidate, health, onConnect, onEnable } = input;
  if (health === undefined) {
    return <Spinner className="size-4 text-muted-foreground" />;
  }
  // A container from before Zerops Mate answers no route with a CORS header,
  // so from a browser it is indistinguishable from one that is simply away —
  // and the platform has already told us this service is ACTIVE. A restart is
  // the action that helps in either case, so it is what the row offers.
  if (health === "predates-mate" || health === "unreachable") {
    return onEnable ? (
      <Pill
        className="w-full"
        data-zerops-primary-action="Enable Zerops Mate"
        disabled={busy}
        label="Enable Zerops Mate"
        onClick={() => {
          onEnable(candidate);
        }}
      />
    ) : null;
  }
  if (health !== "ready") {
    return <span className="text-xs text-muted-foreground">Starting…</span>;
  }
  return onConnect ? (
    <Pill
      className="w-full"
      data-zerops-primary-action="Connect"
      disabled={busy}
      label="Connect"
      onClick={() => {
        onConnect(candidate);
      }}
    />
  ) : null;
}

/**
 * `onConnect` is supplied once identity bootstrap exists; without it the rows
 * are informational and no half-wired button is rendered.
 */
export function ZeropsProjectPicker({
  candidates,
  scopeName,
  busyCandidateKeys,
  isLoading,
  error,
  health,
  onRefresh,
  onConnect,
  onEnable,
  onOpen,
  onWait,
  onSetUpMate,
}: {
  readonly candidates: ReadonlyArray<PresentedZeropsCandidate>;
  /** The currently selected Zerops organization, shown beside the result count. */
  readonly scopeName?: string | undefined;
  readonly busyCandidateKeys?: ReadonlySet<string> | undefined;
  readonly isLoading: boolean;
  readonly error: string | null;
  /** What each container answered, by candidate key; absent means still asking. */
  readonly health?: ReadonlyMap<string, ZeropsContainerHealth> | undefined;
  readonly onRefresh: () => void;
  readonly onConnect?: ((candidate: PresentedZeropsCandidate) => void) | undefined;
  readonly onEnable?: ((candidate: PresentedZeropsCandidate) => void) | undefined;
  readonly onOpen?: ((candidate: PresentedZeropsCandidate) => void) | undefined;
  /** A project or container that is still on its way in — nothing to connect to yet. */
  readonly onWait?: ((candidate: PresentedZeropsCandidate) => void) | undefined;
  /** A project with no container yet: give it one, and an agent. */
  readonly onSetUpMate?: ((candidate: PresentedZeropsCandidate) => void) | undefined;
}) {
  const grouped = groupZeropsCandidates(candidates);
  const connecting = grouped.ready.filter(isConnectionInFlight);
  const ready = grouped.ready.filter((candidate) => !isConnectionInFlight(candidate));
  const empty = !isLoading && candidates.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {isLoading ? (
            <>
              <Spinner className="size-3.5" />
              <span>Reading your Zerops projects…</span>
            </>
          ) : (
            <span>
              {candidates.length} container{candidates.length === 1 ? "" : "s"}
              {scopeName ? ` in ${scopeName}` : ""}
            </span>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={onRefresh} disabled={isLoading}>
          <RotateCcwIcon className="size-4" />
          Refresh
        </Button>
      </div>

      {error ? (
        <p className="rounded-xl border border-destructive/40 bg-destructive/8 px-4 py-3 text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}

      <CandidateGroup
        title="Connected"
        description="Already available in this app."
        busyCandidateKeys={busyCandidateKeys}
        candidates={grouped.connected}
        status={{ label: "Connected", tone: "ok" }}
        renderAction={
          onOpen
            ? (candidate) => (
                <Pill
                  className="w-full"
                  data-zerops-primary-action="Open"
                  disabled={busyCandidateKeys?.has(candidate.key) ?? false}
                  label="Open"
                  onClick={() => {
                    onOpen(candidate);
                  }}
                />
              )
            : undefined
        }
      />
      <CandidateGroup
        title="Connecting"
        description="Establishing a session with this container."
        busyCandidateKeys={busyCandidateKeys}
        candidates={connecting}
        status={{ label: "Connecting", pulse: true, tone: "busy" }}
        renderPresentation={(candidate) =>
          readyCandidatePresentation(candidate, health?.get(candidate.key))
        }
        renderAction={(candidate) => {
          const candidateHealth = health?.get(candidate.key);
          return candidateHealth === "predates-mate" || candidateHealth === "unreachable" ? (
            readyRowAction({
              candidate,
              busy: busyCandidateKeys?.has(candidate.key) ?? false,
              health: candidateHealth,
              onConnect: undefined,
              onEnable,
            })
          ) : (
            <Spinner className="size-4 text-muted-foreground" />
          );
        }}
      />
      <CandidateGroup
        title="Ready to connect"
        description="A Zerops Mate container is running and reachable."
        busyCandidateKeys={busyCandidateKeys}
        candidates={ready}
        status={{ label: "Ready", tone: "ok" }}
        renderPresentation={(candidate) =>
          readyCandidatePresentation(candidate, health?.get(candidate.key))
        }
        renderAction={(candidate) =>
          readyRowAction({
            candidate,
            busy: busyCandidateKeys?.has(candidate.key) ?? false,
            health: health?.get(candidate.key),
            onConnect,
            onEnable,
          })
        }
      />
      <CandidateGroup
        title="Preparing"
        description="Getting your project ready."
        busyCandidateKeys={busyCandidateKeys}
        candidates={grouped.provisioning}
        status={{ label: "Preparing", pulse: true, tone: "busy" }}
        renderAction={
          onWait
            ? (candidate) => (
                <Pill
                  className="w-full"
                  data-zerops-primary-action="Wait for it"
                  disabled={busyCandidateKeys?.has(candidate.key) ?? false}
                  label="Wait for it"
                  onClick={() => {
                    onWait(candidate);
                  }}
                />
              )
            : undefined
        }
      />
      <CandidateGroup
        title="Not available"
        description="Each row says what is in the way."
        busyCandidateKeys={busyCandidateKeys}
        candidates={grouped.unavailable}
        status={{ label: "Not available", tone: "off" }}
        renderAction={
          onSetUpMate
            ? (candidate) =>
                // A missing container is the one thing in the way that a
                // click can fix — on an environment. A tool has none by
                // design (`tools.ts`) and is not offered one.
                candidate.missingContainer === true &&
                readZeropsToolKind(candidate.project.tagList) === undefined ? (
                  <Pill
                    className="w-full"
                    data-zerops-primary-action="Set up Mate"
                    disabled={busyCandidateKeys?.has(candidate.key) ?? false}
                    label="Set up Mate"
                    onClick={() => {
                      onSetUpMate(candidate);
                    }}
                  />
                ) : undefined
            : undefined
        }
      />

      {empty ? (
        <p className="text-sm text-muted-foreground">No projects in this account yet.</p>
      ) : null}
    </div>
  );
}
