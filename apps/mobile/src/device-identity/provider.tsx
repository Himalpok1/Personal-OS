import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { setDeviceIdentityPaired } from "./paired-state";
import {
  clearDeviceCredentials,
  getStoredDeviceCredentials,
  storeDeviceCredentials,
  type StoredDeviceCredentials,
} from "./storage";

interface DeviceIdentityContextValue {
  identity: StoredDeviceCredentials | null;
  isLoading: boolean;
  setIdentity: (credentials: StoredDeviceCredentials) => Promise<void>;
  clearIdentity: () => Promise<void>;
}

const DeviceIdentityContext = createContext<DeviceIdentityContextValue | null>(null);

// The whole-app gate: apps/mobile/src/app/_layout.tsx renders the pairing
// screen instead of the main tab navigator whenever `identity` is null.
// Loads once from SecureStore on mount (isLoading covers that single
// read); every mutation after that updates both SecureStore and this
// in-memory value together, so query hooks reading `identity.token` never
// have to re-read storage themselves.
export function DeviceIdentityProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentityState] = useState<StoredDeviceCredentials | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Keeps paired-state.ts's module-level snapshot in lockstep -- see that
  // file's header comment for the one call site that needs it.
  useEffect(() => {
    setDeviceIdentityPaired(identity !== null);
  }, [identity]);

  useEffect(() => {
    let cancelled = false;
    getStoredDeviceCredentials()
      .then((stored) => {
        if (cancelled) return;
        setIdentityState(stored);
      })
      .catch((error: unknown) => {
        console.warn("Failed to load device credentials", error);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setIdentity = async (credentials: StoredDeviceCredentials) => {
    await storeDeviceCredentials(credentials);
    setIdentityState(credentials);
  };

  const clearIdentity = async () => {
    await clearDeviceCredentials();
    setIdentityState(null);
  };

  return (
    <DeviceIdentityContext.Provider value={{ identity, isLoading, setIdentity, clearIdentity }}>
      {children}
    </DeviceIdentityContext.Provider>
  );
}

export function useDeviceIdentity(): DeviceIdentityContextValue {
  const ctx = useContext(DeviceIdentityContext);
  if (!ctx) throw new Error("useDeviceIdentity must be used within DeviceIdentityProvider");
  return ctx;
}
