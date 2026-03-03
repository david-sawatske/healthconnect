import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { generateClient } from "aws-amplify/api";
import { getCurrentUser } from "aws-amplify/auth";
import {
  ListMyAdvocateInvites,
  DeclineAdvocateInvite,
} from "../graphql/advocateInvites";
import { GetConversation } from "../graphql/conversations";
import { ApproveInviteServer } from "../graphql/customMutations";
import { theme } from "../ui/theme";

const client = generateClient();

export default function InviteApprovalScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const [meSub, setMeSub] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [invites, setInvites] = useState([]);
  const [nextToken, setNextToken] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const u = await getCurrentUser();
        if (!mounted) return;
        setMeSub(u.userId);
      } catch (e) {
        console.log("[INVITE_APPROVAL] Failed to get current user", e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const loadInvites = useCallback(
    async (cursor = null) => {
      if (!meSub) return;

      setBusy(true);
      try {
        const { data } = await client.graphql({
          query: ListMyAdvocateInvites,
          variables: { sub: meSub, limit: 25, nextToken: cursor ?? undefined },
          authMode: "userPool",
        });

        const page = data?.listAdvocateInvites;
        setInvites((prev) =>
          cursor ? [...prev, ...(page?.items ?? [])] : (page?.items ?? []),
        );
        setNextToken(page?.nextToken ?? null);
      } catch (e) {
        console.log("[INVITE_APPROVAL] List invites failed", e);
        Alert.alert("Error", "Could not load invites.");
      } finally {
        setBusy(false);
      }
    },
    [meSub],
  );

  useEffect(() => {
    if (meSub) loadInvites();
  }, [meSub, loadInvites]);

  const approve = useCallback(
    async (invite) => {
      if (!invite?.id) return;

      setBusy(true);
      try {
        const { data } = await client.graphql({
          query: ApproveInviteServer,
          variables: { inviteId: invite.id },
          authMode: "userPool",
        });

        const approved = data?.approveInvite;
        if (approved?.status === "APPROVED") {
          const convoId = approved.conversationId;

          try {
            const { data: convoData } = await client.graphql({
              query: GetConversation,
              variables: { id: convoId },
              authMode: "userPool",
            });
            const conversation = convoData?.getConversation || { id: convoId };
            navigation.navigate("Chat", { conversation });
          } catch {
            navigation.navigate("Chat", { conversation: { id: convoId } });
          }

          setInvites((prev) => prev.filter((i) => i.id !== invite.id));
          return;
        }

        Alert.alert("Error", "Approval did not complete.");
      } catch (e) {
        console.log("[INVITE_APPROVAL] Approve failed", e);
        Alert.alert("Error", "Could not approve invite.");
      } finally {
        setBusy(false);
      }
    },
    [navigation],
  );

  const decline = useCallback(async (invite) => {
    if (!invite?.id) return;

    setBusy(true);
    try {
      await client.graphql({
        query: DeclineAdvocateInvite,
        variables: { input: { id: invite.id, status: "DECLINED" } },
        authMode: "userPool",
      });

      Alert.alert("Declined", "Invite has been declined.");
      setInvites((prev) => prev.filter((i) => i.id !== invite.id));
    } catch (e) {
      console.log("[INVITE_APPROVAL] Decline failed", e);
      Alert.alert("Error", "Could not decline invite.");
    } finally {
      setBusy(false);
    }
  }, []);

  const subtitle = useMemo(() => {
    if (loading) return "";
    if (busy && invites.length === 0) return "Loading invites…";
    return "Approve or decline advocate invites.";
  }, [loading, busy, invites.length]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.centerText}>Loading…</Text>
      </View>
    );
  }

  const renderInvite = ({ item }) => {
    const status = item?.status ?? "UNKNOWN";
    const approved = status === "APPROVED";
    const declined = status === "DECLINED";

    const statusPillStyle = [
      styles.statusPill,
      approved && styles.statusPillApproved,
      declined && styles.statusPillDeclined,
      !approved && !declined && styles.statusPillPending,
    ];

    const statusTextStyle = [
      styles.statusText,
      approved && styles.statusTextApproved,
      declined && styles.statusTextDeclined,
      !approved && !declined && styles.statusTextPending,
    ];

    return (
      <View style={styles.card}>
        <View style={styles.cardTopRow}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            Invite
          </Text>

          <View style={statusPillStyle}>
            <Text style={statusTextStyle}>{status}</Text>
          </View>
        </View>

        <Text style={styles.rowLabel}>Conversation</Text>
        <Text style={styles.rowValue} numberOfLines={1}>
          {item?.conversationId || "—"}
        </Text>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.primaryBtn, busy && styles.btnDisabled]}
            onPress={() => approve(item)}
            disabled={busy || approved}
            accessibilityLabel="Approve invite"
          >
            <Text style={styles.primaryBtnText}>
              {approved ? "Approved" : "Approve"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.dangerBtn, busy && styles.btnDisabled]}
            onPress={() => decline(item)}
            disabled={busy || declined}
            accessibilityLabel="Decline invite"
          >
            <Text style={styles.dangerBtnText}>
              {declined ? "Declined" : "Decline"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View
      style={[
        styles.screen,
        { paddingTop: insets.top + 8, paddingBottom: insets.bottom || 0 },
      ]}
    >
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityLabel="Go back"
        >
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Your Invites</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>

        <TouchableOpacity
          onPress={() => loadInvites(null)}
          style={styles.refreshBtn}
          disabled={busy}
          accessibilityLabel="Refresh invites"
        >
          <Text style={styles.refreshText}>↻</Text>
        </TouchableOpacity>
      </View>

      {busy && invites.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={invites}
          keyExtractor={(i) => i.id}
          renderItem={renderInvite}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No invites</Text>
              <Text style={styles.emptyBody}>
                When a patient invites you, it will show up here.
              </Text>
            </View>
          }
          onEndReached={() => nextToken && !busy && loadInvites(nextToken)}
          onEndReachedThreshold={0.6}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    paddingHorizontal: theme.space.sm,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingBottom: theme.space.sm,
  },

  backBtn: {
    width: 40,
    height: 36,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.card,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    ...theme.shadow.card,
  },
  backText: { fontSize: 18, fontWeight: "800", color: theme.colors.text },

  refreshBtn: {
    width: 40,
    height: 36,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.card,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    ...theme.shadow.card,
    opacity: 0.95,
  },
  refreshText: { fontSize: 18, fontWeight: "800", color: theme.colors.text },

  title: { ...theme.type.h2, fontSize: 18 },
  subtitle: { ...theme.type.small, color: theme.colors.subtext, marginTop: 2 },

  listContent: {
    paddingBottom: theme.space.lg,
  },

  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  centerText: { marginTop: 8, color: theme.colors.subtext },

  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: theme.space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    marginBottom: theme.space.sm,
    ...theme.shadow.card,
  },

  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: theme.space.xs,
  },
  cardTitle: { ...theme.type.h3, fontSize: 14 },

  rowLabel: {
    ...theme.type.small,
    color: theme.colors.subtext,
    marginTop: theme.space.xs,
  },
  rowValue: {
    ...theme.type.body,
    fontSize: 14,
    color: theme.colors.text,
    marginTop: 2,
  },

  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.disabledBg,
  },
  statusText: {
    ...theme.type.small,
    fontWeight: "800",
    color: theme.colors.muted,
  },

  statusPillApproved: { backgroundColor: theme.colors.successBg },
  statusTextApproved: { color: theme.colors.successText },

  statusPillDeclined: { backgroundColor: theme.colors.dangerBg },
  statusTextDeclined: { color: theme.colors.dangerText },

  statusPillPending: { backgroundColor: theme.colors.infoBg },
  statusTextPending: { color: theme.colors.infoText },

  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: theme.space.sm,
  },

  primaryBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { fontWeight: "800", color: theme.colors.primaryText },

  dangerBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.dangerBg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  dangerBtnText: { fontWeight: "800", color: theme.colors.dangerText },

  btnDisabled: { opacity: 0.55 },

  empty: {
    marginTop: theme.space.lg,
    alignItems: "center",
    padding: theme.space.sm,
  },
  emptyTitle: { ...theme.type.h3, fontSize: 14 },
  emptyBody: {
    ...theme.type.subtext,
    textAlign: "center",
    marginTop: 6,
    color: theme.colors.subtext,
  },
});
