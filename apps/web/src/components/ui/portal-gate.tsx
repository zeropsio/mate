import { createContext, use, type ComponentProps, type JSXElementConstructor } from "react";

const PortalGateContext = createContext(false);

/**
 * While `closed`, every floating layer below renders nothing: dialogs,
 * popovers, sheets, menus, tooltips, comboboxes and toasts leave the document
 * instead of sitting beside whatever covers the page.
 */
export function PortalGate({
  closed,
  children,
}: {
  readonly closed: boolean;
  readonly children: React.ReactNode;
}) {
  return <PortalGateContext value={closed}>{children}</PortalGateContext>;
}

/** `Portal` as a floating layer renders it, closed by the nearest `PortalGate`. */
export function gatedPortal<Portal extends JSXElementConstructor<any>>(Portal: Portal) {
  return function GatedPortal(props: ComponentProps<Portal>) {
    return use(PortalGateContext) ? null : <Portal {...props} />;
  };
}
