import { withMainActivity, type ConfigPlugin } from "@expo/config-plugins";

// Bridges two Rabbit R1 hardware inputs into React Native's DeviceEventEmitter
// at the native Activity level -- the only place either can be observed at
// all, since Android delivers raw key events to Activity.dispatchKeyEvent
// before any JS code runs.
//
//  - The scroll wheel, which the kernel reports as KEYCODE_DPAD_UP/DOWN
//    (confirmed via direct `adb getevent` inspection against the actual
//    Rabbit R1 unit during Phase 3 planning). Consumed here as
//    "HardwareScrollWheelEvent" -- coalescing a physical rotation's burst of
//    8-12 raw events into one logical scroll step is a JS-side concern (see
//    src/hardware-input/scroll-wheel.ts), not this bridge's job.
//  - The side PTT/power button, which reports as KEYCODE_POWER. Forwarded
//    as "HardwareSideButtonEvent" purely to empirically determine whether
//    Android's app-level dispatchKeyEvent path ever receives it at all --
//    see the Phase 3 plan's KEY_POWER spike. This event may simply never
//    fire in practice (KEY_POWER is conventionally intercepted by the
//    system's PhoneWindowManager before reaching any app) -- the PTT design
//    does not depend on it firing.
//
// A no-op on every other Android device: these exact key codes only arrive
// from this specific hardware, so normal phones remain fully unaffected --
// dispatchKeyEvent still calls through to super() unconditionally.
const IMPORTS = [
  "import android.view.KeyEvent",
  "import com.facebook.react.bridge.Arguments",
  "import com.facebook.react.modules.core.DeviceEventManagerModule",
].join("\n");

const DISPATCH_OVERRIDE = `
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    val emitter = reactHost?.currentReactContext
      ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)

    if (event.action == KeyEvent.ACTION_DOWN) {
      val direction = when (event.keyCode) {
        KeyEvent.KEYCODE_DPAD_UP -> "up"
        KeyEvent.KEYCODE_DPAD_DOWN -> "down"
        else -> null
      }
      if (direction != null) {
        val params = Arguments.createMap()
        params.putString("direction", direction)
        params.putDouble("timestamp", event.eventTime.toDouble())
        emitter?.emit("HardwareScrollWheelEvent", params)
      }
    }

    if (event.keyCode == KeyEvent.KEYCODE_POWER) {
      val params = Arguments.createMap()
      params.putString("action", if (event.action == KeyEvent.ACTION_DOWN) "down" else "up")
      params.putDouble("timestamp", event.eventTime.toDouble())
      emitter?.emit("HardwareSideButtonEvent", params)
    }

    return super.dispatchKeyEvent(event)
  }
`;

export const withHardwareInputBridge: ConfigPlugin = (config) => {
  return withMainActivity(config, (config) => {
    if (config.modResults.language !== "kt") {
      throw new Error("withHardwareInputBridge only supports a Kotlin MainActivity");
    }

    let contents = config.modResults.contents;
    if (contents.includes("HardwareScrollWheelEvent")) {
      config.modResults.contents = contents;
      return config;
    }

    const lastImportIndex = contents.lastIndexOf("\nimport ");
    const importLineEnd = contents.indexOf("\n", lastImportIndex + 1);
    contents =
      contents.slice(0, importLineEnd + 1) +
      IMPORTS +
      "\n" +
      contents.slice(importLineEnd + 1);

    const lastBrace = contents.lastIndexOf("}");
    contents = contents.slice(0, lastBrace) + DISPATCH_OVERRIDE + "\n" + contents.slice(lastBrace);

    config.modResults.contents = contents;
    return config;
  });
};

export default withHardwareInputBridge;
