import React from "react";
import { Button, Alert } from "react-native";
import {
  NavigationContainer,
  createNavigationContainerRef,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { signOut, getCurrentUser } from "aws-amplify/auth";

import AuthScreen from "../screens/AuthScreen";
import HomeScreen from "../screens/HomeScreen";
import ChatScreen from "../screens/ChatScreen";
import CallScreen from "../screens/CallScreen";
import AdminHomeScreen from "../screens/AdminHomeScreen";
import ProviderHomeScreen from "../screens/ProviderHomeScreen";
import PatientDetailScreen from "../screens/PatientDetailScreen";
import AdvocateHomeScreen from "../screens/AdvocateHomeScreen";
import PatientHomeScreen from "../screens/PatientHomeScreen";

import { useCurrentUser } from "../context/CurrentUserContext";
import { useCall } from "../context/CallContext";

import GlobalRealtimeListener from "../services/realtime/GlobalRealtimeListener";
import GlobalIncomingBanner from "../components/GlobalIncomingBanner";
import IncomingCallModal from "../components/IncomingCallModal";
import { declineIncomingCall } from "../features/calls/callLifecycleService";

const Stack = createNativeStackNavigator();
export const navRef = createNavigationContainerRef();

function LogoutButton({ navigation }) {
  const handleLogout = async () => {
    try {
      await signOut();
      navigation.reset({ index: 0, routes: [{ name: "Auth" }] });
    } catch (err) {
      console.log("Logout error:", err);
      Alert.alert("Logout failed", err?.message || "Unknown error");
    }
  };

  return <Button title="Log Out" onPress={handleLogout} />;
}

export default function AppNavigator() {
  const { currentUser } = useCurrentUser();
  const call = useCall();

  const [incomingMsg, setIncomingMsg] = React.useState(null);
  const hideTimerRef = React.useRef(null);

  const clearBanner = React.useCallback(() => {
    setIncomingMsg(null);

    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  React.useEffect(() => {
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

  const onPressBanner = React.useCallback(() => {
    const conversationId = incomingMsg?.conversationId;
    if (!conversationId) return;

    const memberIds = Array.isArray(incomingMsg?.memberIds)
      ? incomingMsg.memberIds
      : [];

    clearBanner();

    if (navRef.isReady()) {
      navRef.navigate("Chat", {
        conversation: { id: conversationId, memberIds },
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
        memberIds: incoming?.memberIds || [],
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
