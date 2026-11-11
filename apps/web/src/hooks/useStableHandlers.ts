import { useInsertionEffect, useRef, useState } from "react";

/**
 * The handlers a view hands to its memoised children, each with one identity for the view's life
 * and each calling the latest render's function. A view that reads many stores renders for every
 * one of them; a handler rebuilt on each of those renders makes every child it is handed to render
 * too — the header, the composer, each row of the conversation — for nothing they show.
 *
 * Only for handlers called from events and effects, never while rendering: a call during a render
 * would read the render before it.
 */
export function useStableHandlers<Handlers extends Record<string, (...args: never[]) => unknown>>(
  handlers: Handlers,
): Handlers {
  const latest = useRef(handlers);
  useInsertionEffect(() => {
    latest.current = handlers;
  });
  const [stable] = useState(
    () =>
      Object.fromEntries(
        Object.keys(handlers).map((name) => [
          name,
          (...args: never[]) => latest.current[name]?.(...args),
        ]),
      ) as Handlers,
  );
  return stable;
}
