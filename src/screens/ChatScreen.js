import React, { useEffect, useRef, useState, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  Button,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { generateClient } from "aws-amplify/api";
import { getCurrentUser } from "aws-amplify/auth";

const client = generateClient();

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
      body
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

export default function ChatScreen({ route }) {
  const conversation = route?.params?.conversation;
  const conversationId = conversation?.id;
  const memberIds = Array.isArray(conversation?.memberIds)
    ? conversation.memberIds
    : [];
  const [me, setMe] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [usersById, setUsersById] = useState({});
  const listRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const u = await getCurrentUser();
        setMe({ sub: u.userId });
      } catch (err) {
        console.log("Failed to load current user", err);
      }
    })();
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
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;

    let sub;
    (async () => {
      try {
        const res = await client.graphql({
          query: MessagesByConversation,
          variables: { conversationId, limit: 50 },
          authMode: "userPool",
        });
        setMessages(res?.data?.messagesByConversation?.items ?? []);
        requestAnimationFrame(() =>
          listRef.current?.scrollToEnd?.({ animated: false }),
        );
      } catch (err) {
        console.log("Failed to load messages", err);
      }
    })();

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
        error: (err) => console.log("subscription error", err),
      });

    return () => sub?.unsubscribe?.();
  }, [conversationId]);

  const handleSend = async () => {
    const body = text.trim();
    if (!body || !conversationId || !me?.sub) return;
    try {
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
        <Text style={styles.body}>{item.body}</Text>
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
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Type a message…"
          value={text}
          onChangeText={setText}
          onSubmitEditing={handleSend}
          returnKeyType="send"
        />
        <Button title="Send" onPress={handleSend} disabled={!text.trim()} />
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
});
