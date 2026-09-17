export const useRouter = () => ({
  push: () => {},
  replace: () => {},
  back: () => {},
  setParams: () => {},
});

export const useLocalSearchParams = () => ({});
export const useGlobalSearchParams = () => ({});
export const useSegments = () => [];
export const usePathname = () => "";

// Checkpoint 10.3: navigation-theme.ts builds the app theme from these.
// Shapes mirror react-navigation's, values are irrelevant to any test.
const baseColors = {
  primary: "#000",
  background: "#fff",
  card: "#fff",
  text: "#000",
  border: "#ccc",
  notification: "#f00",
};
export const DefaultTheme = { dark: false, colors: baseColors, fonts: {} };
export const DarkTheme = { dark: true, colors: baseColors, fonts: {} };
export const ThemeProvider = ({ children }: { children?: unknown }) => children;
