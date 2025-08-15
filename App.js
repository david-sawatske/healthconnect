import 'react-native-gesture-handler';
import 'react-native-reanimated';
import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';

import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Amplify } from 'aws-amplify';
import amplifyConfig from './src/amplifyconfiguration.json';

import AuthScreen from './src/screens/AuthScreen';
import HomeScreen from './src/screens/HomeScreen';

Amplify.configure(amplifyConfig);

const Stack = createNativeStackNavigator();

export default function App() {
    return (
        <NavigationContainer>
            <Stack.Navigator initialRouteName="Auth">
                <Stack.Screen name="Auth" component={AuthScreen} />
                <Stack.Screen name="Home" component={HomeScreen} />
            </Stack.Navigator>
            <StatusBar style="auto" />
        </NavigationContainer>
    );
}
