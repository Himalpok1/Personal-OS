export const UI_TEST_MODE = process.env.EXPO_PUBLIC_UI_TEST_MODE === "true";

function isPrivateDevelopmentHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;

  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return false;

  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

export function assertUiTestApiIsolation(apiUrl: string): void {
  if (!UI_TEST_MODE) return;

  let hostname: string;
  try {
    hostname = new URL(apiUrl).hostname;
  } catch {
    throw new Error("UI test mode requires an explicit valid development API URL");
  }

  if (!isPrivateDevelopmentHost(hostname)) {
    throw new Error("UI test mode requires a loopback or private-network development API");
  }
}
