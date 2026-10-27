import { View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";

import type { RemoteClientConnectionState } from "../../lib/connection";
import { useDutyCycle } from "../../lib/useDutyCycle";

export type ConnectionStatusDotState = RemoteClientConnectionState;

function statusDotTone(state: ConnectionStatusDotState): {
  readonly dotColor: string;
  readonly haloColor: string;
} {
  switch (state) {
    case "available":
      return {
        dotColor: "#9ca3af",
        haloColor: "rgba(156,163,175,0.42)",
      };
    case "connected":
      return {
        dotColor: "#34d399",
        haloColor: "rgba(52,211,153,0.48)",
      };
    case "connecting":
    case "reconnecting":
      return {
        dotColor: "#f59e0b",
        haloColor: "rgba(245,158,11,0.5)",
      };
    case "offline":
    case "error":
      return {
        dotColor: "#ef4444",
        haloColor: "rgba(239,68,68,0.48)",
      };
  }
}

function usePulseAnimation(pulse: boolean) {
  return useDutyCycle(pulse, {
    duration: 1_200,
    frameCount: 3,
    reducedMotionValue: 0,
  }).progress;
}

export function ConnectionStatusDot(props: {
  readonly state: ConnectionStatusDotState;
  readonly pulse: boolean;
  readonly size?: number;
}) {
  const pulseProgress = usePulseAnimation(props.pulse);
  const tone = statusDotTone(props.state);
  const dotSize = props.size ?? 10;
  const haloSize = dotSize + 4;
  const containerSize = haloSize + 4;

  const haloStyle = useAnimatedStyle(() => ({
    opacity: props.pulse ? 0.14 + (1 - pulseProgress.value) * 0.3 : 0,
    transform: [{ scale: 0.78 + pulseProgress.value * 1.16 }],
  }));

  return (
    <View
      style={{
        width: containerSize,
        height: containerSize,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Animated.View
        style={[
          haloStyle,
          {
            position: "absolute",
            width: haloSize,
            height: haloSize,
            borderRadius: haloSize / 2,
            backgroundColor: tone.haloColor,
          },
        ]}
      />
      <View
        style={{
          width: dotSize,
          height: dotSize,
          borderRadius: dotSize / 2,
          backgroundColor: tone.dotColor,
        }}
      />
    </View>
  );
}
