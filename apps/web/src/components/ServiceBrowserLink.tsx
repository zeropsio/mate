import { createContext, useContext, useCallback, type ComponentProps } from "react";
import { ExternalLinkIcon, PanelRightIcon } from "lucide-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ZeropsTopologyService } from "@t3tools/client-runtime/zerops/topology";
import { serviceForPreview, isServiceBrowserUrl } from "../zerops/serviceBrowserPolicy";
import { useRightPanelStore } from "../rightPanelStore";

export type ServicePreviewResolver = (url: string) => (() => void) | null;
export const ServiceBrowserLinkContext = createContext<ServicePreviewResolver | null>(null);

function DestinationIndicator({ preview }: { preview: boolean }) {
  const Icon = preview ? PanelRightIcon : ExternalLinkIcon;
  return (
    <span
      className="ml-0.5 inline-flex shrink-0 align-baseline text-muted-foreground"
      data-link-indicator={preview ? "preview" : "external"}
    >
      <Icon aria-hidden="true" className="size-3" />
      <span className="sr-only">{preview ? "Open in side panel" : "Open in new tab"}</span>
    </span>
  );
}

/** For icon-only link buttons, whose children are supplied by Button. */
export function ServiceBrowserLinkIndicator({ href }: { href: string }) {
  const resolve = useContext(ServiceBrowserLinkContext);
  return <DestinationIndicator preview={Boolean(resolve?.(href))} />;
}

/** The same resolved destination drives the indicator and the click. */
export function ServiceBrowserLink({
  onClick,
  resolvePreview,
  showIndicator = true,
  children,
  ...props
}: ComponentProps<"a"> & { resolvePreview?: ServicePreviewResolver; showIndicator?: boolean }) {
  const contextResolve = useContext(ServiceBrowserLinkContext);
  const webLink = props.href !== undefined && isServiceBrowserUrl(props.href);
  const open = webLink ? (resolvePreview ?? contextResolve)?.(props.href!) : null;
  return (
    <a
      {...props}
      data-link-destination={webLink ? (open ? "preview" : "external") : undefined}
      onClick={(event) => {
        onClick?.(event);
        if (
          !open ||
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        open();
      }}
    >
      {children}
      {showIndicator && webLink ? <DestinationIndicator preview={Boolean(open)} /> : null}
    </a>
  );
}

/** The conversation supplies a single preview policy to cards and message links. */
export function ServiceBrowserScope({
  threadRef,
  services,
  children,
  ...props
}: ComponentProps<"div"> & {
  threadRef: ScopedThreadRef | null;
  services: readonly ZeropsTopologyService[] | undefined;
}) {
  const resolve = useCallback<ServicePreviewResolver>(
    (url) => {
      const service = serviceForPreview(url, services);
      if (!threadRef || !service) return null;
      return () => useRightPanelStore.getState().openService(threadRef, service, url);
    },
    [threadRef, services],
  );
  return (
    <ServiceBrowserLinkContext value={resolve}>
      <div {...props}>{children}</div>
    </ServiceBrowserLinkContext>
  );
}
