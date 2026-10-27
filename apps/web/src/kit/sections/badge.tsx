import { CircleCheckIcon } from "lucide-react";

import { Badge, type BadgeTone } from "~/components/ui/badge";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, SpecimenMatrix } from "../Specimen";
import { variantsOf } from "../specimenLabel";

const TONES = variantsOf<BadgeTone>({
  neutral: true,
  info: true,
  success: true,
  warning: true,
  danger: true,
});

const WORDS: Readonly<Record<BadgeTone, string>> = {
  neutral: "Stopped",
  info: "Deploying",
  success: "Running",
  warning: "Needs you",
  danger: "Failed",
};

function BadgeSpecimens() {
  return (
    <div className="flex flex-col gap-8">
      <SpecimenBlock title="Tones × forms: a pill label, a dot before its words">
        <SpecimenMatrix
          rowProp="tone"
          rows={TONES}
          columnProp="form"
          columns={["pill", "dot", "dot in a sentence"] as const}
          render={(tone, form) =>
            form === "pill" ? (
              <Badge tone={tone}>{WORDS[tone]}</Badge>
            ) : form === "dot" ? (
              <Badge dot tone={tone}>
                {WORDS[tone]}
              </Badge>
            ) : (
              <span className="text-body text-muted-foreground">
                Stage is{" "}
                <Badge dot tone={tone}>
                  {WORDS[tone].toLowerCase()}
                </Badge>{" "}
                · main
              </span>
            )
          }
        />
      </SpecimenBlock>
      <SpecimenBlock title="A dot alone, an icon, a count, long words, a link">
        <SpecimenGrid>
          <Specimen label='dot aria-label="Running" (a row too narrow for words)'>
            <Badge aria-label="Running" dot tone="success" />
          </Specimen>
          <Specimen label='tone="success" + icon'>
            <Badge tone="success">
              <CircleCheckIcon />
              Running
            </Badge>
          </Specimen>
          <Specimen label="a count">
            <Badge>12</Badge>
          </Specimen>
          <Specimen label="in a 128px box">
            <div className="flex w-32">
              <Badge>storefront-preview-eu-central-2</Badge>
            </div>
          </Specimen>
          <Specimen label='render={<a href="#badge" />}'>
            <Badge render={<a href="#badge" />}>storefront</Badge>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </div>
  );
}

export default defineKitSection({
  id: "badge",
  title: "Badge",
  purpose:
    "The one label: a short word or count beside what it describes, a pill so it never reads as a press. Five tones carry meaning (neutral, info, success, warning, danger); the dot form is a status mark that always has its words or an accessible name.",
  group: "Chosen",
  kind: "Labels",
  source: "apps/web/src/components/ui/badge.tsx",
  render: () => <BadgeSpecimens />,
});
