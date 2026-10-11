/**
 * Beyonder Compute Economy — Persistent Budget Accountant
 *
 * Implements the hierarchical budget management, atomic spend reservations,
 * settlements, releases, and crash recovery using SQLite transactions.
 *
 * Enforces Invariants I-1, I-2, I-3, I-5, I-8, I-9, I-10.
 *
 * @see docs/v06-compute-economy-architecture.md
 * @see docs/adr/001-reservation-before-paid-inference.md
 * @see docs/adr/002-operator-hard-caps-immutable.md
 */

import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { EconomicLedger } from "./ledger.js";
import type { Microdollars } from "./money.js";
import {
  addMicros,
  formatMicros,
  microsToUsd,
  minMicros,
  subtractMicros,
  ZERO_MICROS
} from "./money.js";
import type { ResolvedComputeEconomy } from "./compute-economy-config.js";
import type {
  ReservationParams,
  ReservationState,
  SettlementParams,
  SpendReservation
} from "./spend-reservation.js";
import {
  assertReservationTransition,
  BudgetExhaustedError,
  DuplicateReservationError
} from "./spend-reservation.js";

export interface BudgetAccount {
  id: string;
  kind: "global" | "monthly" | "daily" | "objective" | "phase";
  parentId: string | null;
  hardCapMicros: Microdollars;
  softTargetMicros: Microdollars;
  spentMicros: Microdollars;
  reservedMicros: Microdollars;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetScope {
  objectiveId: string;
  phase?: "producer" | "verifier" | "recovery" | "adjudication";
  date?: Date;
}

export interface RecoveryReport {
  releasedCount: number;
  unknownOutcomeCount: number;
  recoveredReservationIds: string[];
}

export interface BudgetEconomySummary {
  mode: string;
  globalHardCapMicros: Microdollars;
  monthlySpentMicros: Microdollars;
  monthlyReservedMicros: Microdollars;
  monthlyAvailableMicros: Microdollars;
  dailySpentMicros: Microdollars;
  dailyReservedMicros: Microdollars;
  dailyAvailableMicros: Microdollars;
  activeReservationsCount: number;
}

export class BudgetAccountant {
  private readonly now: () => string;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly config: ResolvedComputeEconomy,
    private readonly ledger?: EconomicLedger,
    nowFn?: () => string
  ) {
    this.now = nowFn ?? (() => new Date().toISOString());
    this.ensureGlobalAccount();
  }

  /**
   * Check if worst-case cost can be afforded across all applicable budget levels.
   * Free routes (0 micros) always return true (Invariant 6).
   */
  canAfford(scope: BudgetScope, worstCaseMicros: Microdollars): boolean {
    if (worstCaseMicros === 0) return true;
    if (this.config.mode === "zero_cost") return false;

    const accountIds = this.resolveScopeHierarchy(scope);
    for (const accountId of accountIds) {
      const account = this.getOrCreateAccount(accountId, scope);
      const available = subtractMicros(
        account.hardCapMicros,
        addMicros(account.spentMicros, account.reservedMicros)
      );
      if (available < worstCaseMicros) {
        return false;
      }
    }
    return true;
  }

  /**
   * Check if worst-case cost can be afforded hypothetically under target objective and inference limits.
   * Used in Shadow Mode to evaluate whether a candidate would have been authorized if paid mode was live.
   */
  canAffordHypothetical(
    scope: BudgetScope,
    worstCaseMicros: Microdollars,
    hypotheticalObjectiveCapMicros?: Microdollars
  ): boolean {
    if (worstCaseMicros === 0) return true;
    const targetCap = hypotheticalObjectiveCapMicros ?? this.config.defaultObjectiveHardCapMicros;
    let effectiveCap = targetCap;
    if (scope.phase === "adjudication") {
      const verifierCap = derivePhaseCap("verifier", targetCap);
      effectiveCap = derivePhaseCap("adjudication", verifierCap);
    } else if (scope.phase) {
      effectiveCap = derivePhaseCap(scope.phase, targetCap);
    }
    if (worstCaseMicros > effectiveCap) return false;
    if (this.config.maxSingleInferenceMicros && worstCaseMicros > this.config.maxSingleInferenceMicros) {
      return false;
    }
    return true;
  }

  /**
   * Get remaining available budget for a given scope.
   * Available = min(available across all accounts in scope hierarchy).
   */
  available(scope: BudgetScope): Microdollars {
    if (this.config.mode === "zero_cost") return ZERO_MICROS;

    const accountIds = this.resolveScopeHierarchy(scope);
    let minAvailable: Microdollars = Number.MAX_SAFE_INTEGER as Microdollars;

    for (const accountId of accountIds) {
      const account = this.getOrCreateAccount(accountId, scope);
      const available = Math.max(
        0,
        subtractMicros(account.hardCapMicros, addMicros(account.spentMicros, account.reservedMicros))
      ) as Microdollars;
      minAvailable = minMicros(minAvailable, available);
    }

    return minAvailable === (Number.MAX_SAFE_INTEGER as Microdollars) ? ZERO_MICROS : minAvailable;
  }

  /**
   * Atomically reserve budget across all accounts in the scope hierarchy.
   * If budget is insufficient, returns null (or throws BudgetExhaustedError).
   *
   * Concurrency safe via SQLite synchronous transaction serialization.
   *
   * @see Invariant 1, Invariant 2, Invariant 3
   */
  reserve(params: ReservationParams): SpendReservation | null {
    const scope: BudgetScope = {
      objectiveId: params.objectiveId,
      phase: params.phase
    };

    const reserveTx = this.sqlite.transaction(() => {
      // 1. Idempotency check
      const existing = this.sqlite
        .prepare("SELECT * FROM spend_reservations WHERE idempotency_key = ?")
        .get(params.idempotencyKey) as Record<string, unknown> | undefined;

      if (existing) {
        const reservation = mapReservationRow(existing);
        if (reservation.state === "RESERVED" || reservation.state === "REQUEST_SENT") {
          return reservation;
        }
        throw new DuplicateReservationError(params.idempotencyKey);
      }

      // 2. Resolve scope hierarchy and ensure accounts exist
      const scopeHierarchy = this.resolveScopeHierarchy(scope);
      for (const accountId of scopeHierarchy) {
        this.getOrCreateAccount(accountId, scope);
      }

      // 3. For billable routes, check affordability and lock budget
      if (params.worstCaseMicros > 0) {
        if (this.config.mode === "zero_cost") {
          return null;
        }

        // Check every account in the hierarchy
        for (const accountId of scopeHierarchy) {
          const account = this.getAccount(accountId)!;
          const available = subtractMicros(
            account.hardCapMicros,
            addMicros(account.spentMicros, account.reservedMicros)
          );
          if (available < params.worstCaseMicros) {
            return null;
          }
        }

        // All accounts can afford — atomically increment reserved_micros
        const timestamp = this.now();
        for (const accountId of scopeHierarchy) {
          this.sqlite
            .prepare(
              "UPDATE budget_accounts SET reserved_micros = reserved_micros + ?, updated_at = ? WHERE id = ?"
            )
            .run(params.worstCaseMicros, timestamp, accountId);
        }
      }

      // 4. Create and persist reservation record
      const id = nanoid();
      const primaryAccountId = scopeHierarchy[scopeHierarchy.length - 1] ?? "global";
      const timestamp = this.now();

      this.sqlite
        .prepare(`
          INSERT INTO spend_reservations (
            id, budget_account_id, scope_hierarchy, task_id, phase,
            provider, model, estimated_input_tokens, max_output_tokens,
            worst_case_micros, state, idempotency_key, pricing_snapshot_id,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RESERVED', ?, ?, ?)
        `)
        .run(
          id,
          primaryAccountId,
          JSON.stringify(scopeHierarchy),
          params.taskId ?? null,
          params.phase ?? null,
          params.provider,
          params.model,
          params.estimatedInputTokens ?? 0,
          params.maxOutputTokens ?? 0,
          params.worstCaseMicros,
          params.idempotencyKey,
          params.pricingSnapshotId ?? null,
          timestamp
        );

      return {
        id,
        budgetAccountId: primaryAccountId,
        scopeHierarchy,
        taskId: params.taskId,
        phase: params.phase,
        provider: params.provider,
        model: params.model,
        estimatedInputTokens: params.estimatedInputTokens,
        maxOutputTokens: params.maxOutputTokens,
        worstCaseMicros: params.worstCaseMicros,
        state: "RESERVED" as ReservationState,
        idempotencyKey: params.idempotencyKey,
        pricingSnapshotId: params.pricingSnapshotId,
        createdAt: timestamp
      };
    });

    return reserveTx();
  }

  /**
   * Mark a reservation as REQUEST_SENT.
   * Call right before dispatching the HTTP request to the provider.
   */
  markSent(reservationId: string, providerRequestId?: string): void {
    const markTx = this.sqlite.transaction(() => {
      const row = this.sqlite
        .prepare("SELECT * FROM spend_reservations WHERE id = ?")
        .get(reservationId) as Record<string, unknown> | undefined;

      if (!row) {
        throw new Error(`Reservation '${reservationId}' not found`);
      }

      const reservation = mapReservationRow(row);
      assertReservationTransition(reservation.state, "REQUEST_SENT");

      const timestamp = this.now();
      this.sqlite
        .prepare(
          "UPDATE spend_reservations SET state = 'REQUEST_SENT', sent_at = ?, provider_request_id = coalesce(?, provider_request_id) WHERE id = ?"
        )
        .run(timestamp, providerRequestId ?? null, reservationId);
    });

    markTx();
  }

  /**
   * Settle a reservation with the actual cost incurred.
   *
   * Releases the unspent difference (worst_case - actual) from reserved_micros,
   * and increments spent_micros with actualCostMicros across all accounts in hierarchy.
   *
   * Idempotent: settling an already settled reservation is a safe no-op.
   *
   * @see Invariant 1, Invariant 2, Invariant 5
   */
  settle(params: SettlementParams): void {
    const settleTx = this.sqlite.transaction(() => {
      const row = this.sqlite
        .prepare("SELECT * FROM spend_reservations WHERE id = ?")
        .get(params.reservationId) as Record<string, unknown> | undefined;

      if (!row) {
        throw new Error(`Reservation '${params.reservationId}' not found`);
      }

      const reservation = mapReservationRow(row);
      // Idempotency: if already settled, no-op
      if (reservation.state === "SETTLED") {
        return;
      }

      assertReservationTransition(reservation.state, "SETTLED");

      const timestamp = this.now();
      const scopeHierarchy = reservation.scopeHierarchy;
      const reservedAmount = reservation.worstCaseMicros;
      const actualAmount = params.actualCostMicros;

      // Update accounts in hierarchy:
      // - remove reservedAmount from reserved_micros
      // - add actualAmount to spent_micros
      for (const accountId of scopeHierarchy) {
        this.sqlite
          .prepare(`
            UPDATE budget_accounts
            SET reserved_micros = max(0, reserved_micros - ?),
                spent_micros = spent_micros + ?,
                updated_at = ?
            WHERE id = ?
          `)
          .run(reservedAmount, actualAmount, timestamp, accountId);
      }

      // Update reservation record
      this.sqlite
        .prepare(`
          UPDATE spend_reservations
          SET state = 'SETTLED',
              actual_cost_micros = ?,
              settled_at = ?,
              provider_request_id = coalesce(?, provider_request_id)
          WHERE id = ?
        `)
        .run(actualAmount, timestamp, params.providerRequestId ?? null, params.reservationId);

      // Record to EconomicLedger if actual cost is non-zero
      if (actualAmount > 0 && this.ledger) {
        const usdAmount = microsToUsd(actualAmount);
        void this.ledger.record(
          "expense",
          usdAmount,
          `Inference compute: ${reservation.provider}/${reservation.model}`,
          {
            reservationId: reservation.id,
            taskId: reservation.taskId,
            provider: reservation.provider,
            model: reservation.model,
            actualCostMicros: actualAmount,
            providerRequestId: params.providerRequestId
          }
        );
      }
    });

    settleTx();
  }

  /**
   * Release a reservation entirely (e.g. inference cancelled before send or failed).
   *
   * Releases full reserved_micros back to available budget across all accounts.
   * Idempotent: releasing an already released reservation is a safe no-op.
   */
  release(reservationId: string, reason: string): void {
    const releaseTx = this.sqlite.transaction(() => {
      const row = this.sqlite
        .prepare("SELECT * FROM spend_reservations WHERE id = ?")
        .get(reservationId) as Record<string, unknown> | undefined;

      if (!row) {
        throw new Error(`Reservation '${reservationId}' not found`);
      }

      const reservation = mapReservationRow(row);
      if (reservation.state === "RELEASED") {
        return;
      }

      assertReservationTransition(reservation.state, "RELEASED");

      const timestamp = this.now();
      const scopeHierarchy = reservation.scopeHierarchy;
      const reservedAmount = reservation.worstCaseMicros;

      for (const accountId of scopeHierarchy) {
        this.sqlite
          .prepare(`
            UPDATE budget_accounts
            SET reserved_micros = max(0, reserved_micros - ?),
                updated_at = ?
            WHERE id = ?
          `)
          .run(reservedAmount, timestamp, accountId);
      }

      this.sqlite
        .prepare(`
          UPDATE spend_reservations
          SET state = 'RELEASED',
              error = ?,
              settled_at = ?
          WHERE id = ?
        `)
        .run(reason, timestamp, reservationId);
    });

    releaseTx();
  }

  /**
   * Reconcile an UNKNOWN_OUTCOME reservation once external evidence is available.
   */
  reconcileUnknown(reservationId: string, actualCostMicros: Microdollars, reason: string): void {
    const row = this.sqlite
      .prepare("SELECT * FROM spend_reservations WHERE id = ?")
      .get(reservationId) as Record<string, unknown> | undefined;

    if (!row) throw new Error(`Reservation '${reservationId}' not found`);
    const reservation = mapReservationRow(row);
    if (reservation.state !== "UNKNOWN_OUTCOME") {
      throw new Error(`Cannot reconcile reservation in state '${reservation.state}'`);
    }

    if (actualCostMicros === 0) {
      this.release(reservationId, `reconciled_zero: ${reason}`);
    } else {
      this.settle({ reservationId, actualCostMicros });
    }
  }

  /**
   * Transition an in-flight reservation (REQUEST_SENT) to UNKNOWN_OUTCOME.
   * Keeps the conservative worst-case reservation locked in budget_accounts
   * so the capital CANNOT be reused or overspent until external reconciliation.
   *
   * @see Invariant 1, Invariant 2, Threat T-3
   */
  markUnknown(reservationId: string, reason: string): void {
    const markUnknownTx = this.sqlite.transaction(() => {
      const row = this.sqlite
        .prepare("SELECT * FROM spend_reservations WHERE id = ?")
        .get(reservationId) as Record<string, unknown> | undefined;

      if (!row) throw new Error(`Reservation '${reservationId}' not found`);
      const reservation = mapReservationRow(row);
      if (reservation.state === "UNKNOWN_OUTCOME") {
        return;
      }
      assertReservationTransition(reservation.state, "UNKNOWN_OUTCOME");

      const timestamp = this.now();
      this.sqlite
        .prepare(`
          UPDATE spend_reservations
          SET state = 'UNKNOWN_OUTCOME',
              error = ?,
              settled_at = ?
          WHERE id = ?
        `)
        .run(reason, timestamp, reservationId);
    });

    markUnknownTx();
  }

  /**
   * Crash recovery on startup.
   *
   * Scans for reservations left in non-terminal states from a prior process run:
   * - RESERVED: Request was never dispatched. Safe to release immediately.
   * - REQUEST_SENT: Request was in flight when process crashed.
   *   Outcome is unknown. Marked UNKNOWN_OUTCOME to conservatively protect budget.
   *
   * @see Invariant 2, Threat T-7
   */
  recoverAfterRestart(): RecoveryReport {
    const recoverTx = this.sqlite.transaction((): RecoveryReport => {
      const rows = this.sqlite
        .prepare("SELECT * FROM spend_reservations WHERE state IN ('RESERVED', 'REQUEST_SENT')")
        .all() as Array<Record<string, unknown>>;

      let releasedCount = 0;
      let unknownOutcomeCount = 0;
      const recoveredReservationIds: string[] = [];

      for (const row of rows) {
        const reservation = mapReservationRow(row);
        recoveredReservationIds.push(reservation.id);

        if (reservation.state === "RESERVED") {
          this.release(reservation.id, "crash_recovery_before_send");
          releasedCount++;
        } else if (reservation.state === "REQUEST_SENT") {
          // Mark UNKNOWN_OUTCOME to retain conservative reservation
          const timestamp = this.now();
          this.sqlite
            .prepare(`
              UPDATE spend_reservations
              SET state = 'UNKNOWN_OUTCOME',
                  error = 'crash_recovery_in_flight',
                  settled_at = ?
              WHERE id = ?
            `)
            .run(timestamp, reservation.id);
          unknownOutcomeCount++;
        }
      }

      return {
        releasedCount,
        unknownOutcomeCount,
        recoveredReservationIds
      };
    });

    return recoverTx();
  }

  /**
   * Set or update hard cap on an objective account.
   * Cannot exceed parent daily hard cap or global ceiling (Invariant 10).
   */
  setObjectiveHardCap(objectiveId: string, hardCapMicros: Microdollars): BudgetAccount {
    const scope: BudgetScope = { objectiveId };
    const accountId = `objective:${objectiveId}`;

    return this.sqlite.transaction(() => {
      const parentId = this.resolveDailyId(scope.date);
      const parent = this.getOrCreateAccount(parentId, scope);

      const effectiveCap = minMicros(hardCapMicros, parent.hardCapMicros);
      const timestamp = this.now();

      const existing = this.sqlite
        .prepare("SELECT * FROM budget_accounts WHERE id = ?")
        .get(accountId) as Record<string, unknown> | undefined;

      if (existing) {
        this.sqlite
          .prepare("UPDATE budget_accounts SET hard_cap_micros = ?, updated_at = ? WHERE id = ?")
          .run(effectiveCap, timestamp, accountId);
      } else {
        this.sqlite
          .prepare(`
            INSERT INTO budget_accounts (
              id, kind, parent_id, hard_cap_micros, soft_target_micros,
              spent_micros, reserved_micros, currency, created_at, updated_at
            ) VALUES (?, 'objective', ?, ?, ?, 0, 0, 'USD', ?, ?)
          `)
          .run(
            accountId,
            parentId,
            effectiveCap,
            this.config.defaultObjectiveSoftTargetMicros,
            timestamp,
            timestamp
          );
      }

      return this.getAccount(accountId)!;
    })();
  }

  getAccount(id: string): BudgetAccount | null {
    const row = this.sqlite
      .prepare("SELECT * FROM budget_accounts WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapAccountRow(row) : null;
  }

  getReservation(id: string): SpendReservation | null {
    const row = this.sqlite
      .prepare("SELECT * FROM spend_reservations WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapReservationRow(row) : null;
  }

  listReservations(options: { taskId?: string; state?: ReservationState } = {}): SpendReservation[] {
    let query = "SELECT * FROM spend_reservations WHERE 1=1";
    const params: unknown[] = [];

    if (options.taskId) {
      query += " AND task_id = ?";
      params.push(options.taskId);
    }
    if (options.state) {
      query += " AND state = ?";
      params.push(options.state);
    }
    query += " ORDER BY created_at DESC";

    const rows = this.sqlite.prepare(query).all(...params) as Array<Record<string, unknown>>;
    return rows.map(mapReservationRow);
  }

  summary(): BudgetEconomySummary {
    const now = new Date();
    const monthId = this.resolveMonthlyId(now);
    const dayId = this.resolveDailyId(now);

    const globalAccount = this.getAccount("global");
    const monthAccount = this.getAccount(monthId);
    const dayAccount = this.getAccount(dayId);

    const activeRows = this.sqlite
      .prepare("SELECT COUNT(*) as cnt FROM spend_reservations WHERE state IN ('RESERVED', 'REQUEST_SENT')")
      .get() as { cnt: number };

    const monthSpent = monthAccount?.spentMicros ?? ZERO_MICROS;
    const monthReserved = monthAccount?.reservedMicros ?? ZERO_MICROS;
    const monthCap = monthAccount?.hardCapMicros ?? ZERO_MICROS;

    const daySpent = dayAccount?.spentMicros ?? ZERO_MICROS;
    const dayReserved = dayAccount?.reservedMicros ?? ZERO_MICROS;
    const dayCap = dayAccount?.hardCapMicros ?? ZERO_MICROS;

    return {
      mode: this.config.mode,
      globalHardCapMicros: globalAccount?.hardCapMicros ?? ZERO_MICROS,
      monthlySpentMicros: monthSpent,
      monthlyReservedMicros: monthReserved,
      monthlyAvailableMicros: Math.max(0, subtractMicros(monthCap, addMicros(monthSpent, monthReserved))) as Microdollars,
      dailySpentMicros: daySpent,
      dailyReservedMicros: dayReserved,
      dailyAvailableMicros: Math.max(0, subtractMicros(dayCap, addMicros(daySpent, dayReserved))) as Microdollars,
      activeReservationsCount: activeRows.cnt
    };
  }

  // --- Internal Helpers ---

  private ensureGlobalAccount(): void {
    const existing = this.sqlite
      .prepare("SELECT id FROM budget_accounts WHERE id = 'global'")
      .get();

    if (!existing) {
      const timestamp = this.now();
      this.sqlite
        .prepare(`
          INSERT INTO budget_accounts (
            id, kind, parent_id, hard_cap_micros, soft_target_micros,
            spent_micros, reserved_micros, currency, created_at, updated_at
          ) VALUES ('global', 'global', NULL, ?, 0, 0, 0, 'USD', ?, ?)
        `)
        .run(this.config.monthlyHardCapMicros, timestamp, timestamp);
    }
  }

  private resolveScopeHierarchy(scope: BudgetScope): string[] {
    const hierarchy = ["global"];
    const monthId = this.resolveMonthlyId(scope.date);
    const dayId = this.resolveDailyId(scope.date);
    const objId = `objective:${scope.objectiveId}`;

    hierarchy.push(monthId);
    hierarchy.push(dayId);
    hierarchy.push(objId);

    if (scope.phase === "adjudication") {
      hierarchy.push(`phase:${scope.objectiveId}:verifier`);
      hierarchy.push(`phase:${scope.objectiveId}:adjudication`);
    } else if (scope.phase) {
      hierarchy.push(`phase:${scope.objectiveId}:${scope.phase}`);
    }

    return hierarchy;
  }

  private getOrCreateAccount(id: string, scope: BudgetScope): BudgetAccount {
    const existing = this.getAccount(id);
    if (existing) return existing;

    const timestamp = this.now();

    if (id.startsWith("monthly:")) {
      const parent = this.getOrCreateAccount("global", scope);
      const cap = minMicros(this.config.monthlyHardCapMicros, parent.hardCapMicros);
      this.insertAccount(id, "monthly", "global", cap, ZERO_MICROS, timestamp);
    } else if (id.startsWith("daily:")) {
      const monthId = this.resolveMonthlyId(scope.date);
      const parent = this.getOrCreateAccount(monthId, scope);
      const cap = minMicros(this.config.dailyHardCapMicros, parent.hardCapMicros);
      this.insertAccount(id, "daily", monthId, cap, ZERO_MICROS, timestamp);
    } else if (id.startsWith("objective:")) {
      const dayId = this.resolveDailyId(scope.date);
      const parent = this.getOrCreateAccount(dayId, scope);
      const cap = minMicros(this.config.defaultObjectiveHardCapMicros, parent.hardCapMicros);
      this.insertAccount(
        id,
        "objective",
        dayId,
        cap,
        this.config.defaultObjectiveSoftTargetMicros,
        timestamp
      );
    } else if (id.startsWith("phase:")) {
      const parts = id.split(":");
      const phaseName = parts[2] as BudgetScope["phase"];
      const objId = `objective:${scope.objectiveId}`;
      if (phaseName === "adjudication") {
        // Adjudication is explicitly a subbudget of verifier
        const verifierAccount = this.getOrCreateAccount(`phase:${scope.objectiveId}:verifier`, scope);
        const adjudicationCap = minMicros(
          derivePhaseCap("adjudication", verifierAccount.hardCapMicros),
          verifierAccount.hardCapMicros
        );
        this.insertAccount(id, "phase", verifierAccount.id, adjudicationCap, ZERO_MICROS, timestamp);
      } else {
        const parent = this.getOrCreateAccount(objId, scope);
        const phaseCap = derivePhaseCap(phaseName, parent.hardCapMicros);
        this.insertAccount(id, "phase", objId, phaseCap, ZERO_MICROS, timestamp);
      }
    } else if (id === "global") {
      this.ensureGlobalAccount();
    }

    return this.getAccount(id)!;
  }

  private insertAccount(
    id: string,
    kind: BudgetAccount["kind"],
    parentId: string | null,
    hardCapMicros: Microdollars,
    softTargetMicros: Microdollars,
    timestamp: string
  ): void {
    this.sqlite
      .prepare(`
        INSERT OR IGNORE INTO budget_accounts (
          id, kind, parent_id, hard_cap_micros, soft_target_micros,
          spent_micros, reserved_micros, currency, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, 0, 'USD', ?, ?)
      `)
      .run(id, kind, parentId, hardCapMicros, softTargetMicros, timestamp, timestamp);
  }

  private resolveMonthlyId(d?: Date): string {
    const date = d ?? new Date();
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    return `monthly:${year}-${month}`;
  }

  private resolveDailyId(d?: Date): string {
    const date = d ?? new Date();
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `daily:${year}-${month}-${day}`;
  }
}

export const SIBLING_PHASE_ALLOCATION_RATIOS = {
  producer: 0.60,
  verifier: 0.25,
  recovery: 0.15
} as const;

export const SUBPHASE_ALLOCATION_RATIOS = {
  // Adjudication is a subphase of verifier: capped at 40% of verifier cap (= 10% of total objective cap)
  adjudication: 0.40
} as const;

export function derivePhaseCap(phase: BudgetScope["phase"], parentCap: Microdollars): Microdollars {
  if (!phase) return parentCap;
  switch (phase) {
    case "producer":
      return Math.floor(parentCap * SIBLING_PHASE_ALLOCATION_RATIOS.producer) as Microdollars;
    case "verifier":
      return Math.floor(parentCap * SIBLING_PHASE_ALLOCATION_RATIOS.verifier) as Microdollars;
    case "recovery":
      return Math.floor(parentCap * SIBLING_PHASE_ALLOCATION_RATIOS.recovery) as Microdollars;
    case "adjudication":
      return Math.floor(parentCap * SUBPHASE_ALLOCATION_RATIOS.adjudication) as Microdollars;
    default:
      return parentCap;
  }
}

function mapAccountRow(row: Record<string, unknown>): BudgetAccount {
  return {
    id: String(row.id),
    kind: row.kind as BudgetAccount["kind"],
    parentId: row.parent_id ? String(row.parent_id) : null,
    hardCapMicros: Number(row.hard_cap_micros) as Microdollars,
    softTargetMicros: Number(row.soft_target_micros ?? 0) as Microdollars,
    spentMicros: Number(row.spent_micros ?? 0) as Microdollars,
    reservedMicros: Number(row.reserved_micros ?? 0) as Microdollars,
    currency: String(row.currency ?? "USD"),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapReservationRow(row: Record<string, unknown>): SpendReservation {
  let scopeHierarchy: string[] = [];
  try {
    scopeHierarchy = JSON.parse(String(row.scope_hierarchy ?? "[]"));
  } catch {
    scopeHierarchy = [];
  }

  return {
    id: String(row.id),
    budgetAccountId: String(row.budget_account_id),
    scopeHierarchy,
    taskId: row.task_id ? String(row.task_id) : undefined,
    phase: row.phase ? String(row.phase) : undefined,
    provider: String(row.provider),
    model: String(row.model),
    estimatedInputTokens: Number(row.estimated_input_tokens ?? 0),
    maxOutputTokens: Number(row.max_output_tokens ?? 0),
    worstCaseMicros: Number(row.worst_case_micros) as Microdollars,
    actualCostMicros: row.actual_cost_micros != null ? (Number(row.actual_cost_micros) as Microdollars) : undefined,
    pricingSnapshotId: row.pricing_snapshot_id ? String(row.pricing_snapshot_id) : undefined,
    state: row.state as ReservationState,
    idempotencyKey: String(row.idempotency_key),
    providerRequestId: row.provider_request_id ? String(row.provider_request_id) : undefined,
    createdAt: String(row.created_at),
    sentAt: row.sent_at ? String(row.sent_at) : undefined,
    settledAt: row.settled_at ? String(row.settled_at) : undefined,
    error: row.error ? String(row.error) : undefined
  };
}
