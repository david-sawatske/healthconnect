import "react-native-gesture-handler";
import "react-native-reanimated";
import "react-native-get-random-values";
import "react-native-url-polyfill/auto";

import React from "react";
import { View } from "react-native";
import { StatusBar } from "expo-status-bar";
import {
  NavigationContainer,
  createNavigationContainerRef,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/api";
import { getCurrentUser } from "aws-amplify/auth";
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
const navRef = createNavigationContainerRef();
const client = generateClient();

const CreateCallSignal = /* GraphQL */ `
  mutation CreateCallSignal($input: CreateCallSignalInput!) {
    createCallSignal(input: $input) {
      id
    }
  }
`;

function Root() {
  const call = useCall();

  async function onAccept(incoming) {
    try {
      const u = await getCurrentUser().catch(() => null);
      const senderId = u?.userId;

      const conversationId = incoming?.conversationId ?? null;
      const callSessionId = incoming?.callSessionId ?? null;

      if (!conversationId || !callSessionId || !senderId) {
        console.log("[ACCEPT] missing fields", {
          conversationId,
          callSessionId,
          senderId,
          incoming,
        });
        return;
      }

      const { data, errors } = await client.graphql({
        query: CreateCallSignal,
        variables: {
          input: {
            conversationId,
            callSessionId,
            senderId,
            type: "ANSWER",
            payload: JSON.stringify({ answeredAt: Date.now() }),
          },
        },
        authMode: "userPool",
      });
      if (errors?.length) {
        console.log("[signal ANSWER error]", { data, errors });
        return;
      }
    } catch (e) {
      console.log("[signal ANSWER error]", e);
      return;
    }

    call?.setConnecting?.();
    call?.hide?.();
    if (navRef.isReady()) {
      navRef.navigate("Call", {
        callSessionId: incoming.callSessionId,
        conversationId: incoming.conversationId,
        role: "callee",
        incomingOffer: incoming.offer,
      });
    }
  }

  async function onDecline(incoming) {
    try {
      const u = await getCurrentUser().catch(() => null);
      const senderId = u?.userId;

      const conversationId = incoming?.conversationId ?? null;
      const callSessionId = incoming?.callSessionId ?? null;

      if (!conversationId || !callSessionId || !senderId) {
        console.log("[DECLINE] missing fields", {
          conversationId,
          callSessionId,
          senderId,
          incoming,
        });
        call?.hide?.();
        return;
      }

      const { data, errors } = await client.graphql({
        query: CreateCallSignal,
        variables: {
          input: {
            conversationId,
            callSessionId,
            senderId,
            type: "DECLINED",
            payload: JSON.stringify({ declinedAt: Date.now() }),
          },
        },
        authMode: "userPool",
      });
      if (errors?.length)
        console.log("[signal DECLINED error]", { data, errors });
    } catch (e) {
      console.log("[signal DECLINED error]", e);
    } finally {
      call?.hide?.();
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <NavigationContainer ref={navRef}>
        <Stack.Navigator initialRouteName="Auth">
          <Stack.Screen name="Auth" component={AuthScreen} />
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Chat" component={ChatScreen} />
          <Stack.Screen name="Invite" component={InviteScreen} />
          <Stack.Screen
            name="InviteApproval"
            component={InviteApprovalScreen}
          />
          <Stack.Screen
            name="Call"
            component={CallScreen}
            options={{ headerShown: false }}
          />
        </Stack.Navigator>
        <StatusBar style="auto" />
      </NavigationContainer>

      <IncomingCallModal onAccept={onAccept} onDecline={onDecline} />
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
