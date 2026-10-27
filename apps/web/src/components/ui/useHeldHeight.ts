import { useCallback, useImperativeHandle, useRef, type Ref } from "react";

/**
 * A box that never shrinks while it is open: its height holds the tallest its content has made
 * it, so a step that says less, a success that replaces a form, or a list that empties leaves its
 * top and its buttons where the person saw them. It still grows; a viewport smaller than what it
 * held caps it. The caller's own ref still reaches the box.
 */
export function useHeldHeight<T extends HTMLElement>(forwarded?: Ref<T>) {
  const box = useRef<T | null>(null);
  useImperativeHandle(forwarded, () => box.current as T, []);
  return useCallback((node: T | null) => {
    box.current = node;
    if (node === null || typeof ResizeObserver === "undefined") return;
    let held = 0;
    const observer = new ResizeObserver(() => {
      // The layout height, not the drawn one: an opening scale is not a size.
      const height = node.offsetHeight;
      if (height <= held + 0.5) return;
      held = height;
      node.style.minHeight = `min(${String(height)}px, 100%)`;
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      box.current = null;
    };
  }, []);
}
