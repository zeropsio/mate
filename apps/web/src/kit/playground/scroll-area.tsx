import { ScrollArea } from "~/components/ui/scroll-area";

import { definePlayground, jsxElement } from "../kitPlayground";

/** What overflows its frame: a long list down, one long command line across. */
const OVERFLOWS = ["down", "across"] as const;
const RADII = ["inherit", "none"] as const;

const DEPLOYS = Array.from(
  { length: 24 },
  (_, index) => `Deploy ${String(24 - index)}: built in ${String(30 + index)}s`,
);

export default definePlayground({
  section: "scroll-area",
  name: "ScrollArea",
  imports: 'import { ScrollArea } from "~/components/ui/scroll-area";',
  controls: {
    overflow: { kind: "enum", options: OVERFLOWS, note: "what overflows the frame" },
    scrollFade: { kind: "boolean", note: "the edges fade where more is hidden" },
    hideScrollbars: { kind: "boolean", note: "it scrolls with no bar drawn" },
    scrollbarGutter: { kind: "boolean", note: "room kept for the bar so nothing shifts" },
    radius: { kind: "enum", options: RADII, note: "none: a region flush to an edge" },
  },
  initial: {
    overflow: "down",
    scrollFade: false,
    hideScrollbars: false,
    scrollbarGutter: false,
    radius: "inherit",
  },
  render: ({ overflow, scrollFade, hideScrollbars, scrollbarGutter, radius }) => (
    <div
      className={
        overflow === "down" ? "h-56 w-64 rounded-card border" : "h-20 w-64 rounded-card border"
      }
    >
      <ScrollArea
        hideScrollbars={hideScrollbars}
        radius={radius}
        scrollFade={scrollFade}
        scrollbarGutter={scrollbarGutter}
      >
        {overflow === "down" ? (
          <div className="flex flex-col gap-1 p-3 text-body">
            {DEPLOYS.map((deploy) => (
              <span key={deploy}>{deploy}</span>
            ))}
          </div>
        ) : (
          <div className="w-max p-3 font-mono text-body">
            zcli push --service-id storefront --workspace-state all --verbose
          </div>
        )}
      </ScrollArea>
    </div>
  ),
  jsx: ({ scrollFade, hideScrollbars, scrollbarGutter, radius }) =>
    jsxElement("ScrollArea", { scrollFade, hideScrollbars, scrollbarGutter, radius }, "…", {
      scrollFade: false,
      hideScrollbars: false,
      scrollbarGutter: false,
      radius: "inherit",
    }),
  usage: {
    do: [
      "Scroll a region inside a frame of fixed size: a sheet's body, a panel, a long menu.",
      "Fade its edges where cut-off content would otherwise read as the end.",
      "Keep the gutter where content appearing would shift a bar in.",
    ],
    dont: [
      "Nest one in another on the same axis.",
      "Scroll the whole page with it: the page scrolls itself.",
    ],
  },
});
