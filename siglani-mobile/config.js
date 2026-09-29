import Constants from 'expo-constants';

// Extracts host IP automatically when running in Expo Go
const hostUri = Constants.expoConfig?.hostUri || Constants.manifest2?.extra?.expoGo?.debuggerHost;
const autoDetectedIp = hostUri ? hostUri.split(':')[0] : 'localhost';

// Falls back to auto-detected IP on port 5001
export const BASE_URL = `http://${autoDetectedIp}:5001`;

console.log('[SiglaAni] Active Backend URL:', BASE_URL);