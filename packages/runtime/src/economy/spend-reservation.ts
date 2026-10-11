/**
 * Beyonder Compute Economy — Spend Reservation Lifecycle
 *
 * Defines the reservation data structures, states, transitions, and errors.
 * Every billable inference request requires an atomic reservation before execution.
 *
 * @see docs/adr/001-reservation-before-paid-inference.md
 */

import type { Microdollars } from "./money.js";

export type ReservationState =
  | "RESERVED"
  | "REQUEST_SENT"
  | "SETTLED"
  | "RELEASED"
  | "UNKNOWN_OUTCOME";

export interface SpendReservation {
  id: string;
  budgetAccountId: string;
  scopeHierarchy: string[];
  taskId?: string;
  phase?: string;
  provider: string;
  model: string;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  worstCaseMicros: Microdollars;
  actualCostMicros?: Microdollars;
  pricingSnapshotId?: string;
  state: ReservationState;
  idempotencyKey: string;
  providerRequestId?: string;
  createdAt: string;
  sentAt?: string;
  settledAt?: string;
  error?: string;
}

export interface ReservationParams {
  budgetAccountId?: string;
  objectiveId: string;
  taskId?: string;
  phase?: "producer" | "verifier" | "recovery" | "adjudication";
  provider: string;
  model: string;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  worstCaseMicros: Microdollars;
  pricingSnapshotId?: string;
  idempotencyKey: string;
}

export interface SettlementParams {
  reservationId: string;
  actualCostMicros: Microdollars;
  actualInputTokens?: number;
  actualOutputTokens?: number;
  providerReportedCostUsd?: number;
  providerRequestId?: string;
}

export class ReservationError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "ReservationError";
  }
}

export class BudgetExhaustedError extends ReservationError {
  constructor(message: string, public readonly accountId: string, public readonly availableMicros: Microdollars) {
    super(message, "BUDGET_EXHAUSTED");
    this.name = "BudgetExhaustedError";
  }
}

export class DuplicateReservationError extends ReservationError {
  constructor(public readonly idempotencyKey: string) {
    super(`Reservation with idempotency key '${idempotencyKey}' already exists`, "DUPLICATE_RESERVATION");
    this.name = "DuplicateReservationError";
  }
}

export class InvalidReservationTransitionError extends ReservationError {
  constructor(from: ReservationState, to: ReservationState) {
    super(`Cannot transition reservation from '${from}' to '${to}'`, "INVALID_TRANSITION");
    this.name = "InvalidReservationTransitionError";
  }
}

const VALID_TRANSITIONS: Record<ReservationState, readonly ReservationState[]> = {
  RESERVED: ["REQUEST_SENT", "RELEASED"],
  REQUEST_SENT: ["SETTLED", "UNKNOWN_OUTCOME", "RELEASED"],
  UNKNOWN_OUTCOME: ["SETTLED", "RELEASED"],
  SETTLED: [],
  RELEASED: []
};

export function canTransitionReservation(from: ReservationState, to: ReservationState): boolean {
  return (VALID_TRANSITIONS[from] as readonly ReservationState[] | undefined)?.includes(to) ?? false;
}

export function assertReservationTransition(from: ReservationState, to: ReservationState): void {
  if (!canTransitionReservation(from, to)) {
    throw new InvalidReservationTransitionError(from, to);
  }
}
