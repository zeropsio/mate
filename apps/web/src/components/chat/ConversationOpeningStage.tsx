import type { TimestampFormat } from "@t3tools/contracts/settings";
import type { ZeropsAgentActivity } from "../../zerops/agentActivity";
import { openingLimitWords } from "../../zerops/mateOpeningStage";
import type { ZeropsMateIdentity } from "~/zerops/mateIdentities";
import {
  createContext,
  cloneElement,
  use,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import { gatedPortal } from "../ui/portal-gate";
import {
  MateConnectionState,
  MATE_EMPTY_FACE_CLASS,
  type MateFaceSlot,
} from "../zerops/ZeropsMateEmptyState";
import type { MateFaceProps } from "../zerops/primitives/MateFace";

export type OpeningPhase = "waiting" | "wake" | "hand-off" | "complete";
type OpeningProps = {
  readonly activity?: ZeropsAgentActivity | undefined;
  readonly timestampFormat?: TimestampFormat | undefined;
  readonly notice?: ReactNode;
  readonly threadKey?: string | undefined;
  readonly ready: boolean;
  /** A held source skips the waiting pose; placement still owns `ready`. */
  readonly readPending?: boolean | undefined;
  readonly children?: ReactElement<{ readonly faceSlot?: MateFaceSlot }> | undefined;
  readonly name: string | undefined;
  readonly mate: Pick<
    ZeropsMateIdentity,
    "name" | "tint" | "shape" | "connected" | "project" | "projectId"
  > | null;
};
type StageSlot = OpeningProps & { readonly node: HTMLDivElement };
type AvatarSlot = { readonly node: HTMLSpanElement; readonly face: ReactElement<MateFaceProps> };
const Opening = createContext<{
  readonly stage: StageSlot | null;
  readonly setStage: (stage: StageSlot) => void;
  readonly setAvatar: (avatar: AvatarSlot) => void;
  readonly releaseStage: (node: HTMLDivElement) => void;
} | null>(null);

/** The route shell keeps the stage and its actual face through link/stand-up → chat replacement. */
export function ConversationOpeningProvider({ children }: { readonly children: ReactNode }) {
  const [opening, setStage] = useState<{
    stage: StageSlot | null;
    lastStage: StageSlot | null;
    cycle: number;
  }>({
    stage: null,
    lastStage: null,
    cycle: 0,
  });
  const { stage, lastStage, cycle } = opening;
  // A rendered gap ends the opening. Batched source → destination replacement has no gap.
  if (stage === null && lastStage !== null) setStage({ ...opening, lastStage: null });
  const completed = useRef(false);
  const [avatar, setAvatar] = useState<AvatarSlot | null>(null);
  const [host] = useState(() => document.createElement("div"));
  const registerStage = useCallback(
    (next: StageSlot) =>
      setStage((current) => {
        if (
          current.stage?.node === next.node &&
          current.stage.ready === next.ready &&
          current.stage.activity === next.activity &&
          current.stage.timestampFormat === next.timestampFormat &&
          current.stage.notice === next.notice &&
          current.stage.readPending === next.readPending &&
          current.stage.children === next.children &&
          current.stage.name === next.name &&
          current.stage.mate === next.mate &&
          current.stage.threadKey === next.threadKey
        )
          return current;
        const previous = current.lastStage;
        const newOpening =
          previous !== null &&
          ((previous.threadKey !== undefined &&
            next.threadKey !== undefined &&
            previous.threadKey !== next.threadKey) ||
            (previous.node !== next.node &&
              (completed.current || (previous.ready && !next.ready))));
        return { stage: next, lastStage: next, cycle: current.cycle + (newOpening ? 1 : 0) };
      }),
    [],
  );
  const releaseStage = useCallback(
    (node: HTMLDivElement) =>
      setStage((current) => (current.stage?.node === node ? { ...current, stage: null } : current)),
    [],
  );
  const onPhase = useCallback((phase: OpeningPhase) => {
    completed.current = phase === "complete";
  }, []);
  const sourceNode = stage?.node;
  useLayoutEffect(() => {
    if (sourceNode === undefined) return;
    sourceNode.appendChild(host);
    return () => host.remove();
  }, [host, sourceNode]);
  const context = useMemo(
    () => ({ stage, setStage: registerStage, setAvatar, releaseStage }),
    [stage, registerStage, releaseStage],
  );
  return (
    <Opening value={context}>
      {children}
      {stage === null
        ? null
        : createPortal(
            <OpeningSequence
              key={`${stage.mate?.projectId ?? ""}/${cycle}`}
              {...stage}
              avatar={avatar}
              onPhase={onPhase}
            />,
            host,
          )}
    </Opening>
  );
}

/** The destination keeps the button's geometry; the stage moves its one face into this slot. */
export const ConversationOpeningAvatar = gatedPortal(OpeningAvatar);

function OpeningAvatar({ children }: { readonly children: ReactElement<MateFaceProps> }) {
  const opening = use(Opening);
  const ref = useRef<HTMLSpanElement>(null);
  const setAvatar = opening?.setAvatar;
  useLayoutEffect(() => {
    if (ref.current !== null) setAvatar?.({ node: ref.current, face: children });
  }, [children, setAvatar]);
  return (
    <span className="relative block size-6 shrink-0" data-conversation-avatar="" ref={ref}>
      {opening?.stage?.mate == null ? children : null}
    </span>
  );
}

const OpeningLayer = createContext<HTMLDivElement | null>(null);

/** Keep the stage in the visible pane while its rows settle out of sight. */
export function ConversationOpeningLayer({ children }: { readonly children: ReactNode }) {
  const [host] = useState(() =>
    typeof document !== "undefined" && typeof document.createElement === "function"
      ? document.createElement("div")
      : null,
  );
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      if (node !== null && host !== null) node.appendChild(host);
    },
    [host],
  );
  return (
    <OpeningLayer value={host}>
      {children}
      <div className="pointer-events-none absolute inset-0 z-10" ref={attach} />
    </OpeningLayer>
  );
}

export const ConversationOpeningStage = gatedPortal(OpeningStage);

function OpeningStage({
  activity,
  timestampFormat,
  ready,
  name,
  mate,
  threadKey,
  readPending,
  children,
  notice,
}: OpeningProps) {
  const opening = use(Opening);
  const layer = use(OpeningLayer);
  const ref = useRef<HTMLDivElement>(null);
  const setStage = opening?.setStage;
  const releaseStage = opening?.releaseStage;
  useLayoutEffect(() => {
    const node = ref.current;
    return () => {
      if (node !== null) releaseStage?.(node);
    };
  }, [releaseStage]);
  useLayoutEffect(() => {
    if (ref.current !== null)
      setStage?.({
        activity,
        timestampFormat,
        ready,
        name,
        mate,
        threadKey,
        readPending,
        children,
        notice,
        node: ref.current,
      });
  }, [
    activity,
    timestampFormat,
    ready,
    name,
    mate,
    threadKey,
    readPending,
    children,
    notice,
    setStage,
  ]);
  const content =
    opening === null ? (
      <OpeningSequence
        activity={activity}
        timestampFormat={timestampFormat}
        ready={ready}
        name={name}
        mate={mate}
        readPending={readPending}
        notice={notice}
        avatar={null}
      >
        {children}
      </OpeningSequence>
    ) : (
      <div className="pointer-events-none absolute inset-0 z-10" ref={ref} />
    );
  return layer === null ? content : createPortal(content, layer);
}

function OpeningSequence({
  activity,
  timestampFormat,
  ready,
  name,
  mate,
  notice,
  avatar,
  onPhase,
  readPending = true,
  children,
  node,
}: OpeningProps & {
  readonly node?: HTMLDivElement;
  readonly avatar: AvatarSlot | null;
  readonly onPhase?: (phase: OpeningPhase) => void;
}) {
  const [phase, setPhase] = useState<OpeningPhase | "skipped">(
    ready || (!readPending && children === undefined) ? "skipped" : "waiting",
  );
  // The source owns its composition until hand-off; the destination cannot replace its words
  // or move its centred face while the eyes open.
  const [scene, setScene] = useState({
    node,
    content: children,
    name,
    mate,
    notice,
    activity,
    timestampFormat,
  });
  if (phase === "complete" && scene.content !== undefined) {
    setScene({ node, content: undefined, name, mate, notice, activity, timestampFormat });
  } else if (phase === "skipped" && !ready && children !== undefined) {
    setScene({ node, content: children, name, mate, notice, activity, timestampFormat });
    setPhase("waiting");
  } else if (
    phase === "waiting" &&
    !ready &&
    (scene.node === node || children !== undefined) &&
    (scene.content !== children ||
      scene.name !== name ||
      scene.mate !== mate ||
      scene.notice !== notice ||
      scene.activity !== activity ||
      scene.timestampFormat !== timestampFormat)
  ) {
    setScene({ node, content: children, name, mate, notice, activity, timestampFormat });
  }
  useLayoutEffect(() => {
    onPhase?.(phase === "skipped" ? "complete" : phase);
  }, [phase, onPhase]);
  const stage = useRef<HTMLDivElement>(null);
  const source = useRef<HTMLDivElement>(null);
  // A stable portal container moves between the two slots; neither React nor the browser clones it.
  const [faceHost] = useState(() =>
    typeof document !== "undefined" && typeof document.createElement === "function"
      ? document.createElement("span")
      : null,
  );
  const setSource = useCallback(
    (node: HTMLDivElement | null) => {
      source.current = node;
      if (node !== null && faceHost !== null && phase !== "complete" && phase !== "skipped")
        node.appendChild(faceHost);
    },
    [faceHost, phase],
  );
  const still =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (ready && phase === "waiting") setPhase(still || mate === null ? "complete" : "wake");
  if (still && (phase === "wake" || phase === "hand-off")) setPhase("complete");
  const finish = useCallback(
    () => setPhase((current) => (current === "waiting" ? current : "complete")),
    [],
  );
  useLayoutEffect(() => {
    if (faceHost === null || (phase !== "wake" && phase !== "hand-off")) return;
    const doc = stage.current?.ownerDocument ?? document;
    const media =
      typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    const reduced = () => {
      if (media?.matches) finish();
    };
    // These are the gestures the timeline observes too; scroll itself also comes from placement
    // and live-follow, so it cannot establish user intent.
    for (const event of ["pointerdown", "keydown", "wheel", "touchmove"])
      doc.addEventListener(event, finish, { capture: true, passive: true });
    media?.addEventListener("change", reduced);
    return () => {
      for (const event of ["pointerdown", "keydown", "wheel", "touchmove"])
        doc.removeEventListener(event, finish, true);
      media?.removeEventListener("change", reduced);
    };
  }, [phase, finish, faceHost]);
  useLayoutEffect(() => {
    if (faceHost === null) return;
    faceHost.setAttribute("data-opening-face", phase === "skipped" ? "complete" : phase);
    if (phase === "complete" || phase === "skipped") {
      faceHost.removeAttribute("style");
      if (avatar?.node.isConnected) avatar.node.appendChild(faceHost);
      else faceHost.remove();
      return;
    }
    source.current?.appendChild(faceHost);
    if (phase !== "hand-off") return;
    const from = source.current?.getBoundingClientRect();
    const to = avatar?.node.getBoundingClientRect();
    if (
      from === undefined ||
      to === undefined ||
      from.width <= 0 ||
      to.width <= 0 ||
      !avatar?.node.isConnected
    ) {
      finish();
      return;
    }
    Object.assign(faceHost.style, {
      position: "fixed",
      left: `${from.x}px`,
      top: `${from.y}px`,
      width: `${from.width}px`,
      height: `${from.height}px`,
    });
    faceHost.style.setProperty("--opening-x", `${to.x - from.x}px`);
    faceHost.style.setProperty("--opening-y", `${to.y - from.y}px`);
    faceHost.style.setProperty("--opening-scale", String(to.width / from.width));
  }, [phase, avatar?.node, faceHost, finish]);
  useLayoutEffect(() => () => faceHost?.remove(), [faceHost]);
  // Receive the source's native face and callbacks. The one portal keeps its component
  // through composition changes; only readiness transfers its pose to the sequence.
  const [sourceFace, receiveFace] = useState<ReactElement<MateFaceProps> | null>(null);
  const carryFace = (face: ReactElement<MateFaceProps>) =>
    faceHost === null ? (
      face
    ) : (
      <OpeningFaceSource face={face} receive={receiveFace} sourceRef={setSource} />
    );
  const renderFace = () => {
    if (faceHost === null || sourceFace === null) return null;
    const landed = phase === "complete" || phase === "skipped";
    const pose =
      landed && avatar !== null
        ? {
            ...avatar.face.props,
            className: avatar.face.props.className,
            style: avatar.face.props.style,
            greets: false,
            known: avatar.face.props.known ?? true,
            onRestartCycle: avatar.face.props.onRestartCycle,
            paces: avatar.face.props.paces ?? false,
            restarting: avatar.face.props.restarting ?? false,
            tracks: avatar.face.props.tracks ?? false,
            cues: avatar.face.props.cues,
          }
        : phase === "waiting"
          ? { className: "size-full" }
          : {
              className: "size-full",
              state: "idle" as const,
              greets: false,
              known: false,
              restarting: false,
              paces: false,
              tracks: false,
              cues: avatar?.face.props.cues,
            };
    return createPortal(
      <div
        className="relative size-full"
        data-opening-actor={landed ? "complete" : phase}
        onAnimationEnd={(event) => {
          if (
            event.animationName === "conversation-eye-open" &&
            phase === "wake" &&
            event.target instanceof Element &&
            event.target.getAttribute("data-mate-face-eye") === "left"
          )
            setPhase("hand-off");
        }}
      >
        {cloneElement(sourceFace, pose)}
      </div>,
      faceHost,
    );
  };
  if (phase === "skipped" && mate === null) return null;
  return (
    <>
      {renderFace()}
      <div
        aria-hidden={phase === "complete" || phase === "skipped" ? true : undefined}
        className={
          phase === "skipped"
            ? "invisible pointer-events-none absolute inset-0 z-10"
            : scene.content === undefined
              ? "pointer-events-none absolute inset-0 z-10"
              : "pointer-events-auto absolute inset-0 z-10"
        }
        data-conversation-opening={phase === "skipped" ? undefined : phase}
        ref={stage}
        onAnimationEnd={(event) => {
          if (
            event.target === event.currentTarget &&
            event.animationName === "conversation-handoff"
          )
            finish();
        }}
      >
        {scene.content !== undefined ? (
          cloneElement(scene.content, {
            faceSlot: carryFace,
          })
        ) : (
          <MateConnectionState
            notice={scene.notice}
            mate={scene.mate}
            face="waking"
            faceSlot={carryFace}
            headline={`${scene.name || "The Mate"} is opening the conversation.`}
            secondary={
              openingLimitWords(scene.activity, scene.name || "The Mate", scene.timestampFormat) ??
              "Picking up where you left off."
            }
            actions={null}
          />
        )}
      </div>
    </>
  );
}

function OpeningFaceSource({
  face,
  receive,
  sourceRef,
}: {
  readonly face: ReactElement<MateFaceProps>;
  readonly receive: (face: ReactElement<MateFaceProps>) => void;
  readonly sourceRef: (node: HTMLDivElement | null) => void;
}) {
  useLayoutEffect(() => receive(face), [face, receive]);
  return <div className={MATE_EMPTY_FACE_CLASS} ref={sourceRef} />;
}
