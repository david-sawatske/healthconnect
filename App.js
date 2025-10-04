import "react-native-gesture-handler";
import "react-native-reanimated";
import "react-native-get-random-values";
import "react-native-url-polyfill/auto";

import React, { useEffect } from "react";
import { View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Amplify } from "aws-amplify";
import amplifyConfig from "./src/amplifyconfiguration.json";

import AuthScreen from "./src/screens/AuthScreen";
import HomeScreen from "./src/screens/HomeScreen";
import ChatScreen from "./src/screens/ChatScreen";
import InviteScreen from "./src/screens/InviteScreen";
import InviteApprovalScreen from "./src/screens/InviteApprovalScreen";
import CallScreen from "./src/screens/CallScreen";

import { CallProvider, useCall } from "./src/context/CallContext";
import IncomingCallModal from "./src/components/IncomingCallModal";

Amplify.configure(amplifyConfig);

const Stack = createNativeStackNavigator();

function Root() {
  const { showIncoming } = useCall();

  // Temp Demo to test modal
  useEffect(() => {
    if (__DEV__) {
      const t = setTimeout(() => {
        showIncoming({
          callerName: "Dr. Smith",
          avatarUrl: null,
          conversationId: "test-conv",
          callSessionId: "test-session",
          senderId: "provider-123",
        });
      }, 2000);
      return () => clearTimeout(t);
    }
  }, [showIncoming]);

  return (
    <View style={{ flex: 1 }}>
      <NavigationContainer>
        <Stack.Navigator initialRouteName="Auth">
          <Stack.Screen name="Auth" component={AuthScreen} />
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Chat" component={ChatScreen} />
          <Stack.Screen name="Invite" component={InviteScreen} />
          <Stack.Screen name="InviteApproval" component={InviteApprovalScreen} />
          <Stack.Screen
            name="Call"
            component={CallScreen}
            options={{ headerShown: false }}
          />
        </Stack.Navigator>
        <StatusBar style="auto" />
      </NavigationContainer>

      {/* Global incoming-call modal */}
      <IncomingCallModal
        onAccept={(data) => {
          console.log("[CALL] Accept tapped", data);
        }}
        onDecline={(data) => {
          console.log("[CALL] Decline tapped", data);
        }}
      />
    </View>
  );
}

export default function App() {
  return (
    <CallProvider>
      <Root />
    </CallProvider>
  );
}
