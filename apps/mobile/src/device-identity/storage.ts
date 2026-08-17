import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "personal_os_device_token";
const DEVICE_ID_KEY = "personal_os_device_id";

export interface StoredDeviceCredentials {
  token: string;
  deviceId: string;
}

// expo-secure-store: iOS Keychain, Android Keystore-backed encrypted
// SharedPreferences -- the device's bearer token never touches plain
// storage. This is the only place this app persists it; every API call
// reads it fresh from the in-memory provider (see provider.tsx), not from
// SecureStore directly on every request.
export async function getStoredDeviceCredentials(): Promise<StoredDeviceCredentials | null> {
  const [token, deviceId] = await Promise.all([
    SecureStore.getItemAsync(TOKEN_KEY),
    SecureStore.getItemAsync(DEVICE_ID_KEY),
  ]);
  if (!token || !deviceId) return null;
  return { token, deviceId };
}

export async function storeDeviceCredentials(credentials: StoredDeviceCredentials): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(TOKEN_KEY, credentials.token),
    SecureStore.setItemAsync(DEVICE_ID_KEY, credentials.deviceId),
  ]);
}

export async function clearDeviceCredentials(): Promise<void> {
  await Promise.all([SecureStore.deleteItemAsync(TOKEN_KEY), SecureStore.deleteItemAsync(DEVICE_ID_KEY)]);
}
