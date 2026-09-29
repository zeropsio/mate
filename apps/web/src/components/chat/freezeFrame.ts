/**
 * A still picture of a conversation as it last stood, for the pane to hold
 * while the next one is placed (T1): its DOM copied whole, with what a copy
 * loses put back — where its scrollers stood, what was drawn into shadow
 * roots (a diff), what a canvas painted, and how far each animation had got,
 * so a working Mate's face keeps its pose and nothing that had risen in rises
 * again.
 *
 * The copy answers nothing: the host it goes into is inert, and it keeps no
 * ids or row keys a query of the page could find in place of the live
 * conversation's rows.
 */
export interface FreezeFrame {
  /** Puts the picture into `host`, standing exactly as the conversation did. */
  readonly mount: (host: HTMLElement) => void;
}

interface HeldAnimation {
  readonly target: Element;
  readonly pseudoElement: string | null;
  readonly name: string | null;
  readonly currentTime: CSSNumberish | null;
  readonly paused: boolean;
}

function animationName(animation: Animation): string | null {
  return "animationName" in animation ? String(animation.animationName) : null;
}

function pseudoElementOf(animation: Animation): string | null {
  const effect = animation.effect;
  return effect instanceof KeyframeEffect ? effect.pseudoElement : null;
}

function openShadowRoot(element: Element): ShadowRoot | null {
  try {
    return element.shadowRoot ?? element.attachShadow({ mode: "open" });
  } catch {
    return null;
  }
}

export function captureFreezeFrame(source: HTMLElement): FreezeFrame {
  const copy = source.cloneNode(true) as HTMLElement;
  const originals = new Map<Element, Element>();
  const scrolled: Array<{ readonly copy: Element; readonly top: number; readonly left: number }> =
    [];
  const canvases: Array<{ readonly source: HTMLCanvasElement; readonly copy: HTMLCanvasElement }> =
    [];

  const pairChildren = (from: ParentNode, to: ParentNode) => {
    let original = from.firstElementChild;
    let copied = to.firstElementChild;
    while (original !== null && copied !== null) {
      pair(original, copied);
      original = original.nextElementSibling;
      copied = copied.nextElementSibling;
    }
  };
  const pair = (original: Element, copied: Element) => {
    originals.set(copied, original);
    copied.removeAttribute("id");
    copied.removeAttribute("data-timeline-row-id");
    if (original.scrollTop !== 0 || original.scrollLeft !== 0) {
      scrolled.push({ copy: copied, top: original.scrollTop, left: original.scrollLeft });
    }
    if (original instanceof HTMLCanvasElement && copied instanceof HTMLCanvasElement) {
      canvases.push({ source: original, copy: copied });
    }
    const shadow = original.shadowRoot;
    if (shadow !== null) {
      const root = openShadowRoot(copied);
      if (root !== null) {
        root.adoptedStyleSheets = shadow.adoptedStyleSheets;
        root.replaceChildren(...Array.from(shadow.childNodes, (node) => node.cloneNode(true)));
        pairChildren(shadow, root);
      }
    }
    pairChildren(original, copied);
  };
  pair(source, copy);

  const held: HeldAnimation[] = source.getAnimations({ subtree: true }).flatMap((animation) => {
    const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
    return target === null
      ? []
      : [
          {
            target,
            pseudoElement: pseudoElementOf(animation),
            name: animationName(animation),
            currentTime: animation.currentTime,
            paused: animation.playState === "paused",
          },
        ];
  });

  return {
    mount(host) {
      host.replaceChildren(copy);
      for (const { copy: element, top, left } of scrolled) {
        element.scrollTop = top;
        element.scrollLeft = left;
      }
      for (const { source: canvas, copy: element } of canvases) {
        if (canvas.width > 0 && canvas.height > 0) {
          element.getContext("2d")?.drawImage(canvas, 0, 0);
        }
      }
      // The copy's animations start over as it goes in: each takes up where
      // its original stood, and one whose original had ended ends.
      for (const animation of copy.getAnimations({ subtree: true })) {
        const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
        const original = target === null ? undefined : originals.get(target);
        const match =
          original === undefined
            ? undefined
            : held.find(
                (candidate) =>
                  candidate.target === original &&
                  candidate.name === animationName(animation) &&
                  candidate.pseudoElement === pseudoElementOf(animation),
              );
        try {
          if (match === undefined) {
            animation.finish();
          } else {
            animation.currentTime = match.currentTime;
            if (match.paused) animation.pause();
          }
        } catch {
          // An endless animation cannot finish: it runs on from its start.
        }
      }
    },
  };
}
