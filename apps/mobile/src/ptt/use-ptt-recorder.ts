import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useCallback, useRef, useState } from "react";
import { api } from "@/queries/client";

// Touch-based tap-to-start/tap-to-stop is the primary interaction (per the
// Phase 3 plan's explicit exclusion of any side-button dependency) -- this
// hook has no knowledge of hardware input at all, matching the
// hardware-input isolation rule established in Checkpoint 3.
export type PttStatus = "idle" | "recording" | "uploading" | "transcribing" | "done" | "failed";

interface PttState {
  status: PttStatus;
  error: string | null;
}

// Bounds how long we'll poll GET /inbox/:id waiting for the ptt.transcribe
// job to fill in raw_text before giving up and surfacing a failure -- the
// capture itself is never lost (it's already committed server-side), this
// only bounds how long the UI keeps showing "Transcribing...".
const TRANSCRIBING_POLL_MS = 1500;
const TRANSCRIBING_TIMEOUT_MS = 60_000;

export function usePttRecorder() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [state, setState] = useState<PttState>({ status: "idle", error: null });
  // One client_uuid per recording attempt, generated at record-start and
  // held for the life of that attempt -- matches quick-add-fab's pattern
  // and is what makes a retried upload of the same recording idempotent
  // server-side (POST /transcribe dedupes on client_uuid).
  const clientUuidRef = useRef<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollDeadline = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const startRecording = useCallback(async () => {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setState({ status: "failed", error: "Microphone permission was not granted." });
      return;
    }
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    clientUuidRef.current = crypto.randomUUID();
    await recorder.prepareToRecordAsync();
    recorder.record();
    setState({ status: "recording", error: null });
  }, [recorder]);

  const pollTranscription = useCallback(
    (inboxId: string) => {
      pollDeadline.current = Date.now() + TRANSCRIBING_TIMEOUT_MS;
      pollTimer.current = setInterval(() => {
        api
          .getInboxItem(inboxId)
          .then((item) => {
            if (item.raw_text !== null) {
              stopPolling();
              setState({ status: "done", error: null });
              setTimeout(() => setState({ status: "idle", error: null }), 1500);
              return;
            }
            if (item.status === "failed") {
              stopPolling();
              setState({ status: "failed", error: "Transcription failed." });
              return;
            }
            if (Date.now() > pollDeadline.current) {
              stopPolling();
              setState({
                status: "failed",
                error: "Transcription is taking longer than expected.",
              });
            }
          })
          .catch(() => {
            // Transient poll failure -- the inbox row and its audio are
            // already safely committed server-side, so we just keep
            // polling until TRANSCRIBING_TIMEOUT_MS.
          });
      }, TRANSCRIBING_POLL_MS);
    },
    [stopPolling],
  );

  const stopRecording = useCallback(async () => {
    if (state.status !== "recording") return;
    await recorder.stop();
    const uri = recorder.uri;
    const clientUuid = clientUuidRef.current;
    if (!uri || !clientUuid) {
      setState({ status: "failed", error: "No recording was captured." });
      return;
    }
    setState({ status: "uploading", error: null });
    try {
      const { inbox_id } = await api.transcribe(
        { uri, name: "ptt.m4a", type: "audio/m4a" },
        {
          client_uuid: clientUuid,
          captured_at: new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      );
      setState({ status: "transcribing", error: null });
      pollTranscription(inbox_id);
    } catch {
      setState({ status: "failed", error: "Upload failed -- check your connection." });
    }
  }, [recorder, state.status, pollTranscription]);

  const dismiss = useCallback(() => {
    stopPolling();
    setState({ status: "idle", error: null });
  }, [stopPolling]);

  return {
    status: state.status,
    error: state.error,
    durationMillis: recorderState.durationMillis,
    startRecording,
    stopRecording,
    dismiss,
  };
}
