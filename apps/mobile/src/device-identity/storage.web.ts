const TOKEN_KEY = "personal_os_device_token";
const DEVICE_ID_KEY = "personal_os_device_id";

export interface StoredDeviceCredentials {
  token: string;
  deviceId: string;
}

// Browsers have no SecureStore equivalent. The web client remains behind
// Tailscale and uses origin-scoped localStorage, while native credentials
// continue to use the platform keystore/keychain implementation.
export async function getStoredDeviceCredentials(): Promise<StoredDeviceCredentials | null> {
  if (typeof localStorage === "undefined") return null;
  const token = localStorage.getItem(TOKEN_KEY);
  const deviceId = localStorage.getItem(DEVICE_ID_KEY);
  return token && deviceId ? { token, deviceId } : null;
}

export async function storeDeviceCredentials(
  credentials: StoredDeviceCredentials,
): Promise<void> {
  localStorage.setItem(TOKEN_KEY, credentials.token);
  localStorage.setItem(DEVICE_ID_KEY, credentials.deviceId);
}

export async function clearDeviceCredentials(): Promise<void> {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(DEVICE_ID_KEY);
}
