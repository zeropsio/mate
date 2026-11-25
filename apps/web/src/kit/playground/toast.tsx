import { Button } from "~/components/ui/button";
import { toastManager } from "~/lib/toasts";

import { definePlayground } from "../kitPlayground";

const TYPES = ["success", "error", "info", "warning", "loading"] as const;

const SLOW_REQUESTS = (
  <ul className="m-0 ps-4 text-caption">
    <li>project.list</li>
    <li>service.logs</li>
    <li>deploy.status</li>
  </ul>
);

export default definePlayground({
  section: "toast",
  name: "Toast",
  imports: 'import { toastManager } from "~/lib/toasts";',
  controls: {
    type: { kind: "enum", options: TYPES, note: "its glyph; loading spins until updated" },
    title: { kind: "text", note: "what just happened" },
    description: { kind: "text", note: "one more line; empty for none" },
    action: { kind: "boolean", note: "Undo, for what can be taken back" },
    details: { kind: "boolean", note: "a folded list under Show details" },
  },
  initial: {
    type: "success",
    title: "storefront deployed",
    description: "The build from 18:02 is live.",
    action: false,
    details: false,
  },
  render: ({ type, title, description, action, details }) => (
    <Button
      onClick={() =>
        toastManager.add({
          type,
          title,
          ...(description === "" ? {} : { description }),
          ...(action ? { actionProps: { children: "Undo" } } : {}),
          ...(details ? { data: { expandableContent: SLOW_REQUESTS } } : {}),
        })
      }
      variant="secondary"
    >
      Show the toast
    </Button>
  ),
  jsx: ({ type, title, description, action, details }) =>
    [
      "toastManager.add({",
      `  type: "${type}",`,
      `  title: "${title}",`,
      ...(description === "" ? [] : [`  description: "${description}",`]),
      ...(action ? ['  actionProps: { children: "Undo" },'] : []),
      ...(details ? ["  data: { expandableContent: <ul>…</ul> },"] : []),
      "});",
    ].join("\n"),
  usage: {
    do: [
      "Say in passing that something just happened, where the person may not be looking.",
      "Offer Undo for what can be taken back, instead of asking first.",
      "Press Show the toast: it comes in at the top right and leaves by itself.",
    ],
    dont: [
      "Put something the person must act on in it: it leaves. That is an Alert where it applies.",
      "Toast the answer to a press beside the press: the place itself changes.",
      "Stack a toast per item of a batch: one toast says the batch.",
    ],
  },
});
