import React, { useEffect, useState } from 'react';
import { View, Text, Button, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { signOut, getCurrentUser, fetchUserAttributes } from 'aws-amplify/auth';
import { generateClient } from 'aws-amplify/api';

const client = generateClient();

const GetUser = `
    query GetUser($id: ID!) {
        getUser(id: $id) {
            id
            email
            displayName
            role
        }
    }
`;

const inferRole = (login = '') => {
    const v = String(login).toLowerCase();
    if (v.includes('patient')) return 'PATIENT';
    if (v.includes('provider')) return 'PROVIDER';
    if (v.includes('advocate')) return 'ADVOCATE';
    return 'USER';
};

export default function HomeScreen({ navigation }) {
    const [loading, setLoading] = useState(true);
    const [displayName, setDisplayName] = useState('');
    const [role, setRole] = useState('');

    useEffect(() => {
        (async () => {
            try {
                const user = await getCurrentUser();
                const sub = user.userId;

                const res = await client.graphql({ query: GetUser, variables: { id: sub } });
                const profile = res?.data?.getUser;

                if (profile) {
                    setDisplayName(profile.displayName || profile.email || user.username);
                    setRole(profile.role || 'USER');
                    return;
                }

                let email = '';
                try {
                    const attrs = await fetchUserAttributes();
                    email = attrs?.email || '';
                } catch {}
                const loginId = user?.signInDetails?.loginId || email || user?.username || '';
                setDisplayName(loginId);
                setRole(inferRole(loginId));
            } catch (err) {
                console.log('Home init error:', err);
                navigation.replace('Auth');
            } finally {
                setLoading(false);
            }
        })();
    }, [navigation]);

    const handleSignOut = async () => {
        try {
            await signOut();
            navigation.replace('Auth');
        } catch (err) {
            console.error('Sign out error:', err);
            Alert.alert('Error', 'Could not sign out. Try again.');
        }
    };

    if (loading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator />
                <Text style={{ marginTop: 8 }}>Loading your profile…</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <Text style={styles.welcome}>
                Welcome{displayName ? `, ${displayName}` : ''}! You are signed in{role ? ` as ${role}` : ''}.
            </Text>

            <View style={{ marginTop: 24 }}>
                <Button title="Sign Out" onPress={handleSignOut} />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, justifyContent: 'center', padding: 20, alignItems: 'center' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    welcome: { fontSize: 18, textAlign: 'center' },
});
