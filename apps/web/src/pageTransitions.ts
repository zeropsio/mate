/**
 * The overview, a project's page and a place's page are one place at three depths. Going among
 * them, by a card's name, a place's line, a crumb or Back, is one view transition in which the
 * page's content cross-fades and nothing else changes (`index.css`, "pages"). Every other
 * navigation, a conversation's included, cuts as it always has.
 *
 * It is the router's default, decided here from where a navigation leaves and where it lands, so
 * no link or `navigate` asks for it and none can forget to.
 */

/** The transition's type, as `index.css` selects it (`:active-view-transition-type(pages)`). */
const PAGES = "pages";
/** With it, the trail above the page's title is one element across the two pages. */
const PAGES_TRAIL = "pages-trail";

const PAGE_PATHS = [/^\/zerops\/?$/, /^\/group\/[^/]+\/flow\/?$/, /^\/group\/[^/]+\/[^/]+\/?$/];

/** Whether a path is the overview's, a project page's or a place page's. */
export function isOverviewPagePath(pathname: string): boolean {
  return PAGE_PATHS.some((path) => path.test(pathname));
}

const prefersStill = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Whether the trail of the page being left is in view (`Crumbs`' `page-crumbs`, inside the
 * frame's content region): only then does it hold still into the next page. One scrolled away
 * would travel in from where it was left, so there the next page's trail comes with its page.
 */
function trailInView(): boolean {
  if (typeof document === "undefined") return false;
  const trail = document.querySelector(".page-crumbs");
  const region = trail?.closest('[data-slot="sidebar-inset"]');
  if (trail == null || region == null) return false;
  const box = trail.getBoundingClientRect();
  const within = region.getBoundingClientRect();
  return box.height > 0 && box.top >= within.top && box.bottom <= within.bottom;
}

/**
 * The view transition types of one navigation, as the router asks for them: `pages` between two
 * of the three pages (and `pages-trail` while the trail is in view), none (`false`: no transition
 * at all) for anything else: the same page with another search, a conversation at either end, a
 * person who asked for less motion.
 */
export function pageTransitionTypes(change: {
  readonly fromLocation?: { readonly pathname: string } | undefined;
  readonly toLocation: { readonly pathname: string };
  readonly pathChanged: boolean;
}): Array<string> | false {
  if (!change.pathChanged || change.fromLocation === undefined || prefersStill()) return false;
  if (
    !isOverviewPagePath(change.fromLocation.pathname) ||
    !isOverviewPagePath(change.toLocation.pathname)
  ) {
    return false;
  }
  return trailInView() ? [PAGES, PAGES_TRAIL] : [PAGES];
}

/**
 * The router's `defaultViewTransition`, only where the browser tells one transition's type from
 * another's: without types the router would run the browser's whole-window cross-fade on every
 * navigation, so there the pages cut.
 */
export function pagesViewTransition():
  | { readonly defaultViewTransition: { readonly types: typeof pageTransitionTypes } }
  | Record<string, never> {
  const typed =
    typeof document !== "undefined" &&
    "startViewTransition" in document &&
    typeof CSS !== "undefined" &&
    CSS.supports("selector(:active-view-transition-type(a))");
  return typed ? { defaultViewTransition: { types: pageTransitionTypes } } : {};
}
