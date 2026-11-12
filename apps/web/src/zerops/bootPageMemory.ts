/**
 * What index.html's first frame draws of the page beside the menu, as this page stood when it was
 * left: the loading rows' tone, the menu's edge and top band, and the menu's and the header's own
 * controls, each where the app's first frame will draw it, so the two
 * frames are one picture and the app's adds only what needs the app: the stage, the names and the
 * person's picture. Written as the page is left
 * (a reload leaves it, `bootFrame.ts`), read by index.html's inline script, and used only for
 * the same address, window and appearance. Nothing live is kept: places, sizes and colours only.
 */

const box = (element: Element) => {
  const { left, top, width, height } = element.getBoundingClientRect();
  return [left, top, width, height].map(Math.round);
};

const MENU = '[data-zerops-surface="sidebar-menu"]';
/** Controls drawn the same on every load: the menu's (any address) and the header's (this one). */
const MENU_ICONS = `${MENU} [data-zerops-surface="sidebar-top-actions"] svg, ${MENU} [data-slot="sidebar-footer"] svg`;
const PAGE_ICONS = "main [data-chat-header] [data-panel-layout-controls] svg";
/** What an icon is drawn from: plain shapes and their numbers, never markup. */
const SHAPES = new Set(["path", "circle", "rect", "line", "polyline", "ellipse"]);
const NUMBERS = /^(?:d|points|c[xy]|r[xy]?|x[12]?|y[12]?|width|height)$/u;

const painted = (element: Element) =>
  element.checkVisibility({ visibilityProperty: true, opacityProperty: true });

function icon(svg: Element, page: boolean) {
  const style = getComputedStyle(svg);
  return {
    at: box(svg),
    page,
    color: style.color,
    opacity: Number(style.opacity) * Number(getComputedStyle(svg.parentElement ?? svg).opacity),
    stroke: svg.getAttribute("stroke-width") ?? "2",
    shapes: [...svg.children]
      .filter((shape) => SHAPES.has(shape.tagName))
      .map((shape) => [
        shape.tagName,
        Object.fromEntries(
          [...shape.attributes]
            .filter((attribute) => NUMBERS.test(attribute.name))
            .map((attribute) => [attribute.name, attribute.value]),
        ),
      ]),
  };
}

/** The page's frame as it stands now, for the next load's first frame (`rememberBootPageOnLeave`). */
export function bootPage(): Record<string, unknown> {
  const root = document.documentElement;
  const page: Record<string, unknown> = {
    path: window.location.pathname,
    vw: window.innerWidth,
    vh: window.innerHeight,
    dark: root.classList.contains("dark"),
    row: getComputedStyle(root).getPropertyValue("--sidebar-row-hover").trim(),
  };
  // The menu's edge is the open menu's own line where it draws one, else the column's.
  const edge = [document.querySelector(MENU), document.querySelector("[data-app-sidebar]")]
    .flatMap((element) => (element === null ? [] : [getComputedStyle(element)]))
    .find((style) => style.borderRightWidth !== "0px");
  if (edge !== undefined) page.edge = edge.borderRightColor;
  // The menu's top row: its band, which the Chief's row and its place both stand on.
  const top = document.querySelector(
    `${MENU} :is([data-zerops-surface="sidebar-chief-row"], [data-zerops-surface="sidebar-chief-place"] a)`,
  );
  if (top !== null && painted(top)) {
    const style = getComputedStyle(top);
    page.top = { at: box(top), surface: style.backgroundColor, radius: style.borderTopLeftRadius };
  }
  // The header's own controls, closed: an open panel's stand-in draws others.
  const closed = (svg: Element) => svg.closest("button")?.getAttribute("aria-pressed") !== "true";
  page.icons = [
    ...[...document.querySelectorAll(MENU_ICONS)].filter(painted).map((svg) => icon(svg, false)),
    ...[...document.querySelectorAll(PAGE_ICONS)]
      .filter((svg) => painted(svg) && closed(svg))
      .map((svg) => icon(svg, true)),
  ];
  // The seat the header's Review door takes after the Mate's name, as wide as it stood: the next
  // load holds it for the door, which the menu's fill brings (`doorSeatStood`).
  const door = document.querySelector(
    "main [data-chat-header] .chat-header-review:not([data-seat])",
  );
  // To the hundredth: a seat a pixel wider than its door moved the subject by that pixel.
  if (door !== null && painted(door))
    page.door = Math.round(door.getBoundingClientRect().width * 100) / 100;
  return page;
}
