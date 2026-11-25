import { MATE_TINT_IDS } from "@t3tools/shared/brand";

import { MessageBubble } from "~/components/ui/message-bubble";
import { Text } from "~/components/ui/text";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

function MessageBubbleSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock
        note="Who said it shows at a glance: the person on the message ground, a Mate in its hue."
        title="Speakers"
      >
        <SpecimenGrid size="lg">
          <Specimen label='speaker="person"' note="The person's words, on their side">
            <div className="flex w-full justify-end">
              <MessageBubble className="max-w-4/5">
                Can you put the pricing page live once the tests pass?
              </MessageBubble>
            </div>
          </Specimen>
          <Specimen label='speaker="person" queued' note="Waiting for the running turn">
            <div className="flex w-full justify-end">
              <MessageBubble className="max-w-4/5" queued>
                And add the footer link too.
              </MessageBubble>
            </div>
          </Specimen>
          <Specimen label='speaker="mate" tint="violet"' note="A Mate's words in its run">
            <div className="w-full rounded-sheet bg-run-tray p-3.75">
              <MessageBubble speaker="mate" tint="violet">
                The tests pass. I'll put it live now.
              </MessageBubble>
            </div>
          </Specimen>
          <Specimen
            label='speaker="another-mate" tint="olive"'
            note="Another of the person's Mates, on the page"
          >
            <MessageBubble className="w-full" speaker="another-mate" tint="olive">
              <div className="flex flex-col gap-2">
                <Text variant="heading">Fen · Acme Docs</Text>
                <p className="m-0">Does the docs site have the new pricing page yet?</p>
              </div>
            </MessageBubble>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock note="Each Mate speaks in its own hue." title="Hues">
        <SpecimenGrid>
          {MATE_TINT_IDS.map((tint) => (
            <Specimen key={tint} label={`speaker="mate" tint="${tint}"`}>
              <MessageBubble speaker="mate" tint={tint}>
                Done.
              </MessageBubble>
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "message-bubble",
  title: "MessageBubble",
  purpose: "One message in a conversation, in the look of who said it.",
  group: "Kit",
  kind: "Containers",
  source: "apps/web/src/components/ui/message-bubble.tsx",
  render: () => <MessageBubbleSpecimens />,
});
