import { useState } from "react";
import type { DateRange } from "@daypicker/react";

import { Calendar } from "~/components/ui/calendar";

import { definePlayground, jsxCode, jsxElement } from "../kitPlayground";

// A fixed month, so the playground reads the same on every day.
const MONTH = new Date(2026, 9, 1);
// The first day a backup is kept: the days before it cannot be picked.
const KEPT_FROM = new Date(2026, 9, 5);

interface CalendarArgs {
  readonly captionLayout: "label" | "dropdown";
  readonly numberOfMonths: number;
  readonly showOutsideDays: boolean;
  readonly showWeekNumber: boolean;
  readonly keptOnly: boolean;
}

function SingleDay(props: CalendarArgs) {
  const [day, setDay] = useState<Date | undefined>(new Date(2026, 9, 15));
  return (
    <Calendar
      captionLayout={props.captionLayout}
      defaultMonth={MONTH}
      disabled={props.keptOnly ? { before: KEPT_FROM } : undefined}
      mode="single"
      numberOfMonths={props.numberOfMonths}
      onSelect={setDay}
      selected={day}
      showOutsideDays={props.showOutsideDays}
      showWeekNumber={props.showWeekNumber}
    />
  );
}

function DayRange(props: CalendarArgs) {
  const [range, setRange] = useState<DateRange | undefined>({
    from: new Date(2026, 9, 12),
    to: new Date(2026, 9, 16),
  });
  return (
    <Calendar
      captionLayout={props.captionLayout}
      defaultMonth={MONTH}
      disabled={props.keptOnly ? { before: KEPT_FROM } : undefined}
      mode="range"
      numberOfMonths={props.numberOfMonths}
      onSelect={setRange}
      selected={range}
      showOutsideDays={props.showOutsideDays}
      showWeekNumber={props.showWeekNumber}
    />
  );
}

export default definePlayground({
  section: "calendar",
  name: "Calendar",
  imports: 'import { Calendar } from "~/components/ui/calendar";',
  controls: {
    mode: { kind: "enum", options: ["single", "range"], note: "a day, or a span of days" },
    captionLayout: {
      kind: "enum",
      options: ["label", "dropdown"],
      note: "dropdown to jump months and years",
    },
    numberOfMonths: { kind: "enum", options: ["1", "2"], note: "two for a range across months" },
    showOutsideDays: { kind: "boolean", note: "the neighbouring months' days, greyed" },
    showWeekNumber: { kind: "boolean" },
    keptOnly: { kind: "boolean", note: "disabled: the days before the first kept backup" },
  },
  initial: {
    mode: "single",
    captionLayout: "label",
    numberOfMonths: "1",
    showOutsideDays: true,
    showWeekNumber: false,
    keptOnly: false,
  },
  render: ({ mode, numberOfMonths, ...rest }) => {
    const args = { ...rest, numberOfMonths: Number(numberOfMonths) };
    return mode === "range" ? <DayRange {...args} /> : <SingleDay {...args} />;
  },
  jsx: ({ mode, captionLayout, numberOfMonths, showOutsideDays, showWeekNumber, keptOnly }) =>
    jsxElement(
      "Calendar",
      {
        mode,
        selected: jsxCode(mode === "range" ? "range" : "day"),
        onSelect: jsxCode(mode === "range" ? "setRange" : "setDay"),
        defaultMonth: jsxCode("month"),
        captionLayout,
        numberOfMonths: Number(numberOfMonths),
        showOutsideDays,
        showWeekNumber,
        disabled: keptOnly ? jsxCode("{ before: keptFrom }") : undefined,
      },
      undefined,
      {
        mode: "single",
        captionLayout: "label",
        numberOfMonths: 1,
        showOutsideDays: true,
        showWeekNumber: false,
      },
    ),
  usage: {
    do: [
      "Use it where the day itself is the answer: a backup to restore, a span of usage.",
      "Disable the days that cannot be picked, rather than refusing them after.",
      "Open it from a field in a Popover when the form has other fields.",
    ],
    dont: [
      "Ask for a time with it; it picks days.",
      "Use it for a relative choice (the last 7 days): that is a Select or a ToggleGroup.",
    ],
  },
});
