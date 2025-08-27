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
} from "react-native";
import { generateClient } from "aws-amplify/api";
import { getCurrentUser } from "aws-amplify/auth";
import { GetUser } from "../graphql/users";

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
      createdAt
    }
  }
`;

export default function ChatScreen({ route, navigation }) {
  const conversation = route?.params?.conversation;
  const conversationId = conversation?.id;
  const [me, setMe] = useState(null);
  const [role, setRole] = useState("");
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const listRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const u = await getCurrentUser();
        setMe({ sub: u.userId });

        const { data } = await client.graphql({
          query: GetUser,
          variables: { id: u.userId },
          authMode: "userPool",
        });
        if (data?.getUser?.role) {
          setRole(data.getUser.role);
        }
      } catch (err) {
        console.log("Failed to load current user", err);
      }
    })();
  }, []);

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

  useEffect(() => {
    if (!conversation || role !== "PATIENT") return;
    navigation.setOptions({
      headerRight: () => (
        <Button
          title="Invite"
          onPress={() => navigation.navigate("Invite", { conversation })}
        />
      ),
    });
  }, [navigation, conversation, role]);

  const handleSend = async () => {
    const body = text.trim();
    if (!body || !conversationId || !me.sub) return;

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

  const renderItem = ({ item }) => {
    const mine = item.senderId === me.sub;
    return (
      <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
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
  mine: { alignSelf: "flex-end", backgroundColor: "#DCF8C6" },
  theirs: { alignSelf: "flex-start", backgroundColor: "#EEE" },
  body: { fontSize: 16 },
  meta: { fontSize: 11, opacity: 0.7, marginTop: 4, textAlign: "right" },
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
