import { View } from "react-native";

import { AppText } from "../AppText";
import { chipPresentation } from "./presentation.ts";

export function Chip(props: Parameters<typeof chipPresentation>[0]) {
  const presentation = chipPresentation(props);
  return (
    <View className={presentation.containerClassName}>
      <AppText className={presentation.textClassName}>{presentation.label}</AppText>
    </View>
  );
}
