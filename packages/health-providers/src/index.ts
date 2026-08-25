export {
  ACTIVITY_SCOPE,
  DATA_SOURCE_FAMILY_ALL,
  DATA_SOURCE_FAMILY_GOOGLE,
  DATA_SOURCE_FAMILY_WEARABLES,
  getHealthMetric,
  HEALTH_METRIC_CATALOG,
  HEALTH_METRICS,
  METRICS_SCOPE,
  metricsForGrantedScopes,
  PHASE_6A_SCOPES,
  SLEEP_SCOPE,
  type HealthAcquisitionMode,
  type HealthApiMethod,
  type HealthMetricDefinition,
  type HealthScope,
  type RangeCapSource,
} from "./google-health-catalog.js";

export {
  buildAuthorizeUrl,
  exchangeHealthAuthCode,
  GoogleHealthOAuthError,
  refreshHealthAccessToken,
  revokeHealthToken,
  type BuildAuthorizeUrlParams,
  type ExchangedHealthTokens,
  type ExchangeHealthAuthCodeParams,
  type FetchLike,
  type GoogleHealthOAuthCredentials,
  type RefreshedHealthTokens,
  type RefreshHealthTokenParams,
} from "./google-health-oauth.js";

export {
  createGoogleHealthClient,
  GoogleHealthApiError,
  HEALTH_API_BASE,
  type ApiCivilDateTime,
  type ApiCivilTimeInterval,
  type ApiDailyRollupDataPoint,
  type ApiDataPoint,
  type DailyRollUpRequest,
  type DailyRollUpResponse,
  type DataPointPage,
  type GoogleHealthClient,
  type GoogleHealthIdentity,
  type ListRequest,
  type ReconcileRequest,
} from "./google-health-client.js";

export {
  civil,
  createFakeGoogleHealthClient,
  rollupBucket,
  samplePoint,
  type FakeCall,
  type FakeGoogleHealthClient,
  type FakeGoogleHealthOptions,
} from "./google-health-client.fake.js";

export {
  contentHash,
  listedHeartRateKey,
  reconciledHeartRateKey,
  sessionKey,
  type ExternalKey,
  type ExternalKeySource,
  type HeartRateIdentityInput,
  type SessionIdentityInput,
} from "./identity.js";

// ---------------------------------------------------------------------------
// Sync core (Phase 6 Checkpoint 6.3)
// ---------------------------------------------------------------------------

export {
  classifyCapability,
  sanitizeApiError,
  type CapabilityInput,
  type CapabilityVerdict,
  type HealthCapability,
  type ProviderFault,
} from "./sync/capability.js";

export {
  createHealthLimiter,
  fullJitterDelayMs,
  DEFAULT_LIMITER_OPTIONS,
  HealthPassBudgetExhaustedError,
  type HealthLimiter,
  type LimiterDeps,
  type LimiterOptions,
  type LimiterStats,
} from "./sync/limiter.js";
