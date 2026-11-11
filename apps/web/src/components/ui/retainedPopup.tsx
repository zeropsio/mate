import { type ComponentProps, createContext, type ReactNode, use, useState } from "react";

/** A controlled dialog's own `open`, so its content is held as soon as its owner closes it. */
export const ControlledOpenContext = createContext<boolean | undefined>(undefined);

/**
 * While a popup closes, its owner often clears the record it shows; the exit animation keeps the
 * last open content instead of an emptied one.
 */
function RetainedWhileClosed({ open, children }: { open: boolean; children: ReactNode }) {
  const controlledOpen = use(ControlledOpenContext);
  const isOpen = open && controlledOpen !== false;
  const [retained, setRetained] = useState(children);
  if (isOpen && retained !== children) {
    setRetained(children);
  }
  return isOpen ? children : retained;
}

export function renderRetainedPopup(props: ComponentProps<"div">, state: { open: boolean }) {
  return (
    <div {...props}>
      <RetainedWhileClosed open={state.open}>{props.children}</RetainedWhileClosed>
    </div>
  );
}
