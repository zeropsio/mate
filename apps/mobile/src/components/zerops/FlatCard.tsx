import type { ReactNode } from "react";
import { View } from "react-native";

import { flatCardPresentation } from "./presentation.ts";

export function FlatCard(
  props: Parameters<typeof flatCardPresentation>[0] & { readonly children: ReactNode },
) {
  const presentation = flatCardPresentation(props);
  return <View className={presentation.containerClassName}>{props.children}</View>;
}
