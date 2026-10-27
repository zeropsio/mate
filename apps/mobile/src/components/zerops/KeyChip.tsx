import { View } from "react-native";

import { AppText } from "../AppText";
import { keyChipPresentation } from "./presentation.ts";

export function KeyChip(props: Parameters<typeof keyChipPresentation>[0]) {
  const presentation = keyChipPresentation(props);
  return (
    <View className={presentation.containerClassName}>
      <AppText className={presentation.textClassName}>{presentation.label}</AppText>
    </View>
  );
}
