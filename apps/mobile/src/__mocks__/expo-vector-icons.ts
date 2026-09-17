// @expo/vector-icons loads its icon fonts through expo-font's native module
// at import time. Under vitest an icon is a Text carrying its `name`, so a
// tree-walking test can still assert which glyph a row chose. The `glyphMap`
// is typed loosely: the real one is a generated 7,000-key object and the
// tests never enumerate it. Aliased in vitest.config.mts.
import { createElement } from "react";
import { Text } from "react-native";

function makeIconSet(family: string) {
  const Component = (props: Record<string, unknown>) =>
    createElement(
      Text,
      { ...props, testID: `icon:${family}:${String(props["name"] ?? "")}` } as Record<
        string,
        unknown
      >,
      String(props["name"] ?? ""),
    );
  (Component as unknown as { glyphMap: Record<string, number> }).glyphMap = {};
  return Component;
}

export const MaterialCommunityIcons = makeIconSet("MaterialCommunityIcons");
export const MaterialIcons = makeIconSet("MaterialIcons");
export const Ionicons = makeIconSet("Ionicons");
