/**
 * The live mark's driver: identity v1's `mate()` loop, ported.
 *
 * One frame loop and one pointer listener serve every mark on the page, so a
 * sidebar mark and a hero mark cost one `requestAnimationFrame` between them,
 * not two. The loop starts with the first live mark and stops with the last —
 * a page with only still marks never schedules a frame at all.
 *
 * Nothing here touches React state: a mark updates by writing attributes on
 * nodes it already holds, so a 60 Hz animation never re-renders a component.
 *
 * Off-screen marks fall back to 4 Hz rather than stopping, so one scrolling
 * back into view is already in the right pose instead of snapping into it.
 */
import {
  MATE_MARK,
  MATE_MARK_LIDS,
  MATE_MARK_LIVE,
  type MateMarkState,
} from "@t3tools/shared/brand";

export interface LiveMarkParts {
  svg?: SVGSVGElement | null;
  bob?: SVGGElement | null;
  sides?: SVGGElement | null;
  band?: SVGGElement | null;
  bandLeft?: SVGPathElement | null;
  bandRight?: SVGPathElement | null;
  eyes?: SVGGElement | null;
  eyeLeft?: SVGRectElement | null;
  eyeRight?: SVGRectElement | null;
  happyLeft?: SVGPathElement | null;
  happyRight?: SVGPathElement | null;
  mouth?: SVGGElement | null;
  mouthO?: SVGCircleElement | null;
  mouthSmile?: SVGPathElement | null;
}

const U = MATE_MARK_LIVE.eyeUnit;
const EYE_W = MATE_MARK.eyeWidth;
const EYE_H = MATE_MARK.eyeHeight;
const { cos30: COS30, sin30: SIN30, travel: TRAVEL } = MATE_MARK_LIVE.band;
/** Screen-unit nudges in identity v1's 100-box, expressed in logo units. */
const PARALLAX = 2 / (88 / 50.48);
const SLEEP_AFTER_MS = 45_000;
const DEG = Math.PI / 180;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smoothstep = (t: number) => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};
/** Frame-rate independent approach, so the motion is the same at 60 and 120 Hz. */
const lerpTo = (v: number, target: number, rate: number, dt: number) =>
  v + (target - v) * (1 - Math.exp(-rate * dt));
const round = (v: number) => Math.round(v * 1000) / 1000;

interface MarkRuntime {
  readonly root: SVGSVGElement;
  readonly parts: LiveMarkParts;
  readonly forced: MateMarkState | undefined;
  readonly seed: number;
  hovered: boolean;
  visible: boolean;
  rect: DOMRect | null;
  rectAt: number;
  band: number;
  gazeX: number;
  gazeY: number;
  targetX: number;
  targetY: number;
  rotX: number;
  rotY: number;
  openness: number;
  width: number;
  lift: number;
  blinkAt: number;
  nextBlink: number;
  wanderAt: number;
  smileUntil: number;
  effective: MateMarkState;
  effectiveAt: number;
  offscreenAt: number;
}

/**
 * What the loop needs from the page: a clock, frames, timers and the viewport. The page's own is
 * `browserHost`; a test hands it a fake one and steps time itself.
 */
export interface MarkLoopHost {
  readonly now: () => number;
  readonly requestFrame: (callback: (now: number) => void) => number;
  readonly cancelFrame: (handle: number) => void;
  readonly setTimer: (callback: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
  readonly reducedMotion: () => boolean;
  readonly random: () => number;
  readonly viewport: () => { readonly width: number; readonly height: number };
}

/** The one loop every mark on a page shares, and what moves it. */
export interface MarkLoop {
  readonly register: (
    root: SVGSVGElement,
    parts: LiveMarkParts,
    forced: MateMarkState | undefined,
    options?: { readonly awake?: boolean },
  ) => () => void;
  readonly pointerMove: (x: number, y: number) => void;
  /** The pointer left the window. */
  readonly pointerOut: () => void;
  /** Something the person did that is not a pointer move: a key, a scroll. */
  readonly wake: () => void;
  /** The marks moved on the page (a scroll, a resize): measure them again. */
  readonly invalidateRects: () => void;
  readonly setVisible: (root: Element, visible: boolean) => void;
  readonly size: () => number;
}

export function createMarkLoop(host: MarkLoopHost): MarkLoop {
  const marks = new Set<MarkRuntime>();
  const pointer = { x: 0, y: 0, on: false, activeAt: host.now(), asleep: false };
  let frame: number | undefined;
  let lastFrameAt = 0;

  const wake = () => {
    pointer.activeAt = host.now();
  };

  const runFrame = (now: number) => {
    const dt = clamp((now - lastFrameAt) / 1000 || 0.016, 0.001, 0.05);
    lastFrameAt = now;
    const reduced = host.reducedMotion();
    pointer.asleep = !reduced && now - pointer.activeAt > SLEEP_AFTER_MS;
    for (const mark of marks) tick(mark, pointer, host, now, dt, reduced);
    frame = marks.size > 0 ? host.requestFrame(runFrame) : undefined;
  };

  return {
    register(root, parts, forced, options = {}) {
      const now = host.now();
      const reduced = host.reducedMotion();
      const mark: MarkRuntime = {
        root,
        parts,
        forced,
        seed: host.random() * Math.PI * 2,
        hovered: false,
        visible: true,
        rect: null,
        rectAt: -1,
        // Reduced motion opens the mark at once and never animates it shut; so does a mark that
        // takes over from the still one, already open.
        band: reduced || options.awake === true ? 1 : 0,
        gazeX: 0,
        gazeY: 0,
        targetX: 0,
        targetY: 0,
        rotX: 0,
        rotY: 0,
        openness: 1,
        width: 1,
        lift: 0,
        blinkAt: -1,
        nextBlink: now + 1500 + host.random() * 3000,
        wanderAt: now + 1200,
        smileUntil: 0,
        effective: "idle",
        effectiveAt: now,
        offscreenAt: now,
      };

      const enter = () => {
        mark.hovered = true;
        wake();
      };
      const leave = () => {
        // A hover that surprised it leaves a smile behind on the way out.
        if (mark.hovered && mark.forced === undefined && mark.band > 0.9) {
          mark.smileUntil = host.now() + 700;
        }
        mark.hovered = false;
      };
      root.addEventListener("pointerenter", enter);
      root.addEventListener("pointerleave", leave);
      if (marks.size === 0) wake();
      marks.add(mark);
      if (frame === undefined) {
        lastFrameAt = now;
        frame = host.requestFrame(runFrame);
      }

      return () => {
        root.removeEventListener("pointerenter", enter);
        root.removeEventListener("pointerleave", leave);
        marks.delete(mark);
        if (marks.size === 0) {
          if (frame !== undefined) host.cancelFrame(frame);
          frame = undefined;
        }
      };
    },
    pointerMove(x, y) {
      pointer.x = x;
      pointer.y = y;
      pointer.on = true;
      wake();
    },
    pointerOut() {
      pointer.on = false;
    },
    wake,
    invalidateRects() {
      for (const mark of marks) mark.rectAt = -1;
      wake();
    },
    setVisible(root, visible) {
      for (const mark of marks) if (mark.root === root) mark.visible = visible;
    },
    size: () => marks.size,
  };
}

interface Pointer {
  x: number;
  y: number;
  on: boolean;
  activeAt: number;
  asleep: boolean;
}

/** A waking Mate's breath: one swell and settle every three seconds, a fifth of the band out. */
const BREATH_SECONDS = 3;
const BREATH_DEPTH = 0.2;

/**
 * Where the band sits for a pose, at a moment in seconds: in when asleep, out when awake — and
 * waking (`matePose`), in with a slow low swell, still under reduced motion.
 */
export function markBandTarget(state: MateMarkState, seconds: number, reduced: boolean): number {
  if (state === "sleep") return 0;
  if (state !== "waking") return 1;
  if (reduced) return 0;
  return (BREATH_DEPTH * (1 - Math.cos((2 * Math.PI * seconds) / BREATH_SECONDS))) / 2;
}

function effectiveState(mark: MarkRuntime, pointer: Pointer, now: number): MateMarkState {
  if (mark.forced !== undefined) return mark.forced;
  if (mark.hovered) return "surprise";
  if (now < mark.smileUntil) return "done";
  if (pointer.asleep) return "sleep";
  return "idle";
}

function tick(
  mark: MarkRuntime,
  pointer: Pointer,
  host: MarkLoopHost,
  now: number,
  delta: number,
  reduced: boolean,
) {
  let dt = delta;
  if (!mark.visible) {
    if (now - mark.offscreenAt < 250) return;
    dt = Math.min(0.3, (now - mark.offscreenAt) / 1000);
    mark.offscreenAt = now;
  }
  if (mark.rectAt < 0 || now - mark.rectAt > 400) {
    mark.rect = mark.root.getBoundingClientRect();
    mark.rectAt = now;
  }
  const rect = mark.rect;
  if (!rect || !rect.width) return;

  const state = effectiveState(mark, pointer, now);
  if (state !== mark.effective) {
    mark.effective = state;
    mark.effectiveAt = now;
  }
  const since = (now - mark.effectiveAt) / 1000;

  // The band: in when asleep or waking, out otherwise. The eyes reveal as it clears.
  const target = markBandTarget(state, now / 1000, reduced);
  mark.band = lerpTo(mark.band, target, target < 0.5 ? 7 : 9, dt);
  const open = mark.band;
  const reveal = smoothstep((open - 0.3) / 0.6);
  const awake = open > 0.6;

  if (mark.parts.band) {
    if (open < 0.998) {
      mark.parts.band.setAttribute("visibility", "visible");
      const dx = round(open * TRAVEL * COS30);
      const dy = round(open * TRAVEL * SIN30);
      mark.parts.bandLeft?.setAttribute("transform", `translate(${-dx},${dy})`);
      mark.parts.bandRight?.setAttribute("transform", `translate(${dx},${-dy})`);
    } else {
      mark.parts.band.setAttribute("visibility", "hidden");
    }
  }

  // Where to look.
  const following = pointer.on && !pointer.asleep && awake && !reduced;
  if (following) {
    const dx = pointer.x - (rect.left + rect.width / 2);
    const dy = pointer.y - (rect.top + rect.height / 2);
    const distance = Math.hypot(dx, dy) || 1;
    const viewport = host.viewport();
    const reach = Math.max(240, Math.min(viewport.width, viewport.height) * 0.38);
    const gain = Math.tanh(distance / reach);
    mark.targetX = (gain * dx) / distance;
    mark.targetY = (gain * dy) / distance;
  } else if (!awake || pointer.asleep || reduced) {
    mark.targetX = 0;
    mark.targetY = 0;
  } else if (now >= mark.wanderAt) {
    mark.wanderAt = now + 2400 + host.random() * 2600;
    const centre = host.random() < 0.35;
    mark.targetX = centre ? 0 : host.random() * 1.4 - 0.7;
    mark.targetY = centre ? 0 : host.random() * 1 - 0.5;
  }
  mark.gazeX = lerpTo(mark.gazeX, mark.targetX, 11, dt);
  mark.gazeY = lerpTo(mark.gazeY, mark.targetY, 11, dt);

  const tilt = following ? MATE_MARK_LIVE.tilt : 0;
  mark.rotX = lerpTo(mark.rotX, -mark.gazeY * tilt, 5.5, dt);
  mark.rotY = lerpTo(mark.rotY, mark.gazeX * tilt, 5.5, dt);

  // Lids, with a blink folded in while idle.
  let [targetOpen, targetWide, targetLift] = MATE_MARK_LIDS[state] ?? MATE_MARK_LIDS.idle;
  if (!reduced && (state === "idle" || state === "working") && awake) {
    if (mark.blinkAt < 0 && now >= mark.nextBlink) mark.blinkAt = now;
    if (mark.blinkAt >= 0) {
      if (now - mark.blinkAt < 140) targetOpen = 0;
      else {
        mark.blinkAt = -1;
        mark.nextBlink = now + 2500 + host.random() * 4000;
      }
    }
  }
  mark.openness = lerpTo(mark.openness, targetOpen, 26, dt);
  mark.width = lerpTo(mark.width, targetWide, 14, dt);
  mark.lift = lerpTo(mark.lift, targetLift, 14, dt);

  const sinY = Math.sin(mark.rotY * DEG);
  const sinX = Math.sin(mark.rotX * DEG);
  const offsetX = 0.3 * U * mark.gazeX + PARALLAX * sinY;
  const offsetY = 0.22 * U * mark.gazeY - PARALLAX * sinX;
  const happy = state === "done";

  mark.parts.eyes?.setAttribute("visibility", reveal > 0.01 ? "visible" : "hidden");
  const eyeSlots = [
    [mark.parts.eyeLeft, mark.parts.happyLeft, MATE_MARK_LIVE.eyeCentres[0] + offsetX],
    [mark.parts.eyeRight, mark.parts.happyRight, MATE_MARK_LIVE.eyeCentres[1] + offsetX],
  ] as const;
  for (const [rect_, arc, cx] of eyeSlots) {
    rect_?.setAttribute("visibility", happy ? "hidden" : "visible");
    arc?.setAttribute("visibility", happy ? "visible" : "hidden");
    if (happy) {
      arc?.setAttribute(
        "transform",
        `translate(${round(cx)},${round(MATE_MARK_LIVE.eyeCentreY + offsetY + 0.05 * U)})`,
      );
      continue;
    }
    const w = EYE_W * mark.width + (1 - Math.min(1, mark.openness)) * 0.15 * U;
    const h = Math.max(0.22 * U, EYE_H * mark.openness) * reveal;
    const cy = MATE_MARK_LIVE.eyeCentreY + offsetY + mark.lift * U;
    rect_?.setAttribute("x", String(round(cx - w / 2)));
    rect_?.setAttribute("y", String(round(cy - h / 2)));
    rect_?.setAttribute("width", String(round(w)));
    rect_?.setAttribute("height", String(round(h)));
    rect_?.setAttribute("rx", String(round(Math.min(w, h) / 2)));
  }

  const showO = (state === "needs" || state === "surprise") && awake;
  if (mark.parts.mouth) {
    if (showO || happy) {
      const pop =
        since < 0.12
          ? 0.5 + 0.6 * (since / 0.12)
          : since < 0.26
            ? 1.1 - 0.1 * ((since - 0.12) / 0.14)
            : 1;
      mark.parts.mouth.setAttribute("visibility", "visible");
      mark.parts.mouth.setAttribute(
        "transform",
        `translate(${round(21.59 + offsetX * 0.6)},${round(MATE_MARK_LIVE.mouth.y + offsetY * 0.6)}) scale(${round(pop)})`,
      );
      mark.parts.mouthO?.setAttribute("visibility", showO ? "inherit" : "hidden");
      mark.parts.mouthSmile?.setAttribute("visibility", happy ? "inherit" : "hidden");
    } else {
      mark.parts.mouth.setAttribute("visibility", "hidden");
    }
  }

  // The turn: the extruded wall fades in only once the slab actually moves.
  const magnitude = Math.hypot(mark.rotX, mark.rotY) / MATE_MARK_LIVE.tilt;
  const layers = mark.parts.sides?.children;
  if (layers) {
    const count = layers.length;
    const stepX = (-MATE_MARK_LIVE.depth / count) * sinY;
    const stepY = (MATE_MARK_LIVE.depth / count) * sinX;
    for (let i = 0; i < count; i += 1) {
      layers[i]?.setAttribute(
        "transform",
        `translate(${round((i + 1) * stepX)},${round((i + 1) * stepY)})`,
      );
    }
    mark.parts.sides?.setAttribute("opacity", String(round(clamp(magnitude / 0.2, 0, 1))));
  }

  if (mark.parts.svg) {
    mark.parts.svg.style.transform =
      Math.abs(mark.rotX) + Math.abs(mark.rotY) > 0.02
        ? `perspective(${Math.round(rect.width * 3.2)}px) rotateX(${round(mark.rotX)}deg) rotateY(${round(mark.rotY)}deg)`
        : "";
  }

  const bobY = happy
    ? -Math.abs(Math.sin(since * 5)) * 1.6 * Math.max(0, 1 - since / 1.8)
    : state === "idle" && awake && !reduced
      ? Math.sin((now / 1000) * 1.1 + mark.seed) * 0.3
      : 0;
  mark.parts.bob?.setAttribute("transform", `translate(0,${round(bobY)})`);
}

const browserHost: MarkLoopHost = {
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  reducedMotion: () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  random: Math.random,
  viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
};

let pageLoop: MarkLoop | undefined;
let observer: IntersectionObserver | undefined;

function onPointerMove(event: PointerEvent) {
  pageLoop?.pointerMove(event.clientX, event.clientY);
}

function onPointerOut(event: PointerEvent) {
  if (event.relatedTarget === null) pageLoop?.pointerOut();
}

function onBlur() {
  pageLoop?.pointerOut();
}

function onWake() {
  pageLoop?.wake();
}

function onMoved() {
  pageLoop?.invalidateRects();
}

function startListening() {
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerdown", onPointerMove, { passive: true });
  window.addEventListener("pointerout", onPointerOut);
  window.addEventListener("blur", onBlur);
  window.addEventListener("keydown", onWake);
  window.addEventListener("scroll", onMoved, { passive: true });
  window.addEventListener("resize", onMoved);
}

function stopListening() {
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerdown", onPointerMove);
  window.removeEventListener("pointerout", onPointerOut);
  window.removeEventListener("blur", onBlur);
  window.removeEventListener("keydown", onWake);
  window.removeEventListener("scroll", onMoved);
  window.removeEventListener("resize", onMoved);
}

/**
 * Adds one mark to the page's shared loop. Returns the unsubscribe the caller's
 * effect cleanup runs — the last one out stops the loop and the listeners, so
 * nothing keeps ticking after the marks unmount.
 */
export function registerLiveMark(
  root: SVGSVGElement,
  parts: LiveMarkParts,
  forced: MateMarkState | undefined,
  options: { readonly awake?: boolean } = {},
): () => void {
  const loop = (pageLoop ??= createMarkLoop(browserHost));
  if (loop.size() === 0) startListening();
  const unregister = loop.register(root, parts, forced, options);
  if (typeof IntersectionObserver === "function") {
    observer ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) pageLoop?.setVisible(entry.target, entry.isIntersecting);
      },
      { rootMargin: "120px" },
    );
    observer.observe(root);
  }
  return () => {
    observer?.unobserve(root);
    unregister();
    if (loop.size() === 0) stopListening();
  };
}
