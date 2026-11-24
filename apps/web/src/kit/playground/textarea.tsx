import { Textarea } from "~/components/ui/textarea";

import { definePlayground, jsxElement } from "../kitPlayground";

export default definePlayground({
  section: "textarea",
  name: "Textarea",
  imports: 'import { Textarea } from "~/components/ui/textarea";',
  controls: {
    size: { kind: "enum", options: ["sm", "default", "lg"] },
    placeholder: { kind: "text" },
    disabled: { kind: "boolean" },
  },
  initial: { size: "default", placeholder: "What should the Mate do?", disabled: false },
  render: ({ size, placeholder, disabled }) => (
    <div className="w-96">
      <Textarea aria-label="Task" disabled={disabled} placeholder={placeholder} size={size} />
    </div>
  ),
  jsx: ({ size, placeholder, disabled }) =>
    jsxElement("Textarea", { size, placeholder, disabled }, undefined, {
      size: "default",
      disabled: false,
    }),
  usage: {
    do: ["Use it for text that runs past one line: a description, a task."],
    dont: ["Use it for a one-line value; that is an Input."],
  },
});
