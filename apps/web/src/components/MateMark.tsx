import { MATE_MARK } from "@t3tools/shared/brand";
import { useEffect, useId, useRef } from "react";

import { cn } from "~/lib/utils";
import "./MateMark.css";

/** Brand presence only. It deliberately does not imply that a provider is online or working. */
export function MateMark({
  className,
  playful = false,
}: {
  className?: string;
  playful?: boolean;
}) {
  const clipId = useId();
  const markRef = useRef<SVGSVGElement>(null);
  const gazeRef = useRef<SVGGElement>(null);

  useEffect(() => {
    if (!playful) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame: number | undefined;
    let pointer = { x: 0, y: 0 };
    const resetGaze = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      gazeRef.current?.style.setProperty("transform", "translate(0px, 0px)");
    };
    const updateGaze = () => {
      frame = undefined;
      const bounds = markRef.current?.getBoundingClientRect();
      if (!bounds || !bounds.width || !bounds.height) return;
      const dx = pointer.x - (bounds.left + bounds.width / 2);
      const dy = pointer.y - (bounds.top + bounds.height / 2);
      const distance = Math.hypot(dx, dy);
      const reach = Math.max(240, Math.min(window.innerWidth, window.innerHeight) * 0.38);
      const strength = Math.tanh(distance / reach) / (distance || 1);
      const x = dx * strength * MATE_MARK.eyeWidth * 0.3;
      const y = dy * strength * MATE_MARK.eyeWidth * 0.22;
      gazeRef.current?.style.setProperty("transform", `translate(${x}px, ${y}px)`);
    };
    const followPointer = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || reducedMotion.matches || document.hidden) return;
      pointer = { x: event.clientX, y: event.clientY };
      // Coalesce mouse events; no frame is scheduled again once the pointer stops.
      frame ??= requestAnimationFrame(updateGaze);
    };
    const leaveWindow = (event: PointerEvent) => {
      if (event.relatedTarget === null) resetGaze();
    };
    window.addEventListener("pointermove", followPointer, { passive: true });
    window.addEventListener("pointerout", leaveWindow);
    window.addEventListener("pointercancel", resetGaze);
    window.addEventListener("blur", resetGaze);
    document.addEventListener("visibilitychange", resetGaze);
    reducedMotion.addEventListener("change", resetGaze);
    return () => {
      resetGaze();
      window.removeEventListener("pointermove", followPointer);
      window.removeEventListener("pointerout", leaveWindow);
      window.removeEventListener("pointercancel", resetGaze);
      window.removeEventListener("blur", resetGaze);
      document.removeEventListener("visibilitychange", resetGaze);
      reducedMotion.removeEventListener("change", resetGaze);
    };
  }, [playful]);

  return (
    <svg
      ref={markRef}
      aria-hidden="true"
      viewBox={MATE_MARK.viewBox}
      className={cn("mate-mark shrink-0", playful && "mate-mark-playful", className)}
    >
      {MATE_MARK.paths.map((d) => (
        <path key={d} d={d} fill={MATE_MARK.color} />
      ))}
      <g ref={gazeRef} className="mate-mark-gaze">
        <g className="mate-mark-eyes" fill="currentColor">
          {MATE_MARK.eyeXs.map((x) => (
            <rect
              key={x}
              x={x}
              y={MATE_MARK.eyeY}
              width={MATE_MARK.eyeWidth}
              height={MATE_MARK.eyeHeight}
              rx={MATE_MARK.eyeWidth / 2}
            />
          ))}
        </g>
      </g>
      {playful ? (
        <>
          <defs>
            <clipPath id={clipId}>
              <path d={MATE_MARK.silhouette} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clipId})`} fill={MATE_MARK.color}>
            <g transform="translate(8.5 28.62) rotate(-30)">
              <rect className="mate-mark-band-left" x="-16" y="0" width="31.714" height="7.9" />
              <rect className="mate-mark-band-right" x="14.514" y="0" width="31.486" height="7.9" />
            </g>
          </g>
        </>
      ) : null}
    </svg>
  );
}
