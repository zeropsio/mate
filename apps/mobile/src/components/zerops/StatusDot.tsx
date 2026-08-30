import { View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";

import { useDutyCycle } from "../../lib/useDutyCycle";
import { MicroLabel } from "./MicroLabel";
import { statusDotPresentation } from "./presentation.ts";

export function StatusDot(props: Parameters<typeof statusDotPresentation>[0]) {
  const presentation = statusDotPresentation(props);
  const { progress } = useDutyCycle(presentation.motion.active, presentation.motion);
  const dotStyle = useAnimatedStyle(
    () => ({
      opacity: presentation.motion.active
        ? presentation.motion.minimumOpacity + progress.value * presentation.motion.opacityRange
        : 1,
    }),
    [presentation.motion.active],
  );

  return (
    <View className={presentation.containerClassName}>
      <Animated.View className={presentation.dotClassName} style={dotStyle} />
      <MicroLabel label={presentation.label} tone={presentation.labelTone} />
    </View>
  );
}
