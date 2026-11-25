import { Text, type TextVariant } from "~/components/ui/text";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";
import { specimenLabel, variantsOf } from "../specimenLabel";

const VARIANTS = variantsOf<TextVariant>({
  headline: true,
  heading: true,
  label: true,
  description: true,
  remark: true,
  note: true,
  meta: true,
  error: true,
  code: true,
});

/** Words each kind of text says in the product. */
const SAID: Record<TextVariant, string> = {
  headline: "Approve the release to Production",
  heading: "Storage limit",
  label: "Branches",
  description: "Mate keeps a copy of each change until it is released.",
  remark: "Opening the page…",
  note: "Use a key made only for Mate, with a spending limit.",
  meta: "2 min ago · 14 files",
  error: "That address is already taken.",
  code: "app/src/routes.ts",
};

function TextSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock
        note="Each names what the words are; its step, ink and weight follow."
        title="Variants"
      >
        <SpecimenGrid size="md">
          {VARIANTS.map((variant) => (
            <Specimen key={variant} label={specimenLabel({ variant })}>
              <div className="w-full">
                {variant === "code" ? (
                  <Text variant="description">
                    Changed <Text variant="code">{SAID.code}</Text>
                  </Text>
                ) : (
                  <Text render={<p />} variant={variant}>
                    {SAID[variant]}
                  </Text>
                )}
              </div>
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock title="Together">
        <SpecimenGrid size="md">
          <Specimen label="heading · description · note" note="A block of settings">
            <div className="flex w-full flex-col gap-1">
              <Text render={<h3 />} variant="heading">
                Automated Mates
              </Text>
              <Text render={<p />} variant="description">
                Mates that start on their own when a task arrives.
              </Text>
              <Text className="mt-1" render={<p />} variant="note">
                HQ keeps the key sealed and never shows it again.
              </Text>
            </div>
          </Specimen>
          <Specimen label="heading · meta · error" note="A name with its fact and what is wrong">
            <div className="flex w-full flex-col gap-0.5">
              <div className="flex items-baseline justify-between gap-3">
                <Text truncate variant="heading">
                  api.tea-shop.example
                </Text>
                <Text className="shrink-0" variant="meta">
                  3 h ago
                </Text>
              </div>
              <Text render={<p />} variant="error">
                The DNS record does not point here yet.
              </Text>
            </div>
          </Specimen>
          <Specimen label='variant="code" chip' note="A literal set apart in a sentence">
            <div className="w-full">
              <Text render={<p />} variant="description">
                Run{" "}
                <Text chip variant="code">
                  gh auth login
                </Text>{" "}
                on the server, then try again.
              </Text>
            </div>
          </Specimen>
          <Specimen label='variant="code" chip' note="An id beside a name">
            <div className="flex w-full items-baseline gap-2">
              <Text variant="heading">Claude</Text>
              <Text variant="meta">
                <Text chip variant="code">
                  claude-work
                </Text>
              </Text>
            </div>
          </Specimen>
          <Specimen label='variant="note" truncate' note="Too long for its place">
            <div className="w-full">
              <Text render={<p />} truncate variant="note">
                A note too long for its place is cut to one line with an ellipsis.
              </Text>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "text",
  title: "Text",
  purpose:
    "Words named by what they are: a headline, a heading, a label, a description, a remark, a note, a meta fact, an error, a literal.",
  group: "Kit",
  kind: "Labels",
  source: "apps/web/src/components/ui/text.tsx",
  render: () => <TextSpecimens />,
});
