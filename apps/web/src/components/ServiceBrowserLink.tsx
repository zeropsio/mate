import { createContext, useContext, type ComponentProps } from "react";

import { isServiceBrowserUrl } from "../rightPanelStore";

export const ServiceBrowserLinkContext = createContext<((url: string) => void) | null>(null);

/** Keep modified clicks and links outside a conversation native. */
export function ServiceBrowserLink({
  onClick,
  onOpen,
  ...props
}: ComponentProps<"a"> & { onOpen?: ((url: string) => void) | undefined }) {
  const contextOpen = useContext(ServiceBrowserLinkContext);
  const open = onOpen ?? contextOpen;
  return (
    <a
      {...props}
      onClick={(event) => {
        if (
          !open ||
          !props.href ||
          !isServiceBrowserUrl(props.href) ||
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          onClick?.(event);
          return;
        }
        event.preventDefault();
        open(props.href);
      }}
    />
  );
}
