// Vitest stand-in for `@expo/ui/jetpack-compose` (Checkpoint 9.5), aliased in
// vitest.config.ts the same way expo-router and nativewind are. The real
// module is Android-only Jetpack Compose and throws at import under the
// vitest transform (`addCustomSourceTransformer` of undefined), which kept
// every screen that mounts a DateTimeField/DateField out of the tests. The
// dialogs render nothing here; the components' own logic is in the pure
// `*-field-state.ts` modules, which are what the tests exercise.
export function Host(): null {
  return null;
}
export function DatePickerDialog(): null {
  return null;
}
export function TimePickerDialog(): null {
  return null;
}
