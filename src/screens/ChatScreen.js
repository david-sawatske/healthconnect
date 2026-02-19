import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Button,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Image,
  TouchableOpacity,
  Alert,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallSignals } from "../hooks/useCallSignals";
import { useCurrentUser } from "../context/CurrentUserContext";

import { useChat } from "../features/chat/useChat";
import { getMediaUrl } from "../features/chat/chatService";

export default function ChatScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();
  const { currentUser } = useCurrentUser();

  const conversationParam = route?.params?.conversation || null;
  const routeConversationId = route?.params?.conversationId || null;

  const conversationId = conversationParam?.id || routeConversationId || null;

  const myId = currentUser?.id || null;
  const listRef = useRef(null);

  const {
    memberIds,
    messages,
    text,
    setText,
    sending,
    send,
    attach,
    roleForSender,
    nameForSender,
  } = useChat({
    conversationId,
    conversation: conversationParam,
    currentUser,
  });

  useCallSignals({ conversationId, currentUserId: myId });

  useEffect(() => {
    if (!conversationId) return;
    console.log("[CHAT] user:", currentUser || null);
    console.log("[CHAT] conversationId:", conversationId);
  }, [conversationId, currentUser]);

  useEffect(() => {
    if (!conversationId) return;
    requestAnimationFrame(() =>
      listRef.current?.scrollToEnd?.({ animated: false }),
    );
  }, [conversationId]);

  const bubbleStyleForRole = (isMine, role, type) => {
    if (type === "SYSTEM") return [styles.bubble, styles.system];
    if (isMine) return [styles.bubble, styles.mine];
    switch (role) {
      case "PATIENT":
        return [styles.bubble, styles.patient];
      case "PROVIDER":
        return [styles.bubble, styles.provider];
      case "ADVOCATE":
        return [styles.bubble, styles.advocate];
      default:
        return [styles.bubble, styles.theirs];
    }
  };

  const badgeStyleForRole = (role, type) => {
    if (type === "SYSTEM") return [styles.badge, styles.badgeSystem];
    switch (role) {
      case "PATIENT":
        return [styles.badge, styles.badgePatient];
      case "PROVIDER":
        return [styles.badge, styles.badgeProvider];
      case "ADVOCATE":
        return [styles.badge, styles.badgeAdvocate];
      default:
        return [styles.badge, styles.badgeOther];
    }
  };

  function MediaBubble({ mediaKey, type }) {
    const [url, setUrl] = useState(null);

    useEffect(() => {
      let mounted = true;
      (async () => {
        try {
          const u = await getMediaUrl(mediaKey, { expiresIn: 300 });
          if (mounted) setUrl(u);
        } catch (e) {
          console.log("[CHAT] getUrl error:", e);
        }
      })();
      return () => {
        mounted = false;
      };
    }, [mediaKey]);

    if (!url) {
      return <Text style={{ opacity: 0.6 }}>Loading attachment…</Text>;
    }

    if (type === "IMAGE") {
      return (
        <Image
          source={{ uri: url }}
          style={{
            width: 220,
            height: 220,
            borderRadius: 8,
            backgroundColor: "#ddd",
            marginTop: 6,
          }}
          resizeMode="cover"
        />
      );
    }

    const label = type === "VIDEO" ? "Open video" : "Open file";
    return (
      <TouchableOpacity
        onPress={() => Linking.openURL(url)}
        style={styles.attachBtn}
      >
        <Text style={styles.attachBtnText}>{label}</Text>
      </TouchableOpacity>
    );
  }

  const renderItem = ({ item }) => {
    const isSystem = item.type === "SYSTEM";
    const mine = item.senderId === myId;
    const role = roleForSender(item.senderId, item.type);
    const name = nameForSender(item.senderId, item.type);

    if (isSystem) {
      return (
        <View style={styles.systemRow}>
          <Text style={styles.systemText}>{item.body}</Text>
        </View>
      );
    }

    return (
      <View style={bubbleStyleForRole(mine, role, item.type)}>
        <View style={styles.headerRow}>
          <Text style={styles.sender}>{name}</Text>
          <Text style={badgeStyleForRole(role, item.type)}>{role}</Text>
        </View>

        {item.type === "TEXT" && !!item.body && (
          <Text style={styles.body}>{item.body}</Text>
        )}

        {(item.type === "IMAGE" ||
          item.type === "VIDEO" ||
          item.type === "FILE") &&
          !!item.mediaKey && (
            <MediaBubble mediaKey={item.mediaKey} type={item.type} />
          )}

        <Text style={styles.meta}>
          {new Date(item.createdAt ?? Date.now()).toLocaleTimeString()}
        </Text>
      </View>
    );
  };

  const roleLabelMap = {
    PATIENT: "Patient",
    PROVIDER: "Provider",
    ADVOCATE: "Advocate",
    ADMIN: "Admin",
  };

  const myDisplayName = currentUser?.displayName || "You";
  const myRoleLabel =
    roleLabelMap[currentUser?.role] ?? currentUser?.role ?? "Member";

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: "#fff" }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View
        style={[
          styles.mePillRow,
          { paddingTop: insets.top ? insets.top / 4 : 6 },
        ]}
      >
        <Text style={styles.mePillName}>{myDisplayName}</Text>
        <View style={styles.mePillRole}>
          <Text style={styles.mePillRoleText}>{myRoleLabel}</Text>
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 12, paddingTop: 4 }}
        onContentSizeChange={() =>
          listRef.current?.scrollToEnd?.({ animated: true })
        }
      />

      <View
        style={[
          styles.inputRow,
          {
            paddingBottom: Math.max(12, insets.bottom || 0),
            backgroundColor: "#fff",
          },
        ]}
      >
        <TouchableOpacity
          accessibilityLabel="Start a video call"
          style={styles.call}
          onPress={() =>
            navigation?.navigate?.("Call", {
              conversation: conversationParam || {
                id: conversationId,
                memberIds,
              },
            })
          }
        >
          <Text style={styles.callIcon}>📞</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.attach}
          onPress={async () => {
            try {
              await attach();
              requestAnimationFrame(() =>
                listRef.current?.scrollToEnd?.({ animated: true }),
              );
            } catch (e) {
              console.log("[CHAT] attach error:", e);
              Alert.alert("Upload failed", "Could not upload attachment.");
            }
          }}
        >
          <Text style={styles.attachIcon}>+</Text>
        </TouchableOpacity>

        <TextInput
          style={styles.input}
          placeholder="Type a message…"
          value={text}
          onChangeText={setText}
          onSubmitEditing={async () => {
            try {
              await send();
              requestAnimationFrame(() =>
                listRef.current?.scrollToEnd?.({ animated: true }),
              );
            } catch {
              Alert.alert("Error", "Failed to send message.");
            }
          }}
          returnKeyType="send"
        />

        <Button
          title={sending ? "Sending…" : "Send"}
          onPress={async () => {
            try {
              await send();
              requestAnimationFrame(() =>
                listRef.current?.scrollToEnd?.({ animated: true }),
              );
            } catch {
              Alert.alert("Error", "Failed to send message.");
            }
          }}
          disabled={!text.trim() || sending || !myId}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  bubble: {
    maxWidth: "85%",
    padding: 10,
    borderRadius: 12,
    marginVertical: 6,
  },
  mine: { alignSelf: "flex-end", backgroundColor: "#e8e8e8" },
  theirs: { alignSelf: "flex-start", backgroundColor: "#EEE" },
  patient: { alignSelf: "flex-start", backgroundColor: "#ffe6e6" },
  provider: { alignSelf: "flex-start", backgroundColor: "#e6f0ff" },
  advocate: { alignSelf: "flex-start", backgroundColor: "#e6ffef" },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
  },
  sender: { fontSize: 12, fontWeight: "600", opacity: 0.9 },
  badge: {
    fontSize: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: "hidden",
  },
  badgePatient: { backgroundColor: "#ffb3b3" },
  badgeProvider: { backgroundColor: "#b3ccff" },
  badgeAdvocate: { backgroundColor: "#bff5ce" },
  badgeOther: { backgroundColor: "#ddd" },

  body: { fontSize: 16 },
  meta: { fontSize: 11, opacity: 0.7, marginTop: 4, textAlign: "right" },

  systemRow: { alignSelf: "center", marginVertical: 6, maxWidth: "90%" },
  system: {
    alignSelf: "center",
    backgroundColor: "transparent",
    paddingVertical: 2,
  },
  badgeSystem: { backgroundColor: "#eee" },
  systemText: { fontSize: 12, opacity: 0.7, textAlign: "center" },

  mePillRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 4,
    gap: 8,
    backgroundColor: "#fff",
  },
  mePillName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  mePillRole: {
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: "#E5E7EB",
  },
  mePillRoleText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#374151",
  },

  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "#ddd",
  },
  input: {
    flex: 1,
    padding: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ccc",
    borderRadius: 10,
  },
  attach: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ccc",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fafafa",
    marginRight: 8,
  },
  attachIcon: {
    fontSize: 20,
    fontWeight: "700",
  },
  attachBtn: {
    marginTop: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "#f2f2f2",
    alignSelf: "flex-start",
  },
  attachBtnText: { fontSize: 13, fontWeight: "600" },

  call: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ccc",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e8fff0",
    marginRight: 6,
  },
  callIcon: { fontSize: 18, fontWeight: "700" },
});
