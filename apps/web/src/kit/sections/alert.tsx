import type { ComponentProps } from "react";
import { CircleAlertIcon, InfoIcon } from "lucide-react";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, SpecimenMatrix } from "../Specimen";
import { variantsOf } from "../specimenLabel";

type AlertVariant = NonNullable<ComponentProps<typeof Alert>["variant"]>;
type AlertSurface = NonNullable<ComponentProps<typeof Alert>["surface"]>;

const VARIANTS = variantsOf<AlertVariant>({
  default: true,
  error: true,
  info: true,
  success: true,
  warning: true,
});
const SURFACES = variantsOf<AlertSurface>({ default: true, glass: true });

function AlertSpecimens() {
  return (
    <div className="flex flex-col gap-8">
      <SpecimenBlock title="Variants × surfaces">
        <SpecimenMatrix
          rowProp="variant"
          rows={VARIANTS}
          columnProp="surface"
          columns={SURFACES}
          render={(variant, surface) => (
            <div className="w-96">
              <Alert surface={surface} variant={variant}>
                <InfoIcon />
                <AlertTitle>The deploy finished</AlertTitle>
                <AlertDescription>storefront runs the build from 18:02.</AlertDescription>
                <AlertAction>
                  <Button size="sm" variant="secondary">
                    Open
                  </Button>
                </AlertAction>
              </Alert>
            </div>
          )}
        />
      </SpecimenBlock>
      <SpecimenBlock title="Layouts and content">
        <SpecimenGrid>
          <Specimen label='layout="centered"'>
            <div className="w-80">
              <Alert layout="centered" variant="info">
                <InfoIcon />
                <AlertTitle>Nothing deployed yet</AlertTitle>
                <AlertDescription>Push to main and the first build starts.</AlertDescription>
                <AlertAction>
                  <Button size="md">Push now</Button>
                </AlertAction>
              </Alert>
            </div>
          </Specimen>
          <Specimen label='controlAlignment="first-line", long text'>
            <div className="w-96">
              <Alert controlAlignment="first-line" variant="error">
                <CircleAlertIcon />
                <AlertTitle>The build failed</AlertTitle>
                <AlertDescription>
                  npm could not resolve a peer dependency of the storefront: @medusajs/ui wants
                  React 18 and the project pins React 19. Pin one of them, then deploy again.
                </AlertDescription>
                <AlertAction>
                  <Button size="sm" variant="secondary">
                    Show log
                  </Button>
                </AlertAction>
              </Alert>
            </div>
          </Specimen>
          <Specimen label="no icon, description only">
            <div className="w-80">
              <Alert>
                <AlertDescription>
                  The preview sleeps after an hour without visits.
                </AlertDescription>
              </Alert>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </div>
  );
}

export default defineKitSection({
  id: "alert",
  title: "Alert",
  purpose: "A standing notice in the flow: what happened and what can fix it.",
  group: "Kit",
  kind: "Feedback",
  source: "apps/web/src/components/ui/alert.tsx",
  render: () => <AlertSpecimens />,
});
