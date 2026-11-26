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
    locked: { kind: "boolean", note: "held while a deletion start is pending" },
  },
  initial: {
    label: "Slide to delete Production shop-live",
    confirmedLabel: "Production shop-live goes",
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
      "Give each part whose own data is deleted its own slide beneath its row.",
      "Keep Delete shut until every required slide is confirmed.",
      "Lock the slide while the deletion start is pending and clear it if the part is set to stay.",
    ],
    dont: [
      "Use it for a value along a range: that is a Slider.",
      "Use it for an action that can be undone later: a Button asks enough.",
    ],
  },
});
