import { serviceForPreview, isServiceBrowserUrl } from "../zerops/serviceBrowserPolicy";
import type { ZeropsTopologyService } from "@t3tools/client-runtime/zerops/topology";
import { useState } from "react";
import { ExternalLinkIcon, GlobeIcon, RotateCwIcon } from "lucide-react";
import type { RightPanelSurface } from "../rightPanelStore";
import { Button } from "./ui/button";

const PREVIEW_CACHE_PARAM = "_mate_preview";

/**
 * The address the frame loads: the service URL with one query parameter
 * carrying `key`, so a load the panel starts is never answered from a stale
 * HTTP cache. A static site served with `Last-Modified` and no `Cache-Control`
 * is heuristically cacheable, and an identical `src` came back as the page
 * from before a deploy.
 */
export function previewSrc(url: string, key: string): string {
  const src = new URL(url);
  // Appended to the query as written: re-serialising it through
  // `searchParams` would rewrite a page's own parameters (`?flag` → `?flag=`).
  const param = `${PREVIEW_CACHE_PARAM}=${encodeURIComponent(key)}`;
  src.search = src.search === "" ? param : `${src.search.slice(1)}&${param}`;
  return src.href;
}

/**
 * What tells the version a service runs from the next: when it went live. The
 * topology carries no version id; a pushed frame names the times but not the
 * name, so the name is only the fallback — joining both would read one deploy
 * as two as the frames alternate. Undefined while nothing names a version.
 */
export function deployedVersionKey(deploy: ZeropsTopologyService["deploy"]): string | undefined {
  return deploy?.activatedAt ?? deploy?.name;
}

/** A frame that names no version keeps the one named last rather than reloading the page. */
export function nextHeldVersion(
  held: string | undefined,
  incoming: string | undefined,
): string | undefined {
  return incoming ?? held;
}

/** The cache key of a load: the deployed version it follows and the manual reload count. */
export function previewKey(version: string | undefined, revision: number): string {
  return `${version ?? "none"}.${revision}`;
}

/**
 * Public websites run in the user's browser, independently of the agent's
 * browser session.
 *
 * It used to carry a permanent footer — "Page not showing? Some sites block
 * embedded previews." — under every preview, with a second *Open in new tab*
 * in it. Whether a frame painted cannot be read from here: measured in Chrome
 * 2026-09-19, a site that refuses framing and a site that does not both fire
 * `load` and both throw `SecurityError` on a cross-origin read, so the line
 * could never become conditional. A sentence that is wrong almost every time
 * it is shown, under a strip of preview it costs, is worse than the escape
 * hatch it duplicated — so the escape hatch keeps its words and the apology
 * goes.
 */
export function ServiceBrowserPanel({
  service,
  url,
  deployedVersion,
}: {
  service: string;
  url: string;
  /** {@link deployedVersionKey} of the service; a change reloads the page. */
  deployedVersion?: string | undefined;
}) {
  const [revision, setRevision] = useState(0);
  const [heldVersion, setHeldVersion] = useState(deployedVersion);
  const version = nextHeldVersion(heldVersion, deployedVersion);
  if (version !== heldVersion) setHeldVersion(version);
  if (!isServiceBrowserUrl(url)) return null;
  const src = previewSrc(url, previewKey(version, revision));
  // Public services need their own origin for storage and API requests. A page on
  // Mate's own origin must remain opaque so its scripts cannot remove the sandbox.
  const sandbox =
    "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads" +
    (typeof window !== "undefined" && new URL(url).origin !== window.location.origin
      ? " allow-same-origin"
      : "");
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background"
      aria-label={`${service} preview`}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <GlobeIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <a
          className="min-w-0 flex-1 truncate text-xs text-muted-foreground hover:text-foreground"
          href={url}
          target="_blank"
          rel="noreferrer"
        >
          {url}
        </a>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Reload ${service}`}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RotateCwIcon className="size-4" />
        </Button>
        {/* The one control that survives a frame the site refused to draw, so
            it says what it is rather than making a person hover an icon over a
            blank page to find out. */}
        <Button
          variant="ghost"
          size="compact"
          className="shrink-0 text-muted-foreground"
          render={<a href={url} target="_blank" rel="noreferrer" />}
        >
          <ExternalLinkIcon />
          Open in new tab
        </Button>
      </div>
      <iframe
        key={src}
        title={`${service} live preview`}
        src={src}
        className="min-h-0 w-full flex-1 border-0 bg-background"
        sandbox={sandbox}
        referrerPolicy="no-referrer"
      />
    </section>
  );
}

/** Keep each page mounted while switching tabs, preserving forms and in-page navigation. */
export function ServiceBrowserPanels({
  surfaces,
  activeSurfaceId,
  services,
}: {
  surfaces: RightPanelSurface[];
  activeSurfaceId: string | null;
  services: readonly ZeropsTopologyService[] | undefined;
}) {
  return surfaces.map((surface) => {
    if (surface.kind !== "browser" || !("url" in surface)) return null;
    const owner = serviceForPreview(surface.url, services);
    return (
      <div
        key={`${surface.id}:${surface.url}`}
        className={surface.id === activeSurfaceId ? "h-full min-h-0" : "hidden"}
      >
        {owner ? (
          <ServiceBrowserPanel
            service={surface.service}
            url={surface.url}
            deployedVersion={deployedVersionKey(
              services?.find((service) => service.hostname === owner)?.deploy,
            )}
          />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            Preview is available only for known service domains.{" "}
            <a className="underline" href={surface.url} target="_blank" rel="noreferrer">
              Open in new tab
            </a>
          </p>
        )}
      </div>
    );
  });
}
