import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, Button, Alert } from 'react-native';
import { generateClient } from 'aws-amplify/api';
import { getCurrentUser } from 'aws-amplify/auth';
import {
  ListMyAdvocateInvites,
  ApproveAdvocateInvite,
  DeclineAdvocateInvite
} from '../graphql/advocateInvites';
import { GetConversation, UpdateConversation } from '../graphql/conversations';

const client = generateClient();

export default function InviteApprovalScreen() {
  const [meSub, setMeSub] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [invites, setInvites] = useState([]);
  const [nextToken, setNextToken] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const u = await getCurrentUser();
        setMeSub(u.userId);
      } catch (e) {
        console.log('Failed to get current user', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const loadInvites = async (cursor = null) => {
    if (!meSub) return;
    setBusy(true);
    try {
      const { data } = await client.graphql({
        query: ListMyAdvocateInvites,
        variables: { sub: meSub, limit: 25, nextToken: cursor ?? undefined },
        authMode: 'userPool'
      });
      const page = data?.listAdvocateInvites;
      setInvites((prev) => (cursor ? [...prev, ...(page?.items ?? [])] : (page?.items ?? [])));
      setNextToken(page?.nextToken ?? null);
    } catch (e) {
      console.log('List invites failed', e);
      Alert.alert('Error', 'Could not load invites.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (meSub) loadInvites();
  }, [meSub]);

  const approve = async (invite) => {
    console.log('meSub:', meSub, 'invite.advocateId:', invite.advocateId);
    if (!invite?.id) return;
    setBusy(true);
    try {
      // 1) Mark invite APPROVED
      await client.graphql({
        query: ApproveAdvocateInvite,
        variables: {
          input: {
            id: invite.id,
            status: 'APPROVED',
            approvedBy: meSub,
            approvedAt: new Date().toISOString()
          }
        },
        authMode: 'userPool'
      });

      // 2) Add advocate to conversation.memberIds
      const convId = invite.conversationId;
      const convRes = await client.graphql({
        query: GetConversation,
        variables: { id: convId },
        authMode: 'userPool'
      });
      const currentMembers = convRes?.data?.getConversation?.memberIds ?? [];
      const members = Array.from(new Set([...currentMembers, invite.advocateId]));

      await client.graphql({
        query: UpdateConversation,
        variables: { input: { id: convId, memberIds: members } },
        authMode: 'userPool'
      });

      Alert.alert('Invite approved', 'You now have access to the conversation.');
      loadInvites();
    } catch (e) {
      console.log('Approve failed', e);
      Alert.alert('Error', 'Could not approve invite.');
    } finally {
      setBusy(false);
    }
  };

  const decline = async (invite) => {
    if (!invite?.id) return;
    setBusy(true);
    try {
      await client.graphql({
        query: DeclineAdvocateInvite,
        variables: { input: { id: invite.id, status: 'DENIED' } },
        authMode: 'userPool'
      });
      Alert.alert('Invite declined', 'Invite has been declined.');
      loadInvites();
    } catch (e) {
      console.log('Decline failed', e);
      Alert.alert('Error', 'Could not decline invite.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Loading…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Your Invites</Text>
      {busy && invites.length === 0 ? (
        <View style={styles.center}><ActivityIndicator /></View>
      ) : (
        <FlatList
          data={invites}
          keyExtractor={(i) => i.id}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.row}>Conversation: {item.conversationId}</Text>
              <Text style={styles.row}>Status: {item.status}</Text>
              <View style={styles.actions}>
                <Button
                  title="Approve"
                  onPress={() => approve(item)}
                  disabled={item.status === 'APPROVED'}
                />
                <Button title="Decline" onPress={() => decline(item)} />
              </View>
            </View>
          )}
          ListEmptyComponent={<Text style={{ opacity: 0.7 }}>No invites.</Text>}
          onEndReached={() => nextToken && loadInvites(nextToken)}
          onEndReachedThreshold={0.6}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 18, fontWeight: '600', marginBottom: 12 },
  card: {
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    marginBottom: 10
  },
  row: { fontSize: 14, marginBottom: 6 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 6 }
});
