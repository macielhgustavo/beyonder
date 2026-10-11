import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '../../db/client.js';
import { BudgetAccountant } from '../budget-accountant.js';
import { ResolvedComputeEconomy } from '../compute-economy-config.js';
import { Microdollars } from '../money.js';

describe('Budget Crash Recovery (Invariant 2 & Threat T-7)', () => {
  let sqlite: ReturnType<typeof openDatabase>['sqlite'];

  const recoveryConfig: ResolvedComputeEconomy = {
    mode: 'bounded',
    monthlyHardCapMicros: Microdollars.fromNumber(10_000_000), // $10.00
    dailyHardCapMicros: Microdollars.fromNumber(2_000_000), // $2.00
    defaultObjectiveHardCapMicros: Microdollars.fromNumber(500_000), // $0.50
    defaultObjectiveSoftTargetMicros: Microdollars.fromNumber(100_000),
    maxSingleInferenceMicros: Microdollars.fromNumber(100_000),
  };

  beforeEach(() => {
    const client = openDatabase(':memory:');
    sqlite = client.sqlite;
  });

  it('safely recovers orphaned reservations after simulated process crash and restart', () => {
    const accountantPreCrash = new BudgetAccountant(sqlite, recoveryConfig);
    const objectiveId = 'obj-crash-test';

    // 1. Create a reservation that remains in RESERVED state (request never sent)
    const resUnsent = accountantPreCrash.reserve({
      objectiveId,
      provider: 'openrouter',
      model: 'anthropic/claude-3.5-sonnet',
      estimatedInputTokens: 1000,
      maxOutputTokens: 1000,
      worstCaseMicros: Microdollars.fromNumber(20_000), // $0.02
      idempotencyKey: 'res-unsent-crash',
    })!;

    // 2. Create a reservation that is dispatched (REQUEST_SENT) but crashes in flight
    const resInFlight = accountantPreCrash.reserve({
      objectiveId,
      provider: 'openrouter',
      model: 'openai/gpt-4o',
      estimatedInputTokens: 2000,
      maxOutputTokens: 1000,
      worstCaseMicros: Microdollars.fromNumber(30_000), // $0.03
      idempotencyKey: 'res-inflight-crash',
    })!;
    accountantPreCrash.markSent(resInFlight.id, 'prov-req-inflight');

    // 3. Create a reservation that was normally settled before crash
    const resSettled = accountantPreCrash.reserve({
      objectiveId,
      provider: 'openrouter',
      model: 'google/gemini-pro',
      estimatedInputTokens: 500,
      maxOutputTokens: 500,
      worstCaseMicros: Microdollars.fromNumber(10_000),
      idempotencyKey: 'res-settled-pre-crash',
    })!;
    accountantPreCrash.markSent(resSettled.id);
    accountantPreCrash.settle({
      reservationId: resSettled.id,
      actualCostMicros: Microdollars.fromNumber(8_000),
    });

    // Check pre-crash balances:
    // Reserved: 20,000 (unsent) + 30,000 (in flight) = 50,000
    // Spent: 8,000
    const preCrashAccount = accountantPreCrash.getAccount(`objective:${objectiveId}`)!;
    expect(preCrashAccount.reservedMicros).toBe(50_000);
    expect(preCrashAccount.spentMicros).toBe(8_000);

    // --- PROCESS CRASH & RESTART ---
    // Simulate restart by initializing a new BudgetAccountant over the same SQLite instance
    const accountantPostRestart = new BudgetAccountant(sqlite, recoveryConfig);

    // Run recovery
    const report = accountantPostRestart.recoverAfterRestart();

    expect(report.releasedCount).toBe(1);
    expect(report.unknownOutcomeCount).toBe(1);
    expect(report.recoveredReservationIds).toContain(resUnsent.id);
    expect(report.recoveredReservationIds).toContain(resInFlight.id);

    // Check unsent reservation: released and funds unlocked
    const recoveredUnsent = accountantPostRestart.getReservation(resUnsent.id)!;
    expect(recoveredUnsent.state).toBe('RELEASED');
    expect(recoveredUnsent.error).toBe('crash_recovery_before_send');

    // Check in-flight reservation: marked UNKNOWN_OUTCOME and funds conservatively retained
    const recoveredInFlight = accountantPostRestart.getReservation(resInFlight.id)!;
    expect(recoveredInFlight.state).toBe('UNKNOWN_OUTCOME');
    expect(recoveredInFlight.error).toBe('crash_recovery_in_flight');

    // Settled reservation: unaffected
    const recoveredSettled = accountantPostRestart.getReservation(resSettled.id)!;
    expect(recoveredSettled.state).toBe('SETTLED');
    expect(recoveredSettled.actualCostMicros).toBe(8_000);

    // Check post-crash balances:
    // The 20,000 unsent was released.
    // The 30,000 in-flight remains reserved (to prevent budget overspend).
    // Reserved: 30,000
    // Spent: 8,000
    const postCrashAccount = accountantPostRestart.getAccount(`objective:${objectiveId}`)!;
    expect(postCrashAccount.reservedMicros).toBe(30_000);
    expect(postCrashAccount.spentMicros).toBe(8_000);

    // Now reconcile the in-flight reservation once provider invoice/usage confirms $0.025 was spent
    accountantPostRestart.reconcileUnknown(
      resInFlight.id,
      Microdollars.fromNumber(25_000),
      'provider_billing_reconciled'
    );

    const postReconcileAccount = accountantPostRestart.getAccount(`objective:${objectiveId}`)!;
    expect(postReconcileAccount.reservedMicros).toBe(0);
    expect(postReconcileAccount.spentMicros).toBe(8_000 + 25_000); // 33,000 micros
  });
});
