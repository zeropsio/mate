import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Row } from "~/components/ui/row";
import { Section } from "~/components/ui/section";
import { PersonAvatar } from "~/components/zerops/primitives";

import { definePlayground, jsxCode, jsxElement } from "../kitPlayground";

/** Its heading's level: 2 on a page, 3 inside a sheet or a panel. */
const LEVELS = ["2", "3"] as const;
const PEOPLE = [
  { name: "Petra Malá", role: "Owner" },
  { name: "Jan Svoboda", role: "Developer" },
  { name: "Chen Wei", role: "Guest" },
] as const;

export default definePlayground({
  section: "section",
  name: "Section",
  imports: 'import { Section } from "~/components/ui/section";',
  controls: {
    title: { kind: "text", note: "names the rows under it" },
    count: { kind: "text", note: "how many, beside the title" },
    action: { kind: "text", note: "its one action at the line's end; empty: none" },
    line: { kind: "text", note: "what the section is for, under its title; empty: none" },
    level: { kind: "enum", options: LEVELS, note: "3 inside a sheet or a panel" },
  },
  initial: { title: "People", count: "3", action: "Add access", line: "", level: "2" },
  render: ({ title, count, action, line, level }) => (
    <div className="w-[28rem]">
      <Section
        action={
          action === "" ? undefined : (
            <Button size="sm" variant="ghost">
              {action}
            </Button>
          )
        }
        count={count === "" ? undefined : count}
        level={level === "3" ? 3 : 2}
        line={line === "" ? undefined : line}
        title={title}
      >
        <Card variant="flat">
          {PEOPLE.map((person) => (
            <Row
              key={person.name}
              lead={<PersonAvatar name={person.name} size={32} />}
              line={person.role}
              title={person.name}
            />
          ))}
        </Card>
      </Section>
    </div>
  ),
  jsx: ({ title, count, action, line, level }) =>
    jsxElement(
      "Section",
      {
        title,
        count: count === "" ? undefined : count,
        action:
          action === ""
            ? undefined
            : jsxCode(`<Button size="sm" variant="ghost">${action}</Button>`),
        line: line === "" ? undefined : line,
        level: level === "3" ? 3 : undefined,
      },
      '<Card variant="flat">\n  <Row … />\n</Card>',
    ),
  usage: {
    do: [
      "Head a group of rows with it: the heading hugs its rows, groups stand twice as far apart.",
      "Give it one action at most, a ghost Button at the line's end.",
      "Say what the section is for in its line when its title alone does not.",
      "Use level 3 inside a sheet or a panel whose page already has its h2.",
    ],
    dont: [
      "Head a whole page with it: that is the PageHeader.",
      "Put a Card around the heading: the card holds only the rows.",
    ],
  },
});
