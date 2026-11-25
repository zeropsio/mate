import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";

import { definePlayground, jsxElement } from "../kitPlayground";

export default definePlayground({
  section: "card",
  name: "Card",
  imports: 'import { Card } from "~/components/ui/card";',
  controls: {
    variant: {
      kind: "enum",
      options: ["default", "flat", "inset", "sheet", "slot"],
      note: "flat is the app's; sheet a card standing alone among its kind; slot a place not filled yet",
    },
    size: { kind: "enum", options: ["none", "sm", "md"], note: "its padding" },
    tone: { kind: "enum", options: ["default", "failed"], note: "failed: a thing that broke" },
    action: { kind: "boolean", note: "a press at its end" },
  },
  initial: { variant: "flat", size: "md", tone: "default", action: true },
  render: ({ variant, size, tone, action }) => (
    <div className="w-80">
      <Card size={size} tone={tone} variant={variant}>
        <span className="font-semibold text-emphasis">Production</span>
        <span className="text-body text-muted-foreground">3 services, all running.</span>
        {action ? (
          <span>
            <Button size="sm" variant="secondary">
              Open
            </Button>
          </span>
        ) : null}
      </Card>
    </div>
  ),
  jsx: ({ variant, size, tone, action }) =>
    jsxElement(
      "Card",
      { variant, size, tone },
      [
        "<span>Production</span>",
        "<span>3 services, all running.</span>",
        action ? '<Button size="sm" variant="secondary">Open</Button>' : "",
      ]
        .filter((part) => part !== "")
        .join("\n"),
      { variant: "default", size: "none", tone: "default" },
    ),
  usage: {
    do: [
      "Use flat on a page: a hairline and the card ground, no shadow.",
      "Set a card inside another apart with inset: depth shows as tint.",
    ],
    dont: ["Stack a list of cards where rows would do.", "Add a second border inside a card."],
  },
});
