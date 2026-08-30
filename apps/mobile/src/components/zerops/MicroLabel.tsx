import { AppText } from "../AppText";
import { microLabelPresentation } from "./presentation.ts";

export function MicroLabel(props: Parameters<typeof microLabelPresentation>[0]) {
  const presentation = microLabelPresentation(props);
  return <AppText className={presentation.textClassName}>{presentation.label}</AppText>;
}
