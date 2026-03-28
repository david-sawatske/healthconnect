import React, { useEffect, useMemo, useRef, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallSignals } from "../hooks/useCallSignals";
import { useCurrentUser } from "../context/CurrentUserContext";

import MediaBubble from "../components/MediaBubble";
import { useChat } from "../features/chat/useChat";
import {
  bubbleStyleForRole,
  badgeStyleForRole,
} from "../features/chat/chatUiHelpers";
import { theme } from "../ui/theme";

const devLog = (...args) => {
  if (__DEV__) console.log("[CHAT_SCREEN]", ...args);
};

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
    requestAnimationFrame(() =>
      listRef.current?.scrollToEnd?.({ animated: false }),
    );
  }, [conversationId]);

  const roleLabelMap = useMemo(
    () => ({
      PATIENT: "Patient",
      PROVIDER: "Provider",
      ADVOCATE: "Advocate",
      ADMIN: "Admin",
    }),
    [],
  );

  const myDisplayName = currentUser?.displayName || "You";
  const myRoleLabel =
    roleLabelMap[currentUser?.role] ?? currentUser?.role ?? "Member";

  const formatTime = useCallback((ts) => {
    const d = new Date(ts ?? Date.now());
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }, []);

  const formatDayLabel = useCallback((ts) => {
    const date = new Date(ts ?? Date.now());

    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const sameDay = (a, b) =>
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();

    if (sameDay(date, today)) return "Today";
    if (sameDay(date, yesterday)) return "Yesterday";

    return date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, []);

  const dayKey = (ts) => {
    const d = new Date(ts ?? 0);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };

  const scrollToBottom = (animated = true) => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd?.({ animated }));
  };

  const handleAttach = useCallback(async () => {
    try {
      await attach();
      scrollToBottom(true);
    } catch (error) {
      devLog("attach failed", error);
      Alert.alert(
        "Upload failed",
        "Your attachment could not be uploaded. Please try again.",
      );
    }
  }, [attach]);

  const handleSend = useCallback(async () => {
    try {
      await send();
      scrollToBottom(true);
    } catch (error) {
      devLog("send failed", error);
      Alert.alert(
        "Message not sent",
        "Your message could not be sent. Please try again.",
      );
    }
  }, [send]);

  const renderItem = ({ item, index }) => {
    const isSystem = item.type === "SYSTEM";
    const mine = item.senderId === myId;
    const role = roleForSender(item.senderId, item.type);
    const name = nameForSender(item.senderId, item.type);

    const prev = messages?.[index - 1] ?? null;

    const itemDay = dayKey(item.createdAt);
    const prevDay = prev ? dayKey(prev.createdAt) : null;

    const showDateSeparator = !prev || prevDay !== itemDay;

    return (
      <>
        {showDateSeparator ? (
          <View style={styles.dateSeparatorRow}>
            <View style={styles.dateSeparator}>
              <Text style={styles.dateSeparatorText}>
                {formatDayLabel(item.createdAt)}
              </Text>
            </View>
          </View>
        ) : null}

        {isSystem ? (
          <View style={styles.systemRow}>
            <View style={styles.systemPill}>
              <Text style={styles.systemText}>{item.body}</Text>
            </View>
          </View>
        ) : (
          <View
            style={bubbleStyleForRole(styles, {
              isMine: mine,
              role,
              type: item.type,
            })}
          >
            <View style={styles.headerRow}>
              <Text style={styles.sender}>{name}</Text>
              <Text
                style={badgeStyleForRole(styles, {
                  role,
                  type: item.type,
                })}
              >
                {role}
              </Text>
            </View>

            {item.type === "TEXT" && !!item.body ? (
              <Text style={styles.body}>{item.body}</Text>
            ) : null}

            {(item.type === "IMAGE" ||
              item.type === "VIDEO" ||
              item.type === "FILE") &&
            !!item.mediaKey ? (
              <MediaBubble mediaKey={item.mediaKey} type={item.type} />
            ) : null}

            <Text style={styles.meta}>{formatTime(item.createdAt)}</Text>
          </View>
        )}
      </>
    );
  };

  const canSend = !!text.trim() && !sending && !!myId;
  const canStartCall = !!conversationId && !!myId;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      <View
        style={[
          styles.mePillRow,
          {
            paddingTop: insets.top
              ? Math.max(theme.space.xs, insets.top / 4)
              : theme.space.xs,
          },
        ]}
      >
        <Text style={styles.mePillName}>{myDisplayName}</Text>
        <View style={styles.mePillRole}>
          <Text style={styles.mePillRoleText}>{myRoleLabel}</Text>
        </View>
      </View>

      <View style={styles.divider} />

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollToBottom(true)}
      />

      <View
        style={[
          styles.inputWrap,
          {
            paddingBottom: Math.max(theme.space.sm, insets.bottom || 0),
          },
        ]}
      >
        <View style={styles.inputRow}>
          <TouchableOpacity
            accessibilityLabel="Start a video call"
            style={[
              styles.iconButton,
              styles.callButton,
              !canStartCall && styles.iconButtonDisabled,
            ]}
            disabled={!canStartCall}
            onPress={() =>
              navigation?.navigate?.("Call", {
                conversation: conversationParam || {
                  id: conversationId,
                  memberIds,
                },
              })
            }
            activeOpacity={0.85}
          >
            <Text style={[styles.iconButtonText, styles.callButtonText]}>
              📞
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityLabel="Attach media"
            style={styles.iconButton}
            onPress={handleAttach}
            activeOpacity={0.85}
          >
            <Text style={styles.iconButtonText}>＋</Text>
          </TouchableOpacity>

          <TextInput
            style={styles.input}
            placeholder="Type a message…"
            placeholderTextColor={theme.colors.subtext}
            value={text}
            onChangeText={setText}
            onSubmitEditing={handleSend}
            returnKeyType="send"
          />

          <TouchableOpacity
            style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!canSend}
            activeOpacity={0.85}
          >
            {sending ? (
              <ActivityIndicator
                size="small"
                color={theme.colors.primaryText}
              />
            ) : (
              <Text
                style={[
                  styles.sendButtonText,
                  !canSend && styles.sendButtonTextDisabled,
                ]}
              >
                Send
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },

  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },

  listContent: {
    paddingHorizontal: theme.space.sm,
    paddingTop: theme.space.xs,
    paddingBottom: theme.space.sm,
  },

  dateSeparatorRow: {
    alignItems: "center",
    marginTop: theme.space.sm,
    marginBottom: theme.space.xs,
  },

  dateSeparator: {
    backgroundColor: theme.colors.disabledBg,
    paddingVertical: theme.space.xs / 2,
    paddingHorizontal: theme.space.xs + 4,
    borderRadius: theme.radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },

  dateSeparatorText: {
    ...theme.type.small,
    color: theme.colors.muted,
    fontWeight: "600",
  },

  bubble: {
    maxWidth: "85%",
    padding: theme.space.xs,
    borderRadius: theme.radius.md,
    marginVertical: theme.space.xs / 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },

  mine: {
    alignSelf: "flex-end",
    backgroundColor: theme.colors.infoBg,
    borderColor: theme.colors.border,
  },

  theirs: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.border,
  },

  patient: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.pillPatientBg,
    borderColor: theme.colors.border,
  },

  provider: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.providerBg,
    borderColor: theme.colors.border,
  },

  advocate: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.advocateBg,
    borderColor: theme.colors.border,
  },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.xs,
    marginBottom: theme.space.xs / 2,
  },

  sender: {
    ...theme.type.small,
    fontWeight: "600",
    color: theme.colors.muted,
  },

  badge: {
    fontSize: 10,
    paddingHorizontal: theme.space.xs,
    paddingVertical: 2,
    borderRadius: theme.radius.pill,
    overflow: "hidden",
    color: theme.colors.text,
  },

  badgePatient: {
    backgroundColor: theme.colors.pillPatientBg,
    color: theme.colors.pillPatientText,
  },

  badgeProvider: {
    backgroundColor: theme.colors.pillProviderBg,
    color: theme.colors.pillProviderText,
  },

  badgeAdvocate: {
    backgroundColor: theme.colors.pillAdvocateBg,
    color: theme.colors.pillAdvocateText,
  },

  badgeOther: {
    backgroundColor: theme.colors.disabledBg,
    color: theme.colors.disabledText,
  },

  body: {
    ...theme.type.body,
    color: theme.colors.text,
  },

  meta: {
    ...theme.type.small,
    color: theme.colors.subtext,
    marginTop: theme.space.xs / 2,
    textAlign: "right",
  },

  systemRow: {
    alignSelf: "center",
    marginVertical: theme.space.xs,
    maxWidth: "92%",
  },

  systemPill: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.infoBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },

  systemText: {
    ...theme.type.small,
    color: theme.colors.infoText,
    textAlign: "center",
  },

  mePillRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.space.sm,
    paddingBottom: theme.space.xs,
    gap: theme.space.xs,
    backgroundColor: theme.colors.bg,
  },

  mePillName: {
    ...theme.type.subtext,
    fontWeight: "600",
    color: theme.colors.text,
  },

  mePillRole: {
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.disabledBg,
  },

  mePillRoleText: {
    fontSize: 11,
    fontWeight: "600",
    color: theme.colors.muted,
  },

  inputWrap: {
    backgroundColor: theme.colors.bg,
    paddingHorizontal: theme.space.sm,
    paddingTop: theme.space.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },

  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.xs,
    padding: theme.space.xs,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    ...theme.shadow.card,
  },

  iconButton: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.bg,
  },

  callButton: {
    backgroundColor: theme.colors.successBg,
    borderColor: theme.colors.border,
  },

  iconButtonDisabled: {
    opacity: 0.45,
  },

  iconButtonText: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.text,
  },

  callButtonText: {
    color: theme.colors.successText,
  },

  input: {
    flex: 1,
    minHeight: 40,
    paddingVertical: theme.space.xs,
    paddingHorizontal: theme.space.xs + 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.bg,
    color: theme.colors.text,
    ...theme.type.body,
  },

  sendButton: {
    minHeight: 40,
    paddingHorizontal: theme.space.sm,
    borderRadius: theme.radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
    minWidth: 72,
  },

  sendButtonDisabled: {
    backgroundColor: theme.colors.disabledBg,
  },

  sendButtonText: {
    ...theme.type.body,
    color: theme.colors.primaryText,
    fontWeight: "600",
  },

  sendButtonTextDisabled: {
    color: theme.colors.disabledText,
  },
});
