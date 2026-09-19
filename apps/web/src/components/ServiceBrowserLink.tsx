import { createContext, useContext, useCallback, type ComponentProps } from "react";
import { ExternalLinkIcon, PanelRightIcon } from "lucide-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ZeropsTopologyService } from "@t3tools/client-runtime/zerops/topology";
import { serviceForPreview, isServiceBrowserUrl } from "../zerops/serviceBrowserPolicy";
import { useRightPanelStore } from "../rightPanelStore";

export type ServicePreviewResolver = (url: string) => (() => void) | null;
export const ServiceBrowserLinkContext = createContext<ServicePreviewResolver | null>(null);

/**
 * A link this app can answer itself, rather than hand to the browser.
 *
 * A Mate writes a Gitea pull request address into its conversation, and that
 * address names a change this app draws in full — with its conversation, its
 * commits and its *Merge*. Following it out to a forge the reader has to sign
 * into is the long way round to a worse copy (the owner, 2026-09-19).
 *
 * Separate from the preview resolver above because the two go to different
 * places: a preview opens the side panel, this opens a page. It wears no
 * indicator for the same reason no other link inside the app does.
 */
export type AppLinkResolver = (url: string) => (() => void) | null;
export const AppLinkContext = createContext<AppLinkResolver | null>(null);

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
  const resolveApp = useContext(AppLinkContext);
  const webLink = props.href !== undefined && isServiceBrowserUrl(props.href);
  // A page inside this app wins over both a preview and a new tab: it is the
  // same change, drawn by the surface that owns it.
  const openInApp = (webLink ? resolveApp?.(props.href!) : null) ?? null;
  const open = openInApp ?? (webLink ? (resolvePreview ?? contextResolve)?.(props.href!) : null);
  return (
    <a
      {...props}
      data-link-destination={
        webLink ? (openInApp ? "app" : open ? "preview" : "external") : undefined
      }
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
      {showIndicator && webLink && openInApp === null ? (
        <DestinationIndicator preview={Boolean(open)} />
      ) : null}
    </a>
  );
}

/** The conversation supplies a single preview policy to cards and message links. */
export function ServiceBrowserScope({
  threadRef,
  services,
  resolveAppLink,
  children,
  ...props
}: ComponentProps<"div"> & {
  threadRef: ScopedThreadRef | null;
  services: readonly ZeropsTopologyService[] | undefined;
  /** Links this app answers itself — a change's address, above all. */
  resolveAppLink?: AppLinkResolver | undefined;
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
    <AppLinkContext value={resolveAppLink ?? null}>
      <ServiceBrowserLinkContext value={resolve}>
        <div {...props}>{children}</div>
      </ServiceBrowserLinkContext>
    </AppLinkContext>
  );
}
