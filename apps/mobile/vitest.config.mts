import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "react-native": "react-native-web",
      "expo-router": path.resolve(import.meta.dirname, "./src/__mocks__/expo-router.ts"),
      nativewind: path.resolve(import.meta.dirname, "./src/__mocks__/nativewind.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules/**", "dist/**", "modules/**"],
  },
});
