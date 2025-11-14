import React, { useEffect, useState } from 'react';
import { View, Text, Button, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { signIn, getCurrentUser } from 'aws-amplify/auth';

const USERS = {
  Patient:  { username: 'patient@example.com',  password: 'Password123!' },
  Provider: { username: 'provider@example.com', password: 'Password123!' },
  Advocate: { username: 'advocate@example.com', password: 'Password123!' },
};

export default function AuthScreen({ navigation }) {
  const [checking, setChecking] = useState(true);

  // Temp fix. Route based on button, not user record from dynamoDB
  const routeByUserType = (userType) => {
    if (userType === 'Provider') {
      navigation.replace('ProviderHome');
    } else {
      navigation.replace('Home');
    }
  };

  useEffect(() => {
    (async () => {
      try {
        await getCurrentUser();
        navigation.replace('Home');
      } catch {
      } finally {
        setChecking(false);
      }
    })();
  }, [navigation]);

  const handleLogin = async (userType) => {
    const { username, password } = USERS[userType];

    try {
      await signIn({ username, password });
      routeByUserType(userType);
    } catch (error) {
      console.error('Login error:', error);
      Alert.alert('Login failed', error?.message || 'Unknown error');
    }
  };

  if (checking) {
    return (
      <View style={[styles.container, { alignItems: 'center' }]}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Checking session…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Select a Role to Login</Text>
      {Object.keys(USERS).map((role) => (
        <Button key={role} title={role} onPress={() => handleLogin(role)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', gap: 12, padding: 20 },
  title: { fontSize: 18, marginBottom: 20, textAlign: 'center' },
});
