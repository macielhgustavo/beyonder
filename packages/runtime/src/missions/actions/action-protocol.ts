/**
 * External action protocol — Intent and Receipt (ADR 0009).
 *
 * Irreversible side effects follow: PREPARE → VALIDATE → APPROVE → COMMIT
 * → RECEIPT → VERIFY. UNKNOWN_OUTCOME is a first-class state requiring
 * reconciliation before retry.
 */
export const ACTION_INTENT_SCHEMA_VERSION = 1;

export type ActionSideEffectLevel = "READ" | "WRITE" | "EXTERNAL_ACTION" | "FINANCIAL" | "SYSTEM";

export interface ActionIntent {
  schemaVersion: number;
  id: string;
  missionId: string;
  nodeId: string;
  what: string;
  why: string;
  target: string;
  parameters: Record<string, unknown>;
  idempotencyKey: string;
  risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  sideEffectLevel: ActionSideEffectLevel;
  requiresApproval: boolean;
  approvalActionType?: string;
  createdAt: string;
  /** Time limit to commit; after expiry the intent must be recreated. */
  expiresAt?: string;
}

export type ActionReceiptState = "COMMITTED" | "UNKNOWN_OUTCOME" | "RECONCILED" | "COMPENSATED" | "FAILED";

export interface ActionReceipt {
  schemaVersion: number;
  id: string;
  actionIntentId: string;
  provider: string;
  externalId?: string;
  result?: unknown;
  observedEffect?: string;
  state: ActionReceiptState;
  committedAt: string;
  reconciledAt?: string;
  error?: string;
}

export interface ActionStore {
  saveIntent(intent: ActionIntent): Promise<void>;
  getIntent(intentId: string): Promise<ActionIntent | undefined>;
  listIntentsByMission(missionId: string): Promise<ActionIntent[]>;
  saveReceipt(receipt: ActionReceipt): Promise<void>;
  getReceipt(receiptId: string): Promise<ActionReceipt | undefined>;
  listReceiptsByIntent(actionIntentId: string): Promise<ActionReceipt[]>;
}