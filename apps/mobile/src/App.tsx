import { useEffect } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";

import { ZeropsDataProvider } from "./features/zerops/ZeropsDataProvider";

/** Native clients are retained source, not a released Mate surface. Keep their
 * former local/pairing runtime dormant until they implement the account lifecycle. */
export default function App() {
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);
  return (
    <ZeropsDataProvider account={null}>
      <View style={{ flex: 1, justifyContent: "center", padding: 32 }}>
        <Text>Zerops Mate is available in your browser.</Text>
        <Pressable
          onPress={() => {
            void Linking.openURL("https://mate.zerops.io");
          }}
        >
          <Text>Open Zerops Mate</Text>
        </Pressable>
      </View>
    </ZeropsDataProvider>
  );
}
