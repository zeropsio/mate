import { useLayoutEffect, useState } from "react";

/**
 * Whether what `watch` is given runs past the lines it is clamped to — or,
 * `across`, past the width of its one line. Until it is measured — the first
 * render, before the page paints it — `guess`.
 */
export function useRunsPast(
  guess: boolean,
  across = false,
): readonly [boolean, (element: HTMLElement | null) => void] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [past, setPast] = useState(guess);
  useLayoutEffect(() => {
    if (element === null) return;
    const measure = () =>
      setPast(
        across
          ? element.scrollWidth > element.clientWidth + 1
          : element.scrollHeight > element.clientHeight + 1,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, across]);
  const [watch] = useState(() => (node: HTMLElement | null) => setElement(node));
  return [past, watch];
}
