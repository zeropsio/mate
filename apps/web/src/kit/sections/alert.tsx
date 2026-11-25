import type { ComponentProps } from "react";
import { CircleAlertIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { FailureDetails } from "~/components/ui/failure";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, SpecimenMatrix, Specimens } from "../Specimen";
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
const SURFACES = variantsOf<AlertSurface>({ default: true, glass: true, bare: true, tint: true });

function AlertSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock title="Variants and surfaces">
        <SpecimenMatrix
          rowProp="variant"
          rows={VARIANTS}
          columnProp="surface"
          columns={SURFACES}
          stretch
          render={(variant, surface) => (
            <div className="w-full">
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
        <SpecimenGrid size="lg">
          <Specimen
            label='layout="centered" variant="info"'
            note="Nothing there yet, and the way to start"
          >
            <div className="w-full max-w-80">
              <Alert layout="centered" variant="info">
                <InfoIcon />
                <AlertTitle>Nothing deployed yet</AlertTitle>
                <AlertDescription>Push to main and the first build starts.</AlertDescription>
                <AlertAction>
                  <Button size="sm">Push now</Button>
                </AlertAction>
              </Alert>
            </div>
          </Specimen>
          <Specimen
            label='controlAlignment="first-line" variant="error"'
            note="Long words, its action on the first line"
          >
            <div className="w-full max-w-96">
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
          <Specimen
            label='surface="tint" variant="warning" · <FailureDetails>'
            note="What HQ found, its details folded"
          >
            <div className="w-full max-w-96">
              <Alert controlAlignment="first-line" surface="tint" variant="warning">
                <TriangleAlertIcon />
                <AlertTitle>zerops.yaml names a build base that does not exist.</AlertTitle>
                <AlertDescription>
                  <p className="m-0">Next, for Nova: pick nodejs@22 and push again.</p>
                  <FailureDetails
                    fields={[
                      { label: "Where", value: "api · zerops.yaml" },
                      { label: "Rule", value: "/zerops/0/build/base" },
                    ]}
                  />
                </AlertDescription>
              </Alert>
            </div>
          </Specimen>
          <Specimen label='surface="tint" variant="error"' note="Its fix is the action">
            <div className="w-full max-w-96">
              <Alert controlAlignment="first-line" surface="tint" variant="error">
                <AlertTitle>It no longer merges cleanly</AlertTitle>
                <AlertAction>
                  <Button size="sm" variant="link">
                    Ask Nova to resolve it
                  </Button>
                </AlertAction>
              </Alert>
            </div>
          </Specimen>
          <Specimen label="<AlertDescription>" note="No icon, a description only">
            <div className="w-full max-w-80">
              <Alert>
                <AlertDescription>
                  The preview sleeps after an hour without visits.
                </AlertDescription>
              </Alert>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
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
