import { ServerIcon } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Row } from "~/components/ui/row";

import { definePlayground, jsxElement } from "../kitPlayground";

const SIZES = ["xs", "sm", "md", "lg", "lg-line"] as const;

export default definePlayground({
  section: "row",
  name: "Row",
  imports: 'import { Row } from "~/components/ui/row";',
  controls: {
    size: { kind: "enum", options: SIZES, note: "follows what the row leads with" },
    title: { kind: "text" },
    line: { kind: "text", note: "one muted line under the title" },
    meta: { kind: "text", note: "a time, a count, a state's word" },
    lead: { kind: "boolean", note: "an icon or a face" },
    badge: { kind: "boolean", note: "badges give way before the title" },
    strong: { kind: "boolean", note: "something on the row is unseen" },
    pressable: { kind: "boolean", note: "the whole row opens something" },
  },
  initial: {
    size: "md",
    title: "storefront",
    line: "Node.js 22 · deployed from main",
    meta: "2 min ago",
    lead: true,
    badge: true,
    strong: false,
    pressable: true,
  },
  render: ({ size, title, line, meta, lead, badge, strong, pressable }) => (
    <div className="w-96">
      <Row
        badges={badge ? <Badge tone="success">Running</Badge> : undefined}
        lead={
          lead ? (
            <ServerIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          ) : undefined
        }
        line={line === "" ? undefined : line}
        meta={meta === "" ? undefined : meta}
        pressable={pressable}
        size={size}
        strong={strong}
        title={title}
      />
    </div>
  ),
  jsx: ({ size, title, line, meta, lead, badge, strong, pressable }) =>
    jsxElement(
      "Row",
      {
        size,
        title,
        line: line === "" ? undefined : line,
        meta: meta === "" ? undefined : meta,
        strong,
        pressable,
        "lead={<ServerIcon />}": lead ? true : undefined,
        'badges={<Badge tone="success">Running</Badge>}': badge ? true : undefined,
      },
      undefined,
      { size: "md", strong: false, pressable: false },
    ),
  usage: {
    do: [
      "Use a Row for every list's row: one leading mark, the title, its badges, meta at the end.",
      "Use xs in a tree or a dense list.",
      "Say a state once in a row: its mark and its words together.",
    ],
    dont: [
      "Wrap each row in a card: rows, not cards.",
      "Put more than one muted line under the title.",
    ],
  },
});
