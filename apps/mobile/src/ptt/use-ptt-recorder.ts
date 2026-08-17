import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { randomUUID } from "expo-crypto";
import { File } from "expo-file-system";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { api } from "@/queries/client";

export type PttStatus =
  | "idle"
  | "preparing"
  | "recording"
  | "stopping"
  | "uploading"
  | "transcribing"
  | "done"
  | "failed";

interface PttState {
  status: PttStatus;
  error: string | null;
  canRetry: boolean;
}

interface UploadAttempt {
  uri: string;
  clientUuid: string;
  capturedAt: string;
}

const TRANSCRIBING_POLL_MS = 1500;
const TRANSCRIBING_TIMEOUT_MS = 60_000;
const MAX_RECORDING_MS = 2 * 60_000;

export function usePttRecorder() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [state, setState] = useState<PttState>({
    status: "idle",
    error: null,
    canRetry: false,
  });
  const stateRef = useRef(state);
  const mountedRef = useRef(true);
  const uploadAttemptRef = useRef<UploadAttempt | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollGeneration = useRef(0);

  const updateState = useCallback((next: PttState) => {
    stateRef.current = next;
    if (mountedRef.current) setState(next);
  }, []);

  const stopPolling = useCallback(() => {
    pollGeneration.current += 1;
    if (pollTimer.current !== null) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const clearDoneTimer = useCallback(() => {
    if (doneTimer.current !== null) {
      clearTimeout(doneTimer.current);
      doneTimer.current = null;
    }
  }, []);

  const pollTranscription = useCallback(
    (inboxId: string) => {
      stopPolling();
      const generation = pollGeneration.current;
      const deadline = Date.now() + TRANSCRIBING_TIMEOUT_MS;

      const failIfTimedOut = (): boolean => {
        if (Date.now() <= deadline) return false;
        stopPolling();
        updateState({
          status: "failed",
          error: "Transcription is taking longer than expected.",
          canRetry: false,
        });
        return true;
      };

      const poll = async () => {
        if (!mountedRef.current || generation !== pollGeneration.current || failIfTimedOut()) {
          return;
        }
        try {
          const item = await api.getInboxItem(inboxId);
          if (!mountedRef.current || generation !== pollGeneration.current) return;
          if (item.raw_text !== null) {
            stopPolling();
            uploadAttemptRef.current = null;
            updateState({ status: "done", error: null, canRetry: false });
            clearDoneTimer();
            doneTimer.current = setTimeout(() => {
              updateState({ status: "idle", error: null, canRetry: false });
            }, 1500);
            return;
          }
          if (item.status === "failed") {
            stopPolling();
            uploadAttemptRef.current = null;
            updateState({
              status: "failed",
              error: "Transcription failed.",
              canRetry: false,
            });
            return;
          }
        } catch {
          // The row is already durable on the server. Keep trying until
          // the same wall-clock deadline, including during network errors.
        }
        if (failIfTimedOut()) return;
        pollTimer.current = setTimeout(poll, TRANSCRIBING_POLL_MS);
      };

      pollTimer.current = setTimeout(poll, 0);
    },
    [clearDoneTimer, stopPolling, updateState],
  );

  const uploadRecording = useCallback(
    async (attempt: UploadAttempt) => {
      updateState({ status: "uploading", error: null, canRetry: false });
      try {
        const { inbox_id } = await api.transcribe(new File(attempt.uri), {
            client_uuid: attempt.clientUuid,
            captured_at: attempt.capturedAt,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        if (!mountedRef.current) return;
        updateState({ status: "transcribing", error: null, canRetry: false });
        pollTranscription(inbox_id);
      } catch (error) {
        console.warn("PTT upload failed", error);
        updateState({
          status: "failed",
          error: "Upload failed — check your connection.",
          canRetry: true,
        });
      }
    },
    [pollTranscription, updateState],
  );

  const startRecording = useCallback(async () => {
    if (stateRef.current.status !== "idle" && stateRef.current.status !== "done") return;
    clearDoneTimer();
    stopPolling();
    uploadAttemptRef.current = null;
    updateState({ status: "preparing", error: null, canRetry: false });
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        updateState({
          status: "failed",
          error: "Microphone permission was not granted.",
          canRetry: false,
        });
        return;
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      const attempt: UploadAttempt = {
        uri: "",
        clientUuid: randomUUID(),
        capturedAt: new Date().toISOString(),
      };
      uploadAttemptRef.current = attempt;
      await recorder.prepareToRecordAsync();
      recorder.record();
      updateState({ status: "recording", error: null, canRetry: false });
    } catch (error) {
      updateState({
        status: "failed",
        error: error instanceof Error ? error.message : "Could not start recording.",
        canRetry: false,
      });
    }
  }, [clearDoneTimer, recorder, stopPolling, updateState]);

  const stopRecording = useCallback(async () => {
    if (stateRef.current.status !== "recording") return;
    updateState({ status: "stopping", error: null, canRetry: false });
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      const uri = recorder.uri;
      const attempt = uploadAttemptRef.current;
      if (!uri || !attempt) {
        updateState({ status: "failed", error: "No recording was captured.", canRetry: false });
        return;
      }
      const completedAttempt = { ...attempt, uri };
      uploadAttemptRef.current = completedAttempt;
      await uploadRecording(completedAttempt);
    } catch (error) {
      updateState({
        status: "failed",
        error: error instanceof Error ? error.message : "Could not stop recording.",
        canRetry: false,
      });
    }
  }, [recorder, updateState, uploadRecording]);

  const retryUpload = useCallback(async () => {
    if (stateRef.current.status !== "failed" || !stateRef.current.canRetry) return;
    const attempt = uploadAttemptRef.current;
    if (attempt) await uploadRecording(attempt);
  }, [uploadRecording]);

  const dismiss = useCallback(() => {
    stopPolling();
    clearDoneTimer();
    uploadAttemptRef.current = null;
    updateState({ status: "idle", error: null, canRetry: false });
  }, [clearDoneTimer, stopPolling, updateState]);

  useEffect(() => {
    if (state.status === "recording" && recorderState.durationMillis >= MAX_RECORDING_MS) {
      void stopRecording();
    }
  }, [recorderState.durationMillis, state.status, stopRecording]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (appState) => {
      if (appState !== "active" && stateRef.current.status === "recording") {
        void stopRecording();
      }
    });
    return () => subscription.remove();
  }, [stopRecording]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      stopPolling();
      clearDoneTimer();
      if (stateRef.current.status === "recording") {
        void recorder.stop().catch(() => undefined);
      }
      void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    },
    [clearDoneTimer, recorder, stopPolling],
  );

  return {
    status: state.status,
    error: state.error,
    canRetry: state.canRetry,
    durationMillis: recorderState.durationMillis,
    startRecording,
    stopRecording,
    retryUpload,
    dismiss,
  };
}
