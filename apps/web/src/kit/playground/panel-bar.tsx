import type { ComponentProps } from "react";

import { PanelBar } from "~/components/ui/panel-bar";
import { Text } from "~/components/ui/text";

import { definePlayground, jsxElement } from "../kitPlayground";
import { PanelStage } from "../sections/panel-bar";
import { variantsOf } from "../specimenLabel";

const SIZES = variantsOf<NonNullable<ComponentProps<typeof PanelBar>["size"]>>({
  md: true,
  lg: true,
});
const EDGES = variantsOf<NonNullable<ComponentProps<typeof PanelBar>["edge"]>>({
  bottom: true,
  top: true,
  none: true,
});

export default definePlayground({
  section: "panel-bar",
  name: "PanelBar",
  imports: 'import { PanelBar } from "~/components/ui/panel-bar";',
  controls: {
    size: { kind: "enum", options: SIZES, note: "lg: a row of tabs" },
    edge: { kind: "enum", options: EDGES, note: "top: a pane's foot" },
    inline: { kind: "boolean", note: "beside the conversation, under its page's head" },
    words: { kind: "text", note: "what the bar says: where the pane is" },
  },
  initial: { size: "md", edge: "bottom", inline: false, words: "src/routes/menu.tsx" },
  render: ({ size, edge, inline, words }) => (
    <PanelStage inline={inline}>
      <PanelBar edge={edge} size={size}>
        <Text className="min-w-0 flex-1" variant="code">
          {words}
        </Text>
      </PanelBar>
    </PanelStage>
  ),
  jsx: ({ size, edge, words }) =>
    jsxElement("PanelBar", { size, edge }, words, { size: "md", edge: "bottom" }),
  usage: {
    do: [
      "Head a panel or a pane with it: its search, where it is, its reload, its tabs.",
      "Use size lg for a row of tabs, edge top for a pane's foot.",
    ],
    dont: [
      "Draw a pane's bar by hand: a height, a rule and a gutter of its own.",
      "Put a page's title in it: a page's head is PageHeader.",
    ],
  },
});
