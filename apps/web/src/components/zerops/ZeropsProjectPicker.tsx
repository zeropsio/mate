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
import {
  groupZeropsCandidates,
  type ZeropsCandidate,
} from "@t3tools/client-runtime/zerops/candidates";
import type { ZeropsContainerHealth } from "@t3tools/client-runtime/zerops/provisioning";

function CandidateRow({
  candidate,
  action,
}: {
  readonly candidate: ZeropsCandidate;
  readonly action?: ReactNode | undefined;
}) {
  return (
    <li className="flex items-center justify-between gap-4 rounded-xl border border-border/55 bg-card/20 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {candidate.project.name}
          </span>
          {candidate.service ? (
            <Badge size="sm" variant="outline">
              {candidate.service.name}
            </Badge>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {candidate.reason ?? candidate.containerOrigin ?? candidate.project.id}
        </p>
      </div>
      {action}
    </li>
  );
}

function CandidateGroup({
  title,
  description,
  candidates,
  renderAction,
}: {
  readonly title: string;
  readonly description: string;
  readonly candidates: ReadonlyArray<ZeropsCandidate>;
  readonly renderAction?: ((candidate: ZeropsCandidate) => ReactNode) | undefined;
}) {
  if (candidates.length === 0) return null;
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <ul className="space-y-2">
        {candidates.map((candidate) => (
          <CandidateRow
            key={candidate.key}
            candidate={candidate}
            action={renderAction?.(candidate)}
          />
        ))}
      </ul>
    </section>
  );
}

/** What a row says and offers, given what its container answered. */
function readyRowAction(input: {
  readonly candidate: ZeropsCandidate;
  readonly health: ZeropsContainerHealth | undefined;
  readonly onConnect: ((candidate: ZeropsCandidate) => void) | undefined;
  readonly onEnable: ((candidate: ZeropsCandidate) => void) | undefined;
}): ReactNode {
  const { candidate, health, onConnect, onEnable } = input;
  if (health === undefined) {
    return <Spinner className="size-4 text-muted-foreground" />;
  }
  // A container from before Zerops Code answers no route with a CORS header,
  // so from a browser it is indistinguishable from one that is simply away —
  // and the platform has already told us this service is ACTIVE. A restart is
  // the action that helps in either case, so it is what the row offers.
  if (health === "predates-z3" || health === "unreachable") {
    return onEnable ? (
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          onEnable(candidate);
        }}
      >
        Enable Zerops Code
      </Button>
    ) : null;
  }
  if (health !== "ready") {
    return <span className="text-xs text-muted-foreground">Starting…</span>;
  }
  return onConnect ? (
    <Button
      size="sm"
      onClick={() => {
        onConnect(candidate);
      }}
    >
      Connect
    </Button>
  ) : null;
}

/**
 * `onConnect` is supplied once identity bootstrap exists; without it the rows
 * are informational and no half-wired button is rendered.
 */
export function ZeropsProjectPicker({
  candidates,
  isLoading,
  error,
  health,
  onRefresh,
  onConnect,
  onEnable,
  onOpen,
  onWait,
}: {
  readonly candidates: ReadonlyArray<ZeropsCandidate>;
  readonly isLoading: boolean;
  readonly error: string | null;
  /** What each container answered, by candidate key; absent means still asking. */
  readonly health?: ReadonlyMap<string, ZeropsContainerHealth> | undefined;
  readonly onRefresh: () => void;
  readonly onConnect?: ((candidate: ZeropsCandidate) => void) | undefined;
  readonly onEnable?: ((candidate: ZeropsCandidate) => void) | undefined;
  readonly onOpen?: ((candidate: ZeropsCandidate) => void) | undefined;
  /** A project or container that is still on its way in — nothing to connect to yet. */
  readonly onWait?: ((candidate: ZeropsCandidate) => void) | undefined;
}) {
  const grouped = groupZeropsCandidates(candidates);
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
              {candidates.length} container{candidates.length === 1 ? "" : "s"} across your
              organizations
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
        candidates={grouped.connected}
        renderAction={
          onOpen
            ? (candidate) => (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onOpen(candidate);
                  }}
                >
                  Open
                </Button>
              )
            : undefined
        }
      />
      <CandidateGroup
        title="Ready to connect"
        description="A Zerops Code container is running and reachable."
        candidates={grouped.ready}
        renderAction={(candidate) =>
          readyRowAction({
            candidate,
            health: health?.get(candidate.key),
            onConnect,
            onEnable,
          })
        }
      />
      <CandidateGroup
        title="Preparing"
        description="Getting your project ready."
        candidates={grouped.provisioning}
        renderAction={
          onWait
            ? (candidate) => (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onWait(candidate);
                  }}
                >
                  Wait for it
                </Button>
              )
            : undefined
        }
      />
      <CandidateGroup
        title="Not available"
        description="Each row says what is in the way."
        candidates={grouped.unavailable}
      />

      {empty ? (
        <p className="text-sm text-muted-foreground">No projects in this account yet.</p>
      ) : null}
    </div>
  );
}
