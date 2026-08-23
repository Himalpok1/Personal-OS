import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/**
 * The height of the on-screen keyboard, or 0 when it is closed.
 *
 * Android does NOT reliably resize this app's window for the IME, despite the
 * manifest's `adjustResize` -- measured on the physical Rabbit R1 during
 * Checkpoint 5.6, the app window stayed the full 480x640 while the IME window
 * declared `touchableRegion=(0,238,480,640)`. Everything below y=238 was
 * therefore not merely hidden but *unreachable*: the IME swallows the touch, so
 * `keyboardShouldPersistTaps` cannot help (the tap never reaches the
 * ScrollView), and scrolling could not lift a control above the keyboard
 * because the scroll view still believed it had the full height. On the Daily
 * Review that made "Complete review" and "Skip today" impossible to tap while
 * the summary field was focused.
 *
 * Padding a scroll container by this height gives it real room to scroll the
 * lower controls up into the still-visible strip. This is the same technique
 * quick-add-fab.tsx has used since Checkpoint 5 (where the cause was a Modal
 * getting its own window rather than insets); extracted here so the review
 * screens and forms can reuse it instead of re-deriving it.
 *
 * Inert on web, where these events never fire.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (event) => {
      setHeight(event.endCoordinates.height);
    });
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}
