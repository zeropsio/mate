import { QRCodeSvg } from "~/components/ui/qr-code";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenGrid } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

const VALUE = "https://mate.zerops.io/kit";

export default defineKitSection({
  id: "qr-code",
  title: "QRCodeSvg",
  purpose: "An address as a code a phone camera reads.",
  group: "Kit",
  kind: "Data",
  source: "apps/web/src/components/ui/qr-code.tsx",
  render: () => (
    <SpecimenGrid>
      {(["L", "M", "Q", "H"] as const).map((level) => (
        <Specimen key={level} label={specimenLabel({ level, size: 128 })}>
          <QRCodeSvg level={level} size={128} title={`QR code, level ${level}`} value={VALUE} />
        </Specimen>
      ))}
    </SpecimenGrid>
  ),
});
