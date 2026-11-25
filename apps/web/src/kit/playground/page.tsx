import type { ComponentProps } from "react";

import { Page } from "~/components/ui/page";

import { definePlayground, jsxElement } from "../kitPlayground";
import { PageSample, PageStage } from "../sections/page";
import { variantsOf } from "../specimenLabel";

const WIDTHS = variantsOf<NonNullable<ComponentProps<typeof Page>["width"]>>({
  column: true,
  page: true,
  wide: true,
  full: true,
});
const INSETS = variantsOf<NonNullable<ComponentProps<typeof Page>["inset"]>>({
  page: true,
  rows: true,
});

export default definePlayground({
  section: "page",
  name: "Page",
  imports: 'import { Page } from "~/components/ui/page";',
  controls: {
    width: { kind: "enum", options: WIDTHS, note: "how wide its column reads" },
    inset: { kind: "enum", options: INSETS, note: "rows: its rows carry their own inset" },
    belowBar: { kind: "boolean", note: "right under a phone's bar: it starts 8 px under it" },
  },
  initial: { width: "page", inset: "page", belowBar: false },
  render: ({ width, inset, belowBar }) => (
    <PageStage zoom={0.6}>
      <Page belowBar={belowBar} inset={inset} width={width}>
        <PageSample title="Team" />
      </Page>
    </PageStage>
  ),
  jsx: ({ width, inset, belowBar }) =>
    jsxElement("Page", { width, inset, belowBar }, "<PageHeader … />\n<Section …>…</Section>", {
      width: "page",
      inset: "page",
      belowBar: false,
    }),
  usage: {
    do: [
      "Stand every page in it, once, inside the page's scroll.",
      "Pick the width its content reads at: column for a read, page for sections, wide for tables and grids, full for cards that run to the edge.",
      "Put its header first, then its sections: the frame spaces them.",
    ],
    dont: [
      "Set a page's own max width, side padding or top: the frame's are the product's.",
      "Space a page's sections by hand: a block that is not a section groups its lines in one child.",
      "Nest one in another: a page is one frame.",
    ],
  },
});
