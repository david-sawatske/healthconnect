import React, { useEffect } from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';
import { signOut, getCurrentUser } from 'aws-amplify/auth'; // ✅ v6 imports

export default function HomeScreen({ navigation }) {
    useEffect(() => {
        (async () => {
            try {
                const user = await getCurrentUser();
                console.log('Logged in as:', user.username);
            } catch {
                navigation.replace('Auth');
            }
        })();
    }, [navigation]);

    const handleSignOut = async () => {
        await signOut();
        navigation.replace('Auth');
    };

    return (
        <View style={styles.container}>
            <Text>Welcome! You are signed in.</Text>
            <Button title="Sign Out" onPress={handleSignOut} />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, justifyContent: 'center', gap: 20, alignItems: 'center' },
});
