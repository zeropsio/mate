import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { MateFace, PersonAvatar } from "~/components/zerops/primitives";
import { FaceCard, FaceCardLine, FaceCards } from "~/components/zerops/system/FaceCard";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

export default defineKitSection({
  id: "face-card",
  title: "FaceCard",
  purpose:
    "A card that leads with a face: a person on Settings › Team, a Mate on its project's page, one family. Its body is one press; its foot holds presses of its own.",
  group: "Chosen",
  kind: "Containers",
  source: "apps/web/src/components/zerops/system/FaceCard.tsx",
  render: () => (
    <Specimens>
      <SpecimenBlock
        note="A person on Settings › Team, a Mate on its project's page."
        title="People and Mates"
      >
        <SpecimenGrid size="lg">
          <Specimen
            label="<FaceCards> · <FaceCard faded foot>"
            note="A member, and an invitation not taken yet"
          >
            <div className="w-full max-w-[30rem]">
              <FaceCards label="People">
                <li className="grid">
                  <FaceCard
                    chips={<Badge>Owner</Badge>}
                    figure={<PersonAvatar name="Petra Malá" size={64} />}
                    title="Petra Malá"
                  >
                    <FaceCardLine>petra@example.com</FaceCardLine>
                  </FaceCard>
                </li>
                <li className="grid">
                  <FaceCard
                    faded
                    figure={<PersonAvatar name="Jan Svoboda" size={64} />}
                    foot={
                      <Button size="xs" variant="ghost">
                        Send again
                      </Button>
                    }
                    title="Jan Svoboda"
                  >
                    <FaceCardLine tone="attention">Invited · not joined yet</FaceCardLine>
                  </FaceCard>
                </li>
              </FaceCards>
            </div>
          </Specimen>
          <Specimen label="<FaceCardLine lines={2}>" note="A Mate, its words on two lines">
            <div className="w-full max-w-[15rem]">
              <FaceCards label="Mates">
                <li className="grid">
                  <FaceCard
                    figure={<MateFace size={64} state="working" tint="olive" />}
                    title="Fen"
                  >
                    <FaceCardLine lines={2}>Reading the release notes since 1.0.</FaceCardLine>
                  </FaceCard>
                </li>
              </FaceCards>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
