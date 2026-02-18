import "react-native-gesture-handler";
import "react-native-reanimated";
import "react-native-get-random-values";
import "react-native-url-polyfill/auto";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button, Alert } from "react-native";
import { StatusBar } from "expo-status-bar";
import {
  NavigationContainer,
  createNavigationContainerRef,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Amplify } from "aws-amplify";
import { getGraphqlClient } from "./src/services/amplify/client";
import { getCurrentUser, signOut } from "aws-amplify/auth";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import amplifyConfig from "./src/amplifyconfiguration.json";

import AuthScreen from "./src/screens/AuthScreen";
import HomeScreen from "./src/screens/HomeScreen";
import ChatScreen from "./src/screens/ChatScreen";
import InviteScreen from "./src/screens/InviteScreen";
import InviteApprovalScreen from "./src/screens/InviteApprovalScreen";
import CallScreen from "./src/screens/CallScreen";
import AdminHomeScreen from "./src/screens/AdminHomeScreen";
import ProviderHomeScreen from "./src/screens/ProviderHomeScreen";
import PatientDetailScreen from "./src/screens/PatientDetailScreen";
import AdvocateHomeScreen from "./src/screens/AdvocateHomeScreen";
import PatientHomeScreen from "./src/screens/PatientHomeScreen";

import { CallProvider, useCall } from "./src/context/CallContext";
import {
  CurrentUserProvider,
  useCurrentUser,
} from "./src/context/CurrentUserContext";
import { declineIncomingCall } from "./src/features/calls/callSignalsService";

import IncomingCallModal from "./src/components/IncomingCallModal";
import GlobalRealtimeListener from "./src/services/realtime/GlobalRealtimeListener";
import GlobalIncomingBanner from "./src/components/GlobalIncomingBanner";

Amplify.configure(amplifyConfig);

const Stack = createNativeStackNavigator();
const navRef = createNavigationContainerRef();
const client = getGraphqlClient();

const CreateCallSignal = /* GraphQL */ `
  mutation CreateCallSignal($input: CreateCallSignalInput!) {
    createCallSignal(input: $input) {
      id
    }
  }
`;

function LogoutButton({ navigation }) {
  const handleLogout = async () => {
    try {
      await signOut();
      navigation.reset({
        index: 0,
        routes: [{ name: "Auth" }],
      });
    } catch (err) {
      console.log("Logout error:", err);
      Alert.alert("Logout failed", err?.message || "Unknown error");
    }
  };

  return <Button title="Log Out" onPress={handleLogout} />;
}

function Root() {
  const { currentUser } = useCurrentUser();
  const call = useCall();

  const [incomingMsg, setIncomingMsg] = useState(null);
  const hideTimerRef = useRef(null);

  const clearBanner = useCallback(() => {
    setIncomingMsg(null);
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!incomingMsg) return;

    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setIncomingMsg(null);
      hideTimerRef.current = null;
    }, 6000);

    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [incomingMsg]);

  const onPressBanner = useCallback(() => {
    const conversationId = incomingMsg?.conversationId;
    if (!conversationId) return;

    const memberIds = Array.isArray(incomingMsg?.memberIds)
      ? incomingMsg.memberIds
      : [];

    clearBanner();

    if (navRef.isReady()) {
      navRef.navigate("Chat", {
        conversation: {
          id: conversationId,
          memberIds,
        },
      });
    }
  }, [incomingMsg, clearBanner]);

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
    }
  }

  async function onDecline(incoming) {
    const u = await getCurrentUser().catch(() => null);
    const senderId = u?.userId;

    try {
      await declineIncomingCall({
        conversationId: incoming?.conversationId,
        callSessionId: incoming?.callSessionId,
        senderId,
        reason: "declined",
      });
    } catch (e) {
      console.log("Decline error:", e);
    } finally {
      call?.hide?.();
    }
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <NavigationContainer ref={navRef}>
        <Stack.Navigator
          initialRouteName="Auth"
          screenOptions={({ navigation, route }) => ({
            headerRight:
              route.name === "Auth"
                ? undefined
                : () => <LogoutButton navigation={navigation} />,
          })}
        >
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
          <Stack.Screen name="ProviderHome" component={ProviderHomeScreen} />
          <Stack.Screen
            name="PatientDetail"
            component={PatientDetailScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen name="AdvocateHome" component={AdvocateHomeScreen} />
          <Stack.Screen name="PatientHome" component={PatientHomeScreen} />
          <Stack.Screen name="AdminHome" component={AdminHomeScreen} />
        </Stack.Navigator>

        <StatusBar style="auto" />
      </NavigationContainer>

      <GlobalRealtimeListener
        navRef={navRef}
        currentUser={currentUser}
        onIncomingMessage={(payload) => setIncomingMsg(payload)}
      />

      <GlobalIncomingBanner
        visible={!!incomingMsg}
        title="New message"
        body={incomingMsg?.preview || ""}
        onPress={onPressBanner}
      />

      <IncomingCallModal onAccept={onAccept} onDecline={onDecline} />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <CallProvider>
        <CurrentUserProvider>
          <Root />
        </CurrentUserProvider>
      </CallProvider>
    </SafeAreaProvider>
  );
}
