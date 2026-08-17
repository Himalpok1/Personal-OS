export {
  AI_PROVIDER_TYPES,
  buildLanguageModel,
  type AdapterConfig,
  type AiProviderType,
} from "./adapter-registry.js";
export { decryptSecret, encryptSecret, type EncryptedSecret } from "./credential-crypto.js";
export {
  loadModelForConnection,
  NoProviderConfiguredError,
  resolveModelForTask,
  type ResolvedModel,
} from "./resolve-model.js";
export { callWithFallback } from "./call-with-fallback.js";
export {
  transcribeAudio,
  type TranscriptionAudio,
  type TranscriptionConnection,
  type TranscriptionResult,
} from "./transcription-client.js";
export {
  resolveTranscriptionConnectionForTask,
  type ResolvedTranscriptionConnection,
} from "./resolve-transcription-connection.js";
