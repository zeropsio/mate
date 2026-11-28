import { isBrowsableUrl } from "@t3tools/client-runtime/zerops/mateParts";
import { serviceForPreview } from "@t3tools/client-runtime/zerops/serviceBrowserPolicy";
import { isStageHostname } from "@t3tools/client-runtime/zerops/servicePairs";
import type { ZeropsTopologyService } from "@t3tools/client-runtime/zerops/topology";
import { useState } from "react";
import { CheckIcon, CopyIcon, ExternalLinkIcon, GlobeIcon, RotateCwIcon } from "lucide-react";
import type { RightPanelSurface } from "../rightPanelStore";
import { PanelBar } from "./ui/panel-bar";
import { Button, InlineButton } from "./ui/button";
import { Text } from "~/components/ui/text";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { formatDayAwareTimestamp } from "~/timestampFormat";
import type { YourAppHas } from "@t3tools/client-runtime/zerops/yourAppHas";

/** The conversation's application, whose stage's pane is Your app. */
export interface YourAppOf {
  /** The application's name, as HQ names it; absent unread. */
  readonly name: string | undefined;
  /** What each stage has, by its hostname (`useYourAppHas`); a stage missing here says nothing. */
  readonly has: ReadonlyMap<string, YourAppHas>;
}

/**
 * Your app's header, in the chat script's words: "guestbook · Add a guestbook page · added
 * 08:15 · version abc1234", never its host or its container. The title gives way, then the
 * time, never the app or the version: a cut version names none.
 */
function YourAppWords({
  name,
  has,
}: {
  readonly name: string | undefined;
  readonly has: YourAppHas | undefined;
}) {
  return (
    <Text className="flex min-w-0 flex-1" data-your-app-header="" render={<span />} variant="note">
      <span className="flex-none text-foreground">{name ?? "Your app"}</span>
      {/* As wide as its words: the title takes only what the time and the version leave. */}
      {has === undefined ? null : (
        <span className="flex min-w-0">
          <span className="min-w-0 flex-1 truncate">&nbsp;· {has.title}</span>
          <span className="min-w-0 truncate whitespace-pre">
            {" · added "}
            {formatDayAwareTimestamp(has.at, "locale")}
          </span>
          {has.version === undefined ? null : (
            <span className="flex-none whitespace-pre">{` · version ${has.version}`}</span>
          )}
        </span>
      )}
    </Text>
  );
}

/**
 * Your app's link, copied whole: the address its person sends. Its mark alone, as Sites' copy is,
 * so the header keeps room for what the app has.
 */
function CopyLink({ url }: { readonly url: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "link" });
  return (
    <Button
      aria-label={isCopied ? "Link copied" : "Copy link"}
      variant="ghost"
      size="icon-sm"
      title="Copy link"
      onClick={() => copyToClipboard(url, undefined)}
    >
      {isCopied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
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

/**
 * What a load of the frame is: the deployed version it follows and the manual
 * reload count. A new one remounts the frame on the address as shown.
 *
 * It rode in the address as a `_mate_preview` query until 2026-09-30, so an
 * identical `src` could not be answered from a stale heuristic cache (a static
 * site with `Last-Modified` and no `Cache-Control`). A page that routes on its
 * exact address answered it "Not found" (`req.url === "/"`: `/` 200,
 * `/?_mate_preview=…` 404, measured live). Nothing short of another address
 * reaches that cache: measured in Chrome, a cross-site frame remounted, its
 * `src` set again, a fragment, its location set or replaced, and a
 * `cache: "reload"` fetch from the parent (a partition of its own) all came
 * back from the cache, and `location.reload()` throws cross-origin. A page
 * that works is worth more than a fresh copy of one that caches itself.
 */
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
 *
 * The cookie note is the opposite case: it is true of every preview. A
 * `*.zerops.app` host is its own site (the public suffix list), so the frame
 * is cross-site wherever Mate runs, and a browser keeps out the cookies a
 * site sets without `SameSite=None` — measured 2026-09-29, Chrome refused a
 * Medusa storefront's cookie in the frame and stored it top-level. So sign-ins
 * and carts fail here. It is said on the way out, *Open in new tab*'s hover, never as a row over
 * the site: the panel is the address row and the site, edge to edge (the owner, 2026-10-18).
 */
function ServiceBrowserPanel({
  service,
  url,
  deployedVersion,
  yourApp,
}: {
  service: string;
  url: string;
  /** Set where this pane is Your app: its header says the app, never the host. */
  yourApp?: YourAppOf | undefined;
  /** {@link deployedVersionKey} of the service; a change reloads the page. */
  deployedVersion?: string | undefined;
}) {
  const [revision, setRevision] = useState(0);
  const [heldVersion, setHeldVersion] = useState(deployedVersion);
  const version = nextHeldVersion(heldVersion, deployedVersion);
  if (version !== heldVersion) setHeldVersion(version);
  if (!isBrowsableUrl(url)) return null;
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
      {/* The panel's one row above the page: where it is, reload, and the way out to a tab. */}
      <PanelBar data-site-address-row>
        <GlobeIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        {yourApp === undefined ? (
          <span className="flex min-w-0 flex-1 text-caption">
            <InlineButton
              tone="muted"
              className="max-w-full"
              render={<a href={url} target="_blank" rel="noreferrer" />}
            >
              <span className="truncate font-normal">
                {url.replace(/^https?:\/\//u, "").replace(/\/$/u, "")}
              </span>
            </InlineButton>
          </span>
        ) : (
          <YourAppWords has={yourApp.has.get(service)} name={yourApp.name} />
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Reload ${service}`}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RotateCwIcon />
        </Button>
        {/* The one control that survives a frame the site refused to draw, so
            it says what it is rather than making a person hover an icon over a
            blank page to find out. */}
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-muted-foreground"
          title="Browsers block most cookies here, so sign-ins and carts need a new tab."
          render={<a href={url} target="_blank" rel="noreferrer" />}
        >
          <ExternalLinkIcon />
          Open in new tab
        </Button>
        {yourApp === undefined ? null : <CopyLink url={url} />}
      </PanelBar>
      <iframe
        key={previewKey(version, revision)}
        title={`${service} live preview`}
        src={url}
        className="min-h-0 w-full flex-1 border-0 bg-background"
        sandbox={sandbox}
        referrerPolicy="no-referrer"
      />
    </section>
  );
}

const NO_ADDRESSES: ReadonlyArray<{ readonly url: string }> = [];

const hostnameOf = (href: string): string | null => {
  try {
    return new URL(href).hostname;
  } catch {
    return null;
  }
};

/** Keep each page mounted while switching tabs, preserving forms and in-page navigation. */
export function ServiceBrowserPanels({
  surfaces,
  activeSurfaceId,
  services,
  addresses = NO_ADDRESSES,
  addressesKnown = true,
  yourApp,
}: {
  surfaces: RightPanelSurface[];
  activeSurfaceId: string | null;
  services: readonly ZeropsTopologyService[] | undefined;
  /** The Mate's addresses outside its own project — its group's stage and production. */
  addresses?: ReadonlyArray<{ readonly url: string }>;
  /** Whether the account has read every project those addresses come from. */
  addressesKnown?: boolean;
  /** The conversation's Mate and its application, whose stage's pane is Your app. */
  yourApp?: YourAppOf | undefined;
}) {
  return surfaces.map((surface) => {
    if (surface.kind !== "browser" || !("url" in surface)) return null;
    const owner = serviceForPreview(surface.url, services);
    const host = hostnameOf(surface.url);
    const known =
      owner !== null ||
      (host !== null && addresses.some((address) => hostnameOf(address.url) === host));
    // A restored tab waits for what decides it rather than refusing and then loading.
    const deciding = !known && (services === undefined || !addressesKnown);
    return (
      <div
        key={`${surface.id}:${surface.url}`}
        className={surface.id === activeSurfaceId ? "h-full min-h-0" : "hidden"}
      >
        {deciding ? null : known ? (
          <ServiceBrowserPanel
            service={surface.service}
            url={surface.url}
            // A stage half is Your app, as its tab says (`RightPanelTabs`).
            yourApp={isStageHostname(surface.service) ? yourApp : undefined}
            deployedVersion={
              owner === null
                ? undefined
                : deployedVersionKey(
                    services?.find((service) => service.hostname === owner)?.deploy,
                  )
            }
          />
        ) : (
          <Text className="p-4" render={<p />} variant="description">
            Preview is available only for known service domains.{" "}
            <InlineButton render={<a href={surface.url} rel="noreferrer" target="_blank" />}>
              Open in new tab
            </InlineButton>
          </Text>
        )}
      </div>
    );
  });
}
