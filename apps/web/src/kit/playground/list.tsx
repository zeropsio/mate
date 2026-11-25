import { Card } from "~/components/ui/card";
import { List } from "~/components/ui/list";
import { StepNumber } from "~/components/ui/step-number";
import { Text } from "~/components/ui/text";

import { definePlayground, jsxCode, jsxElement } from "../kitPlayground";

const STOPS = [
  { title: "Your three changes", line: "Merged into main" },
  { title: "Stage", line: "Builds and deploys first" },
  { title: "Production", line: "Once Stage is running" },
] as const;

export default definePlayground({
  section: "list",
  name: "List",
  imports: 'import { List } from "~/components/ui/list";',
  controls: {
    rule: {
      kind: "enum",
      options: ["full", "inset"],
      note: "inset: each rule starts at the items' words",
    },
    edges: { kind: "boolean", note: "rules above the first and under the last" },
    card: { kind: "boolean", note: "the list inside a flat card" },
  },
  initial: { rule: "full", edges: false, card: true },
  render: ({ rule, edges, card }) => {
    const list = (
      <List edges={edges} render={<ol />} rule={rule}>
        {STOPS.map((stop, index) => (
          <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-4 px-4 py-3" key={stop.title}>
            <StepNumber n={index + 1} />
            <span className="grid gap-0.5">
              <Text variant="heading">{stop.title}</Text>
              <Text variant="description">{stop.line}</Text>
            </span>
          </li>
        ))}
      </List>
    );
    return <div className="w-96">{card ? <Card variant="flat">{list}</Card> : list}</div>;
  },
  jsx: ({ rule, edges }) =>
    jsxElement("List", { rule, edges, render: jsxCode("<ol />") }, "<li>…</li>\n<li>…</li>", {
      rule: "full",
      edges: false,
    }),
  usage: {
    do: [
      "Part like things in one column with a List: it draws the rules, the items none.",
      "Give it its layout by className: a flex column, a grid, its padding.",
    ],
    dont: [
      "Draw divide-y or a border-t with first:border-t-0 on the items by hand.",
      "Rule rows that light their own ground: they part by spacing.",
    ],
  },
});
