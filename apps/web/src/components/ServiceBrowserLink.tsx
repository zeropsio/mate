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
 * A Mate writes its change's address at HQ into its conversation, and that
 * address names a change this app draws in full — with its conversation, its
 * commits and its *Merge*. Following it out of the app is the long way round to
 * a worse copy (the owner, 2026-09-19).
 *
 * Separate from the preview resolver above because the two go to different
 * places: a preview opens the side panel, this opens a page. It wears no
 * indicator for the same reason no other link inside the app does.
 */
export type AppLinkResolver = (url: string) => (() => void) | null;
export const AppLinkContext = createContext<AppLinkResolver | null>(null);

/**
 * Where a link goes: a small mark after its words, or — inside running text —
 * only the words, said to whoever cannot see the link's leading mark. A mark
 * after a link's last word sat between it and the sentence's full stop
 * ("…/app ▯."); the owner, 2026-09-30: "so painful". The word joiner ties the
 * mark to the last word, so a wrapping link never leaves it alone on a line.
 */
function DestinationIndicator({
  preview,
  indicator = "glyph",
}: {
  preview: boolean;
  indicator?: LinkIndicator | undefined;
}) {
  const words = preview ? "Open in side panel" : "Open in new tab";
  if (indicator === "words") {
    return (
      <span className="sr-only" data-link-indicator={preview ? "preview" : "external"}>
        {words}
      </span>
    );
  }
  const Icon = preview ? PanelRightIcon : ExternalLinkIcon;
  return (
    <span
      className="whitespace-nowrap text-muted-foreground"
      data-link-indicator={preview ? "preview" : "external"}
    >
      {"\u2060"}
      <Icon aria-hidden="true" className="ms-0.5 inline size-3 align-baseline" />
      <span className="sr-only">{words}</span>
    </span>
  );
}

/** For icon-only link buttons, whose children are supplied by Button. */
export function ServiceBrowserLinkIndicator({ href }: { href: string }) {
  const resolve = useContext(ServiceBrowserLinkContext);
  return <DestinationIndicator preview={Boolean(resolve?.(href))} />;
}

/** How a link shows where it goes: a mark after its words, or the words alone to a reader. */
export type LinkIndicator = "glyph" | "words";

export type LinkDestination = "app" | "preview" | "external";

/**
 * Where a web link goes and what a click on it does: a page of this app, the
 * side panel's preview, or a new tab. Undefined for a link that is not a web
 * address (mail, a fragment, a file).
 */
export function useLinkDestination(
  href: string | undefined,
  resolvePreview?: ServicePreviewResolver,
): { destination: LinkDestination | undefined; open: (() => void) | null } {
  const contextResolve = useContext(ServiceBrowserLinkContext);
  const resolveApp = useContext(AppLinkContext);
  if (href === undefined || !isServiceBrowserUrl(href))
    return { destination: undefined, open: null };
  // A page inside this app wins over both a preview and a new tab: it is the
  // same change, drawn by the surface that owns it.
  const openInApp = resolveApp?.(href) ?? null;
  if (openInApp) return { destination: "app", open: openInApp };
  const open = (resolvePreview ?? contextResolve)?.(href) ?? null;
  return { destination: open ? "preview" : "external", open };
}

/** The same resolved destination drives the indicator and the click. */
export function ServiceBrowserLink({
  onClick,
  resolvePreview,
  showIndicator = true,
  indicator,
  children,
  ...props
}: ComponentProps<"a"> & {
  resolvePreview?: ServicePreviewResolver;
  showIndicator?: boolean;
  indicator?: LinkIndicator | undefined;
}) {
  const { destination, open } = useLinkDestination(props.href, resolvePreview);
  return (
    <a
      {...props}
      data-link-destination={destination}
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
      {showIndicator && (destination === "preview" || destination === "external") ? (
        <DestinationIndicator preview={destination === "preview"} indicator={indicator} />
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
