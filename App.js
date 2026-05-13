import "react-native-gesture-handler";
import "react-native-reanimated";
import "react-native-get-random-values";
import "react-native-url-polyfill/auto";

import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Amplify } from "aws-amplify";

import amplifyConfig from "./src/amplifyconfiguration.json";
import { CallProvider } from "./src/context/CallContext";
import { CurrentUserProvider } from "./src/context/CurrentUserContext";
import AppNavigator from "./src/navigation/AppNavigator";

Amplify.configure(amplifyConfig);

export default function App() {
  return (
    <SafeAreaProvider>
      <CallProvider>
        <CurrentUserProvider>
          <AppNavigator />
        </CurrentUserProvider>
      </CallProvider>
    </SafeAreaProvider>
  );
}
