import { ChevronRightIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";

import { definePlayground, jsxElement } from "../kitPlayground";

const LOG = ["Installing dependencies", "Building the storefront", "Done in 41s"];

export default definePlayground({
  section: "collapsible",
  name: "Collapsible",
  imports:
    'import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";',
  controls: {
    trigger: { kind: "text", note: "names what opens" },
    defaultOpen: { kind: "boolean", note: "open as it first draws; the person decides after" },
    disabled: { kind: "boolean", note: "nothing to open yet" },
  },
  initial: { trigger: "Build log", defaultOpen: false, disabled: false },
  render: ({ trigger, defaultOpen, disabled }) => (
    <div className="w-72">
      <Collapsible defaultOpen={defaultOpen} disabled={disabled} key={String(defaultOpen)}>
        <CollapsibleTrigger render={<Button size="sm" variant="ghost" />}>
          <ChevronRightIcon />
          {trigger}
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="flex flex-col gap-1 px-3 py-2 font-mono text-caption">
            {LOG.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  ),
  jsx: ({ trigger, defaultOpen, disabled }) =>
    jsxElement(
      "Collapsible",
      { defaultOpen, disabled },
      [
        `<CollapsibleTrigger render={<Button size="sm" variant="ghost" />}>\n  <ChevronRightIcon />\n  ${trigger}\n</CollapsibleTrigger>`,
        "<CollapsiblePanel>…</CollapsiblePanel>",
      ].join("\n"),
      { defaultOpen: false, disabled: false },
    ),
  usage: {
    do: [
      "Fold detail a person reads only sometimes under the line that names it: a build log, a commit list.",
      "Render its trigger as a ghost Button with a chevron leading.",
    ],
    dont: [
      "Hide what the person must act on inside it.",
      "Nest one in another more than one level deep: open a page instead.",
    ],
  },
});
