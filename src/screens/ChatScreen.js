import React, { useEffect, useRef, useState, useCallback } from "react";
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
import { useFocusEffect } from "@react-navigation/native";
import * as DocumentPicker from "expo-document-picker";
import { generateClient } from "aws-amplify/api";
import { getCurrentUser } from "aws-amplify/auth";
import { getUrl, uploadData } from "aws-amplify/storage";
import { useCallSignals } from "../hooks/useCallSignals";

const client = generateClient();
const log = (...args) => console.log("[CHAT]", ...args);

const MessagesByConversation = /* GraphQL */ `
  query MessagesByConversation(
    $conversationId: ID!
    $limit: Int
    $nextToken: String
  ) {
    messagesByConversation(
      conversationId: $conversationId
      sortDirection: ASC
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        conversationId
        senderId
        memberIds
        type
        body
        mediaKey
        thumbnailKey
        createdAt
      }
      nextToken
    }
  }
`;

const CreateMessage = /* GraphQL */ `
  mutation CreateMessage($input: CreateMessageInput!) {
    createMessage(input: $input) {
      id
      conversationId
      senderId
      memberIds
      type
      body
      mediaKey
      thumbnailKey
      createdAt
    }
  }
`;

const OnCreateMessage = /* GraphQL */ `
  subscription OnCreateMessage {
    onCreateMessage {
      id
      conversationId
      senderId
      memberIds
      body
      mediaKey
      thumbnailKey
      type
      createdAt
    }
  }
`;

const GetUser = /* GraphQL */ `
  query GetUser($id: ID!) {
    getUser(id: $id) {
      id
      displayName
      role
      email
    }
  }
`;

function extFromName(name = "") {
  const m = name.toLowerCase().match(/\.(\w+)$/);
  return m ? m[1] : "";
}

function guessType({ mimeType, name }) {
  const ext = extFromName(name);
  if (
    (mimeType || "").startsWith("image/") ||
    ["png", "jpg", "jpeg", "gif", "webp", "heic"].includes(ext)
  )
    return "IMAGE";
  if (
    (mimeType || "").startsWith("video/") ||
    ["mp4", "mov", "m4v", "webm"].includes(ext)
  )
    return "VIDEO";
  return "FILE";
}

export default function ChatScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();

  const conversation = route?.params?.conversation;
  const conversationId = conversation?.id;
  const memberIds = Array.isArray(conversation?.memberIds)
    ? conversation.memberIds
    : [];

  const [me, setMe] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [usersById, setUsersById] = useState({});
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  useCallSignals({ conversationId, currentUserId: me?.sub });

  const fetchMessages = useCallback(async () => {
    if (!conversationId) return;
    try {
      const res = await client.graphql({
        query: MessagesByConversation,
        variables: { conversationId, limit: 50 },
        authMode: "userPool",
      });
      const items = res?.data?.messagesByConversation?.items ?? [];
      setMessages(items);

      requestAnimationFrame(() =>
        listRef.current?.scrollToEnd?.({ animated: false }),
      );
    } catch (err) {
      console.log("[CHAT] fetchMessages error", err);
    }
  }, [conversationId]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const u = await getCurrentUser();
        if (mounted) {
          setMe({ sub: u.userId });
          log("currentUser", { sub: u.userId, username: u.username });
        }
      } catch (err) {
        console.log("Failed to load current user", err);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ids = [...new Set(memberIds)].filter(Boolean);
        const results = await Promise.allSettled(
          ids.map((id) =>
            client.graphql({
              query: GetUser,
              variables: { id },
              authMode: "userPool",
            }),
          ),
        );
        if (cancelled) return;
        const map = {};
        results.forEach((r) => {
          if (r.status === "fulfilled") {
            const u = r.value?.data?.getUser;
            if (u?.id) map[u.id] = u;
          }
        });
        setUsersById(map);
      } catch (e) {
        console.log("Load participants failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, memberIds.join(",")]);

  useFocusEffect(
    useCallback(() => {
      if (!conversationId) return;

      let sub;
      let retryTimer;

      fetchMessages();

      retryTimer = setTimeout(() => {
        fetchMessages();
      }, 500);

      sub = client
        .graphql({ query: OnCreateMessage, authMode: "userPool" })
        .subscribe({
          next: ({ data }) => {
            const msg = data?.onCreateMessage;
            if (msg?.conversationId !== conversationId) return;

            setMessages((prev) =>
              prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
            );

            requestAnimationFrame(() =>
              listRef.current?.scrollToEnd?.({ animated: true }),
            );
          },
          error: (err) => console.log("message subscription error", err),
        });

      return () => {
        try {
          sub?.unsubscribe?.();
        } catch (e) {}
        if (retryTimer) clearTimeout(retryTimer);
      };
    }, [conversationId, fetchMessages]),
  );

  const handleSend = async () => {
    const body = text.trim();
    if (!body || !conversationId || !me?.sub) return;
    try {
      setSending(true);
      const { data } = await client.graphql({
        query: CreateMessage,
        variables: {
          input: {
            conversationId,
            senderId: me.sub,
            memberIds: conversation.memberIds ?? [me.sub],
            type: "TEXT",
            body,
          },
        },
        authMode: "userPool",
      });

      const created = data?.createMessage;
      if (created) {
        setMessages((prev) =>
          prev.some((m) => m.id === created.id) ? prev : [...prev, created],
        );
        requestAnimationFrame(() =>
          listRef.current?.scrollToEnd?.({ animated: true }),
        );
      }
      setText("");
    } catch (err) {
      console.log("Failed to send message", err);
      Alert.alert("Error", "Failed to send message.");
    } finally {
      setSending(false);
    }
  };

  const handleAttach = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: "*/*" });
      if (result.canceled) return;

      const file = result.assets?.[0];
      if (!file?.uri) return;

      const fileType = guessType({ mimeType: file.mimeType, name: file.name });
      const key = `uploads/${conversationId}/${Date.now()}-${(
        file.name || "file"
      ).replace(/\s+/g, "_")}`;

      const blob = await fetch(file.uri).then((r) => r.blob());

      await uploadData({
        key,
        data: blob,
        options: { contentType: file.mimeType || undefined },
      }).result;

      const { data } = await client.graphql({
        query: CreateMessage,
        variables: {
          input: {
            conversationId,
            senderId: me?.sub,
            memberIds: conversation.memberIds ?? [me?.sub],
            type: fileType,
            mediaKey: key,
          },
        },
        authMode: "userPool",
      });

      const created = data?.createMessage;
      if (created) {
        setMessages((prev) =>
          prev.some((m) => m.id === created.id) ? prev : [...prev, created],
        );
        requestAnimationFrame(() =>
          listRef.current?.scrollToEnd?.({ animated: true }),
        );
      }
    } catch (e) {
      console.log("Attach failed:", e);
      Alert.alert("Upload failed", "Could not upload attachment.");
    }
  };

  const roleForSender = (senderId, type) => {
    if (type === "SYSTEM") return "SYSTEM";
    const r = usersById?.[senderId]?.role;
    return r || (senderId === me?.sub ? "USER" : "USER");
  };

  const nameForSender = (senderId, type) => {
    if (type === "SYSTEM") return "System";
    const u = usersById?.[senderId];
    return (
      u?.displayName || u?.email || (senderId === me?.sub ? "You" : "Member")
    );
  };

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
          const u = await getUrl({
            key: mediaKey,
            options: { expiresIn: 300 },
          });
          if (mounted) setUrl(u?.url?.toString?.() || null);
        } catch (e) {
          console.log("getUrl failed", e);
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
    const mine = item.senderId === me?.sub;
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

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 12 }}
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
          onPress={() => navigation?.navigate?.("Call", { conversation })}
        >
          <Text style={styles.callIcon}>📞</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.attach} onPress={handleAttach}>
          <Text style={styles.attachIcon}>+</Text>
        </TouchableOpacity>

        <TextInput
          style={styles.input}
          placeholder="Type a message…"
          value={text}
          onChangeText={setText}
          onSubmitEditing={handleSend}
          returnKeyType="send"
        />
        <Button
          title={sending ? "Sending…" : "Send"}
          onPress={handleSend}
          disabled={!text.trim() || sending}
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
