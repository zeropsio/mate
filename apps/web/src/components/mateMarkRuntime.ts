/**
 * The live mark's driver: identity v1's `mate()` loop, ported.
 *
 * One frame loop and one pointer listener serve every mark on the page, so a
 * sidebar mark and a hero mark cost one `requestAnimationFrame` between them,
 * not two.
 *
 * A face at rest costs nothing: the loop runs frames only while some mark is
 * moving — its eyes easing toward the pointer, the band opening or closing, a
 * blink, a smile — and stops once every mark has landed on its pose. What
 * starts motion again re-arms it: the pointer, a hover, a mark mounting or
 * coming into view, and one timer for what is scheduled (the next blink or
 * glance about, falling asleep). The idle bob and a waking Mate's swell are
 * the stylesheet's (`MateMark.css`), never a frame of script.
 *
 * Nothing here touches React state: a mark updates by writing attributes on
 * nodes it already holds, and only those whose value changed.
 *
 * Off-screen marks do no work; one coming back into view takes its pose at
 * once instead of easing into it where the person can see.
 */
import {
  MATE_MARK,
  MATE_MARK_LIDS,
  MATE_MARK_LIVE,
  type MateMarkState,
} from "@t3tools/shared/brand";

import { afterLayout } from "../lib/afterLayout";

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
/** The idle bob's angular speed, in radians a second — the stylesheet's period is 2π / this. */
const BOB_SPEED = 1.1;
/** The smallest rendered height, in px, at which the idle bob (0.3 of 52 units) can be seen. */
const BOB_MIN_HEIGHT = 48;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smoothstep = (t: number) => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};
/** How near a value must come to its target to have landed: below what any write can show. */
const LANDED = 1e-3;
/**
 * Frame-rate independent approach, so the motion is the same at 60 and 120 Hz — landing on the
 * target once within `LANDED` of it, so a mark at rest holds still values the loop can see are
 * settled.
 */
const lerpTo = (v: number, target: number, rate: number, dt: number) => {
  const next = v + (target - v) * (1 - Math.exp(-rate * dt));
  return Math.abs(next - target) < LANDED ? target : next;
};
const round = (v: number) => Math.round(v * 1000) / 1000;

interface MarkRuntime {
  readonly root: SVGSVGElement;
  readonly parts: LiveMarkParts;
  readonly forced: MateMarkState | undefined;
  readonly seed: number;
  /** The last value written per node and attribute, so a frame writes only what changed. */
  readonly written: Map<object, Map<string, string>>;
  hovered: boolean;
  visible: boolean;
  /** Back in view after a while out of it: the next frame takes the pose at once. */
  returning: boolean;
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
}

/** What one frame left of a mark: whether it still moves, and when it next will if not. */
interface MarkStep {
  readonly moving: boolean;
  /** The next scheduled change (a blink, a glance, a smile ending), or `Infinity`. */
  readonly due: number;
}

const AT_REST: MarkStep = { moving: false, due: Number.POSITIVE_INFINITY };

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
  /**
   * Runs `callback` once the page is next laid out, before it paints, where reading a box costs
   * no layout of its own. Absent, the loop reads its marks' boxes in the frame itself.
   */
  readonly afterLayout?: (callback: () => void) => void;
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
  /** A press: a pointer move that may also shift the layout (a panel toggling) a frame later. */
  readonly pointerDown: (x: number, y: number) => void;
  /** A key, which may shift the layout too. */
  readonly keyDown: () => void;
  /** The pointer left the window. */
  readonly pointerOut: () => void;
  /** The marks moved on the page (a scroll, a resize): measure them again. */
  readonly invalidateRects: () => void;
  readonly setVisible: (root: Element, visible: boolean) => void;
  /** Reduced motion was turned on or off: every mark takes its new pose at once. */
  readonly motionChanged: () => void;
  readonly size: () => number;
}

/**
 * How long after a press or a key the loop keeps measuring the marks: what the input does to the
 * layout (a panel opening, the menu folding) lands a frame or more after the input itself.
 */
const SETTLE_AFTER_INPUT_MS = 300;

export function createMarkLoop(host: MarkLoopHost): MarkLoop {
  const marks = new Set<MarkRuntime>();
  const pointer: Pointer = { x: 0, y: 0, on: false, activeAt: host.now(), asleep: false };
  let frame: number | undefined;
  let timer: unknown;
  /** When the last frame ran; `undefined` when the loop starts again after resting. */
  let lastFrameAt: number | undefined;
  /** Until when every frame measures the marks again, after an input that may move them. */
  let measureUntil = Number.NEGATIVE_INFINITY;

  const clearTimer = () => {
    if (timer === undefined) return;
    host.clearTimer(timer);
    timer = undefined;
  };

  /** Something may move: run frames until everything has landed again. */
  const arm = () => {
    if (frame !== undefined || marks.size === 0) return;
    clearTimer();
    lastFrameAt = undefined;
    frame = host.requestFrame(runFrame);
  };

  const wake = () => {
    pointer.activeAt = host.now();
    arm();
  };

  /** The marks whose boxes are read once the page is laid out (`host.afterLayout`). */
  const wanted = new Set<MarkRuntime>();
  const readWanted = () => {
    let moved = false;
    for (const mark of wanted) {
      if (!marks.has(mark)) continue;
      const was = mark.rect;
      const rect = mark.root.getBoundingClientRect();
      mark.rect = rect;
      moved ||=
        was === null ||
        was.left !== rect.left ||
        was.top !== rect.top ||
        was.width !== rect.width ||
        was.height !== rect.height;
    }
    wanted.clear();
    // The pose follows the box it now has, from the next frame.
    if (moved) arm();
  };
  /**
   * Reads where `mark` stands. In a frame the page's last draw is not laid out yet, so a box read
   * there forces that layout early (99 of them in a switch of Mates, 2026-10-06): it is read once
   * the browser has laid the page out, and the frame poses the mark at the box it read last.
   */
  const measure = (mark: MarkRuntime, now: number) => {
    mark.rectAt = now;
    if (host.afterLayout === undefined) {
      mark.rect = mark.root.getBoundingClientRect();
      return;
    }
    if (wanted.size === 0) host.afterLayout(readWanted);
    wanted.add(mark);
  };

  const settleAfterInput = () => {
    measureUntil = host.now() + SETTLE_AFTER_INPUT_MS;
  };

  const pointerMove = (x: number, y: number) => {
    pointer.x = x;
    pointer.y = y;
    pointer.on = true;
    wake();
  };

  const runFrame = (now: number) => {
    frame = undefined;
    const dt =
      lastFrameAt === undefined ? 0.016 : clamp((now - lastFrameAt) / 1000 || 0.016, 0.001, 0.05);
    lastFrameAt = now;
    const reduced = host.reducedMotion();
    pointer.asleep = !reduced && now - pointer.activeAt > SLEEP_AFTER_MS;
    // Just after an input that may have moved the marks, measure them every frame.
    let moving = now < measureUntil;
    let due = Number.POSITIVE_INFINITY;
    let shown = false;
    for (const mark of marks) {
      if (!mark.visible) continue;
      if (moving || mark.rectAt < 0 || now - mark.rectAt > 400) measure(mark, now);
      const step = tick(mark, pointer, host, now, dt, reduced);
      moving ||= step.moving;
      due = Math.min(due, step.due);
      shown = true;
    }
    if (moving) {
      frame = host.requestFrame(runFrame);
      return;
    }
    // At rest: wait for the pointer, or for the next thing scheduled — falling asleep included,
    // which stops even a held mark's eyes following the pointer.
    if (shown && !reduced && !pointer.asleep) {
      due = Math.min(due, pointer.activeAt + SLEEP_AFTER_MS + 1);
    }
    if (due === Number.POSITIVE_INFINITY) return;
    timer = host.setTimer(
      () => {
        timer = undefined;
        arm();
      },
      Math.max(0, due - host.now()),
    );
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
        written: new Map(),
        hovered: false,
        visible: true,
        returning: false,
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
        arm();
      };
      root.addEventListener("pointerenter", enter);
      root.addEventListener("pointerleave", leave);
      if (marks.size === 0) pointer.activeAt = now;
      marks.add(mark);
      arm();

      return () => {
        root.removeEventListener("pointerenter", enter);
        root.removeEventListener("pointerleave", leave);
        // What the loop wrote on the root, which outlives it: a mark turned still keeps no bob and
        // no turn, and one registered again starts from a clean root.
        root.removeAttribute("data-mate-mark-bob");
        root.style.removeProperty("--mate-mark-bob-delay");
        root.style.transform = "";
        marks.delete(mark);
        if (marks.size > 0) return;
        if (frame !== undefined) host.cancelFrame(frame);
        frame = undefined;
        clearTimer();
      };
    },
    pointerMove,
    pointerDown(x, y) {
      settleAfterInput();
      pointerMove(x, y);
    },
    keyDown() {
      settleAfterInput();
      wake();
    },
    pointerOut() {
      pointer.on = false;
      arm();
    },
    invalidateRects() {
      for (const mark of marks) mark.rectAt = -1;
      wake();
    },
    setVisible(root, visible) {
      for (const mark of marks) {
        if (mark.root !== root || mark.visible === visible) continue;
        mark.visible = visible;
        mark.returning = visible;
        // Out of view, it stops bobbing: the stylesheet would keep repainting it unseen. Back in
        // view, its next frame starts the bob again if it still rests.
        if (!visible && mark.written.get(root)?.get("data-mate-mark-bob") === "on") {
          put(mark, root, "data-mate-mark-bob", "off");
        }
      }
      if (visible) arm();
    },
    motionChanged() {
      for (const mark of marks) mark.returning = mark.visible;
      wake();
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

/** How far a waking Mate's band swells out, once every three seconds (`mate-mark-swell`). */
export const MARK_BREATH_DEPTH = 0.2;

/**
 * Where the band sits for a pose: in when asleep or waking, out otherwise. A waking Mate's slow
 * swell (`matePose`) rides on top of it in the stylesheet (`mate-mark-swell`), so the loop has
 * nothing to move while it waits.
 */
export function markBandTarget(state: MateMarkState): number {
  return state === "sleep" || state === "waking" ? 0 : 1;
}

function effectiveState(mark: MarkRuntime, pointer: Pointer, now: number): MateMarkState {
  if (mark.forced !== undefined) return mark.forced;
  if (mark.hovered) return "surprise";
  if (now < mark.smileUntil) return "done";
  if (pointer.asleep) return "sleep";
  return "idle";
}

/** Writes an attribute only when it differs from the last value this mark wrote there. */
function put(mark: MarkRuntime, node: Element | null | undefined, name: string, value: string) {
  if (!node) return;
  let written = mark.written.get(node);
  if (!written) {
    written = new Map();
    mark.written.set(node, written);
  }
  if (written.get(name) === value) return;
  written.set(name, value);
  node.setAttribute(name, value);
}

/** The same for a property of the node's inline style. */
function putStyle(mark: MarkRuntime, node: SVGSVGElement, name: string, value: string) {
  let written = mark.written.get(node.style);
  if (!written) {
    written = new Map();
    mark.written.set(node.style, written);
  }
  if (written.get(name) === value) return;
  written.set(name, value);
  if (name === "transform") node.style.transform = value;
  else node.style.setProperty(name, value);
}

function tick(
  mark: MarkRuntime,
  pointer: Pointer,
  host: MarkLoopHost,
  now: number,
  delta: number,
  reduced: boolean,
): MarkStep {
  // Back in view: take the pose at once rather than easing into it in sight, and let a blink
  // that fell due while it was away wait its turn.
  const dt = mark.returning ? 1 : delta;
  if (mark.returning) {
    mark.returning = false;
    if (mark.nextBlink <= now) mark.nextBlink = now + 2500 + host.random() * 4000;
  }
  const rect = mark.rect;
  if (!rect || !rect.width) return AT_REST;

  const state = effectiveState(mark, pointer, now);
  if (state !== mark.effective) {
    mark.effective = state;
    mark.effectiveAt = now;
  }
  const since = (now - mark.effectiveAt) / 1000;
  let moving = false;
  let due = Number.POSITIVE_INFINITY;

  // The band: in when asleep or waking, out otherwise. The eyes reveal as it clears.
  const target = markBandTarget(state);
  mark.band = lerpTo(mark.band, target, target < 0.5 ? 7 : 9, dt);
  moving ||= mark.band !== target;
  const open = mark.band;
  const reveal = smoothstep((open - 0.3) / 0.6);
  const awake = open > 0.6;

  if (mark.parts.band) {
    if (open < 0.998) {
      put(mark, mark.parts.band, "visibility", "visible");
      const dx = round(open * TRAVEL * COS30);
      const dy = round(open * TRAVEL * SIN30);
      put(mark, mark.parts.bandLeft, "transform", `translate(${-dx},${dy})`);
      put(mark, mark.parts.bandRight, "transform", `translate(${dx},${-dy})`);
    } else {
      put(mark, mark.parts.band, "visibility", "hidden");
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
  } else {
    if (now >= mark.wanderAt) {
      mark.wanderAt = now + 2400 + host.random() * 2600;
      const centre = host.random() < 0.35;
      mark.targetX = centre ? 0 : host.random() * 1.4 - 0.7;
      mark.targetY = centre ? 0 : host.random() * 1 - 0.5;
    }
    due = Math.min(due, mark.wanderAt);
  }
  mark.gazeX = lerpTo(mark.gazeX, mark.targetX, 11, dt);
  mark.gazeY = lerpTo(mark.gazeY, mark.targetY, 11, dt);
  moving ||= mark.gazeX !== mark.targetX || mark.gazeY !== mark.targetY;

  const tilt = following ? MATE_MARK_LIVE.tilt : 0;
  const rotXTarget = -mark.gazeY * tilt;
  const rotYTarget = mark.gazeX * tilt;
  mark.rotX = lerpTo(mark.rotX, rotXTarget, 5.5, dt);
  mark.rotY = lerpTo(mark.rotY, rotYTarget, 5.5, dt);
  moving ||= mark.rotX !== rotXTarget || mark.rotY !== rotYTarget;

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
    if (mark.blinkAt >= 0) moving = true;
    else due = Math.min(due, mark.nextBlink);
  }
  mark.openness = lerpTo(mark.openness, targetOpen, 26, dt);
  mark.width = lerpTo(mark.width, targetWide, 14, dt);
  mark.lift = lerpTo(mark.lift, targetLift, 14, dt);
  moving ||= mark.openness !== targetOpen || mark.width !== targetWide || mark.lift !== targetLift;

  const sinY = Math.sin(mark.rotY * DEG);
  const sinX = Math.sin(mark.rotX * DEG);
  const offsetX = 0.3 * U * mark.gazeX + PARALLAX * sinY;
  const offsetY = 0.22 * U * mark.gazeY - PARALLAX * sinX;
  const happy = state === "done";

  put(mark, mark.parts.eyes, "visibility", reveal > 0.01 ? "visible" : "hidden");
  const eyeSlots = [
    [mark.parts.eyeLeft, mark.parts.happyLeft, MATE_MARK_LIVE.eyeCentres[0] + offsetX],
    [mark.parts.eyeRight, mark.parts.happyRight, MATE_MARK_LIVE.eyeCentres[1] + offsetX],
  ] as const;
  for (const [rect_, arc, cx] of eyeSlots) {
    put(mark, rect_, "visibility", happy ? "hidden" : "visible");
    put(mark, arc, "visibility", happy ? "visible" : "hidden");
    if (happy) {
      put(
        mark,
        arc,
        "transform",
        `translate(${round(cx)},${round(MATE_MARK_LIVE.eyeCentreY + offsetY + 0.05 * U)})`,
      );
      continue;
    }
    const w = EYE_W * mark.width + (1 - Math.min(1, mark.openness)) * 0.15 * U;
    const h = Math.max(0.22 * U, EYE_H * mark.openness) * reveal;
    const cy = MATE_MARK_LIVE.eyeCentreY + offsetY + mark.lift * U;
    put(mark, rect_, "x", String(round(cx - w / 2)));
    put(mark, rect_, "y", String(round(cy - h / 2)));
    put(mark, rect_, "width", String(round(w)));
    put(mark, rect_, "height", String(round(h)));
    put(mark, rect_, "rx", String(round(Math.min(w, h) / 2)));
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
      moving ||= since < 0.26;
      put(mark, mark.parts.mouth, "visibility", "visible");
      put(
        mark,
        mark.parts.mouth,
        "transform",
        `translate(${round(21.59 + offsetX * 0.6)},${round(MATE_MARK_LIVE.mouth.y + offsetY * 0.6)}) scale(${round(pop)})`,
      );
      put(mark, mark.parts.mouthO, "visibility", showO ? "inherit" : "hidden");
      put(mark, mark.parts.mouthSmile, "visibility", happy ? "inherit" : "hidden");
    } else {
      put(mark, mark.parts.mouth, "visibility", "hidden");
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
      put(
        mark,
        layers[i],
        "transform",
        `translate(${round((i + 1) * stepX)},${round((i + 1) * stepY)})`,
      );
    }
    put(mark, mark.parts.sides, "opacity", String(round(clamp(magnitude / 0.2, 0, 1))));
  }

  if (mark.parts.svg) {
    putStyle(
      mark,
      mark.parts.svg,
      "transform",
      Math.abs(mark.rotX) + Math.abs(mark.rotY) > 0.02
        ? `perspective(${Math.round(rect.width * 3.2)}px) rotateX(${round(mark.rotX)}deg) rotateY(${round(mark.rotY)}deg)`
        : "",
    );
    // The idle bob is the stylesheet's (`mate-mark-bob`), started in step with where the sine
    // `sin(1.1 t + seed)` stands now: its keyframes begin at the trough. Only a mark large enough
    // to show it carries one at all: below `BOB_MIN_HEIGHT` it would move a fifth of a pixel and
    // repaint the mark every frame for it (Chrome composites no animation on an SVG element).
    const wasBobbing = mark.written.get(mark.parts.svg)?.get("data-mate-mark-bob");
    if (rect.height >= BOB_MIN_HEIGHT) {
      const bobbing = state === "idle" && awake && !reduced;
      if (bobbing && wasBobbing !== "on") {
        const phase = ((now / 1000) * BOB_SPEED + mark.seed + Math.PI / 2) % (2 * Math.PI);
        putStyle(mark, mark.parts.svg, "--mate-mark-bob-delay", `${-round(phase / BOB_SPEED)}s`);
      }
      put(mark, mark.parts.svg, "data-mate-mark-bob", bobbing ? "on" : "off");
    } else if (wasBobbing === "on") {
      put(mark, mark.parts.svg, "data-mate-mark-bob", "off");
    }
  }

  // Done, it hops: the one bob left to the loop, and it ends.
  const hopping = happy && since < 1.8;
  moving ||= hopping;
  const bobY = hopping ? -Math.abs(Math.sin(since * 5)) * 1.6 * (1 - since / 1.8) : 0;
  put(mark, mark.parts.bob, "transform", `translate(0,${round(bobY)})`);

  if (mark.forced === undefined && !mark.hovered && now < mark.smileUntil) {
    due = Math.min(due, mark.smileUntil);
  }
  return { moving, due };
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
  afterLayout,
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

function onPointerDown(event: PointerEvent) {
  pageLoop?.pointerDown(event.clientX, event.clientY);
}

function onKeyDown() {
  pageLoop?.keyDown();
}

function onMotionChanged() {
  pageLoop?.motionChanged();
}

let reducedMotionQuery: MediaQueryList | undefined;

function onMoved() {
  pageLoop?.invalidateRects();
}

function startListening() {
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerdown", onPointerDown, { passive: true });
  window.addEventListener("pointerout", onPointerOut);
  window.addEventListener("blur", onBlur);
  window.addEventListener("keydown", onKeyDown);
  // Captured, so a scroll inside any panel moves the marks' boxes too, not only the window's.
  window.addEventListener("scroll", onMoved, { passive: true, capture: true });
  window.addEventListener("resize", onMoved);
  reducedMotionQuery = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
  reducedMotionQuery?.addEventListener("change", onMotionChanged);
}

function stopListening() {
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerdown", onPointerDown);
  window.removeEventListener("pointerout", onPointerOut);
  window.removeEventListener("blur", onBlur);
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("scroll", onMoved, { capture: true });
  window.removeEventListener("resize", onMoved);
  reducedMotionQuery?.removeEventListener("change", onMotionChanged);
  reducedMotionQuery = undefined;
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
