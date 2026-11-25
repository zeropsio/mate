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
      options: ["default", "flat", "inset", "sheet", "slot", "wash"],
      note: "flat is the app's; sheet a card standing alone among its kind; slot a place not filled yet; wash a card that stands out in its tone",
    },
    size: {
      kind: "enum",
      options: ["none", "sm", "md", "rows"],
      note: "its padding; rows: around rows that light their own ground",
    },
    tone: {
      kind: "enum",
      options: ["default", "ok", "busy", "attention", "failed"],
      note: "the state of what it holds, on its hairline (and a wash card's ground)",
    },
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
      "Give the one next step on a surface a wash card; tone a card by what it holds.",
    ],
    dont: ["Stack a list of cards where rows would do.", "Add a second border inside a card."],
  },
});
