// The single import point for anything hardware-specific -- screens should
// never check Platform.OS, device model, or reference "Rabbit"/"R1"
// directly. See scroll-wheel.ts's comment for why this is safe to import
// unconditionally on any device: the underlying native event this hook
// listens for is only ever emitted by hardware that actually has the
// corresponding key.
export { useScrollWheel, type ScrollDirection } from "./scroll-wheel";
