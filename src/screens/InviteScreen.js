import React, { useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { generateClient } from "aws-amplify/api";
import { getCurrentUser } from "aws-amplify/auth";
import { CreateAdvocateInvite } from "../graphql/advocateInvites";
import { theme } from "../ui/theme";

const client = generateClient();

export default function InviteScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();
  const { conversation } = route.params || {};

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const FindUserByEmailInline = useMemo(
    () => /* GraphQL */ `
      query FindUserByEmail($email: String!) {
        listUsers(filter: { email: { eq: $email } }) {
          items {
            id
            email
            displayName
            role
          }
        }
      }
    `,
    [],
  );

  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);
  const canSend = !!normalizedEmail && !!conversation?.id && !loading;

  const sendInvite = useCallback(async () => {
    if (!normalizedEmail) {
      Alert.alert("Missing info", "Please enter an email address.");
      return;
    }
    if (!conversation?.id) {
      Alert.alert("No conversation", "Missing conversation id.");
      return;
    }

    try {
      setLoading(true);

      const { userId: me } = await getCurrentUser();

      const { data: userData } = await client.graphql({
        query: FindUserByEmailInline,
        variables: { email: normalizedEmail },
        authMode: "userPool",
      });

      const found = userData?.listUsers?.items?.[0];
      if (!found) {
        Alert.alert("Not found", "No user with that email exists.");
        return;
      }

      if (found.id === me) {
        Alert.alert("Invalid invite", "You can't invite yourself.");
        return;
      }

      const input = {
        patientId: me,
        advocateId: found.id,
        conversationId: conversation.id,
        status: "PENDING",
        createdBy: me,
      };

      const { data } = await client.graphql({
        query: CreateAdvocateInvite,
        variables: { input },
        authMode: "userPool",
      });

      if (data?.createAdvocateInvite) {
        Alert.alert("Invite sent", `Invite created for ${found.email}`);
        navigation.goBack();
        return;
      }

      Alert.alert("Error", "Invite was not created. Please try again.");
    } catch (err) {
      console.log("[INVITE] Failed to create invite", err);
      Alert.alert("Error", "Could not create invite.");
    } finally {
      setLoading(false);
    }
  }, [FindUserByEmailInline, normalizedEmail, conversation?.id, navigation]);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
        <View style={styles.topBar}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            accessibilityLabel="Go back"
          >
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>
            Invite Advocate
          </Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Advocate email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="advocate@example.com"
            placeholderTextColor={theme.colors.subtext}
            autoCapitalize="none"
            keyboardType="email-address"
            autoCorrect={false}
            textContentType="emailAddress"
            returnKeyType="send"
            onSubmitEditing={() => {
              if (canSend) sendInvite();
            }}
          />

          <Text style={styles.hint}>
            We’ll look up the user by email and send an invite linked to this
            conversation.
          </Text>

          <TouchableOpacity
            style={[styles.primaryBtn, !canSend && styles.primaryBtnDisabled]}
            onPress={sendInvite}
            disabled={!canSend}
            accessibilityLabel="Send invite"
          >
            {loading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={theme.colors.primaryText} />
                <Text style={styles.primaryBtnText}>Sending…</Text>
              </View>
            ) : (
              <Text style={styles.primaryBtnText}>Send Invite</Text>
            )}
          </TouchableOpacity>

          {!conversation?.id ? (
            <View style={styles.warnBox}>
              <Text style={styles.warnText}>
                Missing conversation id. Open this screen from an active
                conversation.
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  container: { flex: 1, paddingHorizontal: theme.space.sm },

  topBar: {
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
  title: { ...theme.type.h2, fontSize: 18, flex: 1 },

  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: theme.space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    ...theme.shadow.card,
  },

  label: { ...theme.type.subtext, fontWeight: "700", color: theme.colors.text },
  input: {
    marginTop: theme.space.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: theme.colors.bg,
    color: theme.colors.text,
    fontSize: 16,
  },

  hint: {
    marginTop: theme.space.xs,
    ...theme.type.small,
    color: theme.colors.subtext,
  },

  primaryBtn: {
    marginTop: theme.space.sm,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnDisabled: {
    backgroundColor: theme.colors.disabledBg,
  },
  primaryBtnText: {
    fontSize: 14,
    fontWeight: "800",
    color: theme.colors.primaryText,
  },

  loadingRow: { flexDirection: "row", alignItems: "center", gap: 10 },

  warnBox: {
    marginTop: theme.space.sm,
    padding: theme.space.xs,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.dangerBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  warnText: { ...theme.type.small, color: theme.colors.dangerText },
});
