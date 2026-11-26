import { useState } from "react";

import { SlideConfirm } from "~/components/ui/slide-confirm";

import { definePlayground, jsxCode, jsxElement } from "../kitPlayground";

function Slide({
  label,
  confirmedLabel,
  locked,
}: {
  readonly label: string;
  readonly confirmedLabel: string;
  readonly locked: boolean;
}) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <SlideConfirm
      className="w-96"
      confirmed={confirmed && !locked}
      confirmedLabel={confirmedLabel}
      label={label}
      locked={locked}
      onConfirmedChange={setConfirmed}
    />
  );
}

export default definePlayground({
  section: "slide-confirm",
  name: "SlideConfirm",
  imports: 'import { SlideConfirm } from "~/components/ui/slide-confirm";',
  controls: {
    label: { kind: "text", note: "what sliding deletes; also the slider's name" },
    confirmedLabel: { kind: "text", note: "what the filled track says" },
    locked: { kind: "boolean", note: "held until something else is done first" },
  },
  initial: {
    label: "Slide to delete Stage shop-stage",
    confirmedLabel: "Stage shop-stage will be deleted",
    locked: false,
  },
  render: ({ label, confirmedLabel, locked }) => (
    <Slide confirmedLabel={confirmedLabel} label={label} locked={locked} />
  ),
  jsx: ({ label, confirmedLabel, locked }) =>
    jsxElement(
      "SlideConfirm",
      {
        label,
        confirmedLabel,
        confirmed: jsxCode("confirmed"),
        onConfirmedChange: jsxCode("setConfirmed"),
        locked,
      },
      undefined,
      { locked: false },
    ),
  usage: {
    do: [
      "Give each environment a deletion takes its own slide, above the name field.",
      "Keep the dialog's Delete shut until every slide is confirmed.",
      "Lock a Production's slide until its name is typed, and clear it when the name stops matching.",
    ],
    dont: [
      "Use it for a value along a range: that is a Slider.",
      "Use it for an action that can be undone later: a Button asks enough.",
    ],
  },
});
