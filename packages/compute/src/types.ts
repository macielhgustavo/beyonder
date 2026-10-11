export type AuthType =
  | "api-key"
  | "bearer"
  | "account-id-and-token"
  | "github-token"
  | "keyless"
  | "custom";

export type AutomationStatus =
  | "automatable"
  | "assisted"
  | "human-step"
  | "manual-only";

export type ProviderClassification =
  | "FULL_AUTO"
  | "AUTO_WITH_HUMAN_GATE"
  | "MANUAL_REQUIRED"
  | "KEYLESS"
  | "UNSUPPORTED"
  | "RETIRED"
  | "PAID_ONLY"
  | "UNREVIEWED";

export type ProviderState =
  | "DISCOVERED"
  | "CREDENTIAL_CHECK"
  | "SIGNUP"
  | "EMAIL_VERIFICATION"
  | "HUMAN_GATE"
  | "DASHBOARD"
  | "KEY_CREATION"
  | "VAULT_STORE"
  | "VALIDATION"
  | "FREELLM_REGISTRATION"
  | "HEALTH_CHECK"
  | "READY"
  | "SKIPPED"
  | "FAILED";

export type HumanGateKind =
  | "CAPTCHA"
  | "CLOUDFLARE_CHALLENGE"
  | "TWO_FACTOR"
  | "SMS_OR_PHONE"
  | "OAUTH_CONSENT"
  | "EMAIL_CONFIRMATION"
  | "KYC"
  | "PAYMENT_METHOD"
  | "TERMS_CONSENT"
  | "UNKNOWN";

export type CredentialStatus =
  | "keyless"
  | "present-env"
  | "present-vault"
  | "missing"
  | "configured-unavailable"
  | "vault-locked"
  | "invalid-credential";

export type ValidationStatus =
  | "not-run"
  | "skipped"
  | "validated"
  | "failed";

export type ModelCapability =
  | "CHAT"
  | "REASONING"
  | "CODING"
  | "EMBEDDING"
  | "RERANK"
  | "VISION"
  | "AUDIO"
  | "OTHER";

export type ModelOperationalStatus =
  | "READY"
  | "AVAILABLE"
  | "RATE_LIMITED"
  | "AUTH_ERROR"
  | "QUOTA_EXHAUSTED"
  | "BILLING_REQUIRED"
  | "INVALID_ENDPOINT"
  | "MODEL_UNAVAILABLE"
  | "UNSUPPORTED"
  | "HUMAN_GATE"
  | "PAID_ONLY"
  | "UNKNOWN";

export interface ModelCatalogEntry {
  contextWindow?: number;
  toolCalling?: "yes" | "no" | "unknown";
  reasoningControl?: boolean;
  costEvidence?: { source: "live-catalog"; observedAt: string; zeroPrice?: boolean; explicitFreeRoute?: boolean };
  role?: "instruct" | "guard" | "embedding" | "reranker" | "classification-only" | "vision-only" | "speech-only" | "unknown";
  structuredOutput?: "native" | "prompted" | "unsupported" | "unknown";
  costClass?: "FREE_CONFIRMED" | "FREE_TIER_ELIGIBLE" | "UNKNOWN_COST" | "PAID";
  id: string;
  capabilities: ModelCapability[];
  status?: ModelOperationalStatus;
  billingRisk?: boolean;
  notes?: string[];
}

export interface CredentialMetadata {
  providerId: string;
  envVar: string;
  createdAt: string;
  updatedAt: string;
  lastValidatedAt?: string;
  validationStatus?: ValidationStatus;
  revokedAt?: string;
}

export interface ProviderCatalogEntry {
  id: string;
  name: string;
  signupUrl: string;
  dashboardUrl?: string;
  apiKeyUrl?: string;
  authType: AuthType;
  credentialEnvVars: string[];
  humanRequirements: string[];
  openAiCompatibleEndpoint?: string;
  knownFreeModels: string[];
  modelCatalog?: ModelCatalogEntry[];
  freeTier: string;
  notes: string[];
  automationStatus: AutomationStatus;
  classification?: ProviderClassification;
  billingRisk?: boolean;
  privacyNote?: string;
  freeTierLimits?: {
    rpm?: number | "unknown";
    rpd?: number | "unknown";
    tpm?: number | "unknown";
    tpd?: number | "unknown";
    contextWindow?: number | "unknown";
    quota?: string;
  };
  onboarding?: {
    preferredAuth?: "google-oauth" | "github-oauth" | "email" | "api-key-page" | "none";
    canAttemptSignup: boolean;
    safeAutopilot: boolean;
    blockers: HumanGateKind[];
  };
  validation?: {
    method: "models" | "cloudflare-models" | "gemini-models" | "keyless-models" | "none";
    url?: string;
    inferenceModel?: string;
  };
}

export interface SecretRecord {
  providerId: string;
  envVar: string;
  value: string;
  source: "env" | "vault";
}

export interface ProviderStatus {
  credential?: import("@beyonder/credentials").CredentialDescriptor;
  provider: ProviderCatalogEntry;
  credentialStatus: CredentialStatus;
  validationStatus: ValidationStatus;
  validationMessage?: string;
  missingEnvVars: string[];
  needsHumanStep: boolean;
}

export interface AutopilotProviderProgress {
  credential?: import("@beyonder/credentials").CredentialDescriptor;
  providerId: string;
  state: ProviderState;
  classification: ProviderClassification;
  attempts: number;
  lastUpdatedAt: string;
  lastError?: string;
  humanGate?: {
    kind: HumanGateKind;
    reason: string;
    action: string;
    url?: string;
  };
  validation?: {
    status: ValidationStatus;
    message?: string;
    latencyMs?: number;
    modelCount?: number;
    models?: string[];
    modelMetadata?: ModelCatalogEntry[];
    rateLimitHeaders?: Record<string, string>;
  };
  freeLlmApi?: {
    status: "not-configured" | "registered" | "skipped" | "failed";
    message?: string;
  };
}

export interface AutopilotStateFile {
  version: 1;
  updatedAt: string;
  providers: Record<string, AutopilotProviderProgress>;
}

export interface ComputeInventoryEntry {
  bootstrapReady?: boolean;
  modelCatalogReady?: boolean;
  inferenceQualified?: boolean;
  verifierQualified?: boolean;
  providerId: string;
  providerName: string;
  status: "healthy" | "keyless" | "missing-credential" | "human-action-required" | "manual-required" | "skipped" | "failed";
  auth: AuthType;
  cost: "$0" | "unknown" | "billing-risk";
  models: string[];
  modelMetadata: ModelCatalogEntry[];
  eligibleChatModels: string[];
  rpm?: number | "unknown";
  tpm?: number | "unknown";
  contextWindow?: number | "unknown";
  toolCalling: "yes" | "no" | "unknown";
  qualityClass: "high" | "medium" | "low" | "unknown";
  latencyMs?: number;
  privacyNote?: string;
  lastCheckedAt?: string;
}
