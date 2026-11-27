import { useAtomValue } from "@effect/atom-react";
import { makeDraftPreviewWire } from "@t3tools/client-runtime/data";
import type { EnvironmentId } from "@t3tools/contracts";
import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { RotateCwIcon } from "lucide-react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { connectionAtomRuntime } from "~/connection/runtime";
import type { RightPanelSurface } from "~/rightPanelStore";
import { useMateNames, useProjectFlows } from "~/zerops/projectFlows";
import { Button } from "~/components/ui/button";
import { PanelBar } from "~/components/ui/panel-bar";
import { Text } from "~/components/ui/text";
import { useDraftChange, useMatePreviews } from "./review/reviewReads";
import {
  draftPane,
  draftPaneFace,
  sameCopy,
  unheldDraftFace,
  type DraftPaneFace,
  type DraftPaneState,
} from "./DraftPanel.logic";

const registryAtom = connectionAtomRuntime.atom(
  Effect.map(EnvironmentRegistry, (registry) => registry),
);
type DraftSurface = Extract<RightPanelSurface, { kind: "draft" }>;

/** The pane's display is also used by the design flow for each state. */
export function DraftPaneView({
  title,
  face,
  onReload,
  onRetry,
}: {
  readonly title: string;
  readonly face: DraftPaneFace;
  readonly onReload: () => void;
  readonly onRetry: () => void;
}) {
  const frame = face.frame;
  const sandbox =
    "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads" +
    (frame !== undefined &&
    typeof window !== "undefined" &&
    new URL(frame).origin !== window.location.origin
      ? " allow-same-origin"
      : "");
  return (
    <section className="flex h-full min-h-0 flex-col bg-background" aria-label={`Draft ${title}`}>
      <PanelBar>
        <div className="min-w-0 flex-1">
          <div className="truncate text-caption">
            Draft · {title}
            {face.notInApp ? " · not in your app yet" : null}
          </div>
          {face.notInApp ? (
            <Text variant="description">
              Only you see this, here in Mate.
              {face.stateLine === undefined ? null : ` ${face.stateLine}`}
            </Text>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Reload draft"
          disabled={!face.reload}
          onClick={onReload}
        >
          <RotateCwIcon />
        </Button>
      </PanelBar>
      {frame !== undefined ? (
        <iframe
          title={`Draft · ${title}`}
          src={frame}
          className="min-h-0 w-full flex-1 border-0 bg-background"
          sandbox={sandbox}
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="p-4">
          {face.line === undefined ? null : (
            <Text render={<p />} variant="description">
              {face.line}
            </Text>
          )}
          {face.retry ? (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}

function LoadedDraft({
  surface,
  environmentId,
  pull,
}: {
  readonly surface: DraftSurface;
  readonly environmentId: EnvironmentId;
  readonly pull: NonNullable<ReturnType<typeof useDraftChange>["pull"]>;
}) {
  const apps = useMemo(() => [surface.groupId], [surface.groupId]);
  const flow = useProjectFlows(apps).flows.get(surface.groupId);
  const { draft } = useMatePreviews(
    surface.groupId,
    pull.mateProjectId,
    flow?.mateTier,
    pull.repository,
    pull.repositoryUrl,
    pull.merged
      ? "merged"
      : pull.state === "closed"
        ? "closed"
        : pull.state === "adding"
          ? "adding"
          : pull.state === "merging"
            ? "merging"
            : "open",
    pull.mateGone === true,
    pull.branch,
  );
  const mateName = useMateNames().get(pull.mateProjectId) ?? "the Mate";
  const registry = Option.getOrUndefined(AsyncResult.value(useAtomValue(registryAtom)));
  const [state, dispatch] = useReducer(draftPane, { kind: "idle" });
  const mountHandled = useRef(false);
  const started = useRef<DraftPaneState | null>(null);
  useEffect(() => {
    if (mountHandled.current || draft.kind !== "openable") return;
    mountHandled.current = true;
    dispatch({ type: "mount", copy: draft.copy });
  }, [draft]);
  useEffect(() => {
    if (
      state.kind !== "ended" &&
      (draft.kind === "added" ||
        draft.kind === "discarded" ||
        draft.kind === "unavailable" ||
        (draft.kind === "openable" && "copy" in state && !sameCopy(state.copy, draft.copy)))
    )
      dispatch({ type: "invalidate", inFlight: started.current === state });
  }, [draft, state]);
  useEffect(() => {
    if (
      state.kind !== "opening" ||
      state.invalidated === true ||
      draft.kind !== "openable" ||
      !sameCopy(state.copy, draft.copy) ||
      registry === undefined ||
      started.current === state
    )
      return;
    started.current = state;
    void makeDraftPreviewWire(registry)(environmentId, state.copy).then(
      (answer) => dispatch({ type: "answer", answer }),
      (error: unknown) =>
        dispatch({
          type: "error",
          reason: error instanceof Error ? error.message : "The draft could not be opened.",
        }),
    );
  }, [state, draft, registry, environmentId]);
  return (
    <DraftPaneView
      title={pull.title}
      face={draftPaneFace(draft, state, mateName)}
      onReload={() => {
        if (draft.kind === "openable") dispatch({ type: "reload", copy: draft.copy });
      }}
      onRetry={() => {
        if (state.kind === "failed" && draft.kind === "openable")
          dispatch({ type: "retry", copy: draft.copy });
      }}
    />
  );
}

function DraftPanel({
  surface,
  environmentId,
}: {
  readonly surface: DraftSurface;
  readonly environmentId: EnvironmentId;
}) {
  const { pull, read } = useDraftChange(surface);
  if (pull === undefined)
    return (
      <DraftPaneView
        title="Draft"
        face={unheldDraftFace(read)}
        onReload={() => {}}
        onRetry={() => {}}
      />
    );
  return <LoadedDraft surface={surface} environmentId={environmentId} pull={pull} />;
}

/** Kept mounted across tab switches, so a draft and its in-flight opening remain one pane. */
export function DraftPanels({
  surfaces,
  activeSurfaceId,
  environmentId,
}: {
  readonly surfaces: readonly RightPanelSurface[];
  readonly activeSurfaceId: string | null;
  readonly environmentId: EnvironmentId;
}) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    setOpened((before) => {
      const next = new Set(
        [...before].filter((id) => surfaces.some((surface) => surface.id === id)),
      );
      if (
        activeSurfaceId !== null &&
        surfaces.some((surface) => surface.kind === "draft" && surface.id === activeSurfaceId)
      )
        next.add(activeSurfaceId);
      return next.size === before.size && [...next].every((id) => before.has(id)) ? before : next;
    });
  }, [activeSurfaceId, surfaces]);
  return surfaces.map((surface) =>
    surface.kind !== "draft" ||
    (surface.id !== activeSurfaceId && !opened.has(surface.id)) ? null : (
      <div
        key={surface.id}
        className={surface.id === activeSurfaceId ? "h-full min-h-0" : "hidden"}
      >
        <DraftPanel surface={surface} environmentId={environmentId} />
      </div>
    ),
  );
}
