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
import ProviderHomeScreen from "./src/screens/ProviderHomeScreen"
import PatientDetailScreen from "./src/screens/PatientDetailScreen"

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

const UpdateCallSession = /* GraphQL */ `
  mutation UpdateCallSession($input: UpdateCallSessionInput!) {
    updateCallSession(input: $input) {
      id
      status
      endedAt
      updatedAt
    }
  }
`;

function Root() {
  const call = useCall();

  async function onAccept(incoming) {
    call?.setConnecting?.();
    call?.hide?.();

    if (
      navRef.isReady() &&
      incoming?.callSessionId &&
      incoming?.conversationId
    ) {
      navRef.navigate("Call", {
        callSessionId: incoming.callSessionId,
        conversationId: incoming.conversationId,
        role: "callee",
        incomingOffer: incoming.offer,
      });
    } else {
      console.log("[ACCEPT] missing params", incoming);
    }
  }

  async function onDecline(incoming) {
    const u = await getCurrentUser().catch(() => null);
    const senderId = u?.userId;
    const { conversationId, callSessionId } = incoming || {};

    if (!conversationId || !callSessionId || !senderId) {
      console.log("[DECLINE] missing fields", { conversationId, callSessionId, senderId, incoming });
      call?.hide?.();
      return;
    }

    try {
      console.log("[DECLINE] emit BYE", { conversationId, callSessionId, senderId });
      const { data, errors } = await client.graphql({
        query: CreateCallSignal,
        variables: {
          input: {
            conversationId,
            callSessionId,
            senderId,
            type: "BYE",
            payload: JSON.stringify({ reason: "declined", at: Date.now() }),
          },
        },
        authMode: "userPool",
      });

      if (errors?.length) {
        console.log("[DECLINE] createCallSignal(BYE) errors", errors);
      } else {
        console.log("[DECLINE] createCallSignal(BYE) id", data?.createCallSignal?.id);
      }

      await client.graphql({
        query: /* GraphQL */ `
            mutation UpdateCallSession($input: UpdateCallSessionInput!) {
                updateCallSession(input: $input) { id status endedAt }
            }
        `,
        variables: {
          input: { id: callSessionId, status: "ENDED", endedAt: new Date().toISOString() },
        },
        authMode: "userPool",
      }).catch((e) => console.log("[DECLINE] UpdateCallSession ENDED error", e?.message || e));
    } catch (e) {
      console.log("[DECLINE] createCallSignal(BYE) threw", e?.message || e);
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
          <Stack.Screen
            name="ProviderHome"
            component={ProviderHomeScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="PatientDetail"
            component={PatientDetailScreen}
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
