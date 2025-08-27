import React, { useState } from "react";
import { View, Text, TextInput, Button, StyleSheet, Alert } from "react-native";
import { generateClient } from "aws-amplify/api";
import { getCurrentUser } from "aws-amplify/auth";
import { CreateAdvocateInvite } from "../graphql/advocateInvites";
import { FindUserByEmail } from "../graphql/users";

const client = generateClient();

export default function InviteScreen({ route, navigation }) {
  const { conversation } = route.params;
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const FindUserByEmailInline = /* GraphQL */ `
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
  `;

  const sendInvite = async () => {
    if (!email.trim()) {
      Alert.alert("Missing info", "Please enter an email address");
      return;
    }
    if (!conversation?.id) {
      Alert.alert("No conversation", "Missing conversation id");
      return;
    }

    try {
      setLoading(true);

      console.log("[invite] starting lookup…");
      const { userId: me } = await getCurrentUser();
      console.log("[invite] me:", me);

      console.log("[invite] running FindUserByEmail…");
      const { data: userData } = await client.graphql({
        query: FindUserByEmailInline,
        variables: { email: email.trim().toLowerCase() },
        authMode: "userPool",
      });

      const found = userData?.listUsers?.items?.[0];
      console.log("[invite] lookup result:", found);
      if (!found) {
        Alert.alert("Not found", "No user with that email exists");
        setLoading(false);
        return;
      }

      const advocateId = found.id;
      const input = {
        patientId: me,
        advocateId,
        conversationId: conversation.id,
        status: "PENDING",
        createdBy: me,
      };

      console.log("[invite] Invite input:", JSON.stringify(input, null, 2));

      const { data } = await client.graphql({
        query: CreateAdvocateInvite,
        variables: { input },
        authMode: "userPool",
      });

      console.log("[invite] create result:", data?.createAdvocateInvite);
      if (data?.createAdvocateInvite) {
        Alert.alert("Invite sent", `Invite created for ${found.email}`);
        navigation.goBack();
      }
    } catch (err) {
      console.log("Failed to create invite", err);
      Alert.alert("Error", "Could not create invite");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Invite Advocate by Email</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder="advocate@example.com"
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <Button
        title={loading ? "Sending..." : "Send Invite"}
        onPress={sendInvite}
        disabled={loading}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  label: { fontSize: 16, marginBottom: 8 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
  },
});
