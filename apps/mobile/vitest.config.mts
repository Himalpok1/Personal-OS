import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "react-native": "react-native-web",
      "expo-router": path.resolve(import.meta.dirname, "./src/__mocks__/expo-router.ts"),
      nativewind: path.resolve(import.meta.dirname, "./src/__mocks__/nativewind.ts"),
      "@expo/ui/jetpack-compose": path.resolve(
        import.meta.dirname,
        "./src/__mocks__/expo-ui-jetpack-compose.ts",
      ),
      "expo-crypto": path.resolve(import.meta.dirname, "./src/__mocks__/expo-crypto.ts"),
      // Checkpoint 10.3 design-system dependencies: each reaches a native
      // module registry at import, so each is mocked the way expo-router is.
      "expo-linear-gradient": path.resolve(
        import.meta.dirname,
        "./src/__mocks__/expo-linear-gradient.ts",
      ),
      "expo-haptics": path.resolve(import.meta.dirname, "./src/__mocks__/expo-haptics.ts"),
      "react-native-safe-area-context": path.resolve(
        import.meta.dirname,
        "./src/__mocks__/react-native-safe-area-context.ts",
      ),
      "@expo/vector-icons": path.resolve(
        import.meta.dirname,
        "./src/__mocks__/expo-vector-icons.ts",
      ),
      // Checkpoint 10.6 motion and gesture dependencies. The subpath alias
      // comes BEFORE the package alias: aliases match as prefixes in order,
      // so the package entry alone would rewrite the subpath to a path inside
      // the mock file.
      "react-native-gesture-handler/ReanimatedSwipeable": path.resolve(
        import.meta.dirname,
        "./src/__mocks__/react-native-gesture-handler.ts",
      ),
      "react-native-gesture-handler": path.resolve(
        import.meta.dirname,
        "./src/__mocks__/react-native-gesture-handler.ts",
      ),
      "react-native-reanimated": path.resolve(
        import.meta.dirname,
        "./src/__mocks__/react-native-reanimated.ts",
      ),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules/**", "dist/**", "modules/**"],
  },
});
