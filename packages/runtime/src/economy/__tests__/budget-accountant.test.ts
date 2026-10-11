import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '../../db/client.js';
import { BudgetAccountant } from '../budget-accountant.js';
import { ResolvedComputeEconomy } from '../compute-economy-config.js';
import { Microdollars, ZERO_MICROS } from '../money.js';
import { DuplicateReservationError } from '../spend-reservation.js';
import { EconomicLedger } from '../ledger.js';

describe('BudgetAccountant Integration', () => {
  let sqlite: ReturnType<typeof openDatabase>['sqlite'];
  let db: ReturnType<typeof openDatabase>['db'];
  let ledger: EconomicLedger;

  const testConfig: ResolvedComputeEconomy = {
    mode: 'bounded',
    monthlyHardCapMicros: Microdollars.fromNumber(10_000_000), // $10.00
    dailyHardCapMicros: Microdollars.fromNumber(2_000_000), // $2.00
    defaultObjectiveHardCapMicros: Microdollars.fromNumber(500_000), // $0.50
    defaultObjectiveSoftTargetMicros: Microdollars.fromNumber(100_000), // $0.10
    maxSingleInferenceMicros: Microdollars.fromNumber(100_000), // $0.10
  };

  beforeEach(() => {
    const client = openDatabase(':memory:');
    sqlite = client.sqlite;
    db = client.db;
    ledger = new EconomicLedger(db);
  });

  it('initializes and maintains hierarchical budget accounts (global -> monthly -> daily -> objective -> phase)', () => {
    const accountant = new BudgetAccountant(sqlite, testConfig, ledger);

    const scope = {
      objectiveId: 'obj-test-1',
      phase: 'producer' as const,
    };

    // canAfford $0.05
    expect(accountant.canAfford(scope, Microdollars.fromNumber(50_000))).toBe(true);

    // Objective hard cap is $0.50 (500,000 micros), so $0.60 is unaffordable
    expect(accountant.canAfford(scope, Microdollars.fromNumber(600_000))).toBe(false);

    // Global account exists
    const globalAccount = accountant.getAccount('global');
    expect(globalAccount).not.toBeNull();
    expect(globalAccount?.kind).toBe('global');
  });

  it('Invariant 6: free compute (0 micros) always succeeds and does not alter account balances', () => {
    const accountant = new BudgetAccountant(sqlite, testConfig, ledger);
    const scope = { objectiveId: 'obj-free' };

    expect(accountant.canAfford(scope, ZERO_MICROS)).toBe(true);

    const res = accountant.reserve({
      objectiveId: 'obj-free',
      provider: 'gemini',
      model: 'gemini-1.5-flash',
      estimatedInputTokens: 1000,
      maxOutputTokens: 2000,
      worstCaseMicros: ZERO_MICROS,
      idempotencyKey: 'idemp-free-1',
    });

    expect(res).not.toBeNull();
    expect(res?.state).toBe('RESERVED');
    expect(res?.worstCaseMicros).toBe(0);

    const objAccount = accountant.getAccount('objective:obj-free');
    expect(objAccount?.reservedMicros).toBe(0);
    expect(objAccount?.spentMicros).toBe(0);
  });

  it('Invariant 1 & 3: reservation fails when worst-case cost exceeds remaining budget', () => {
    const tightConfig: ResolvedComputeEconomy = {
      ...testConfig,
      defaultObjectiveHardCapMicros: Microdollars.fromNumber(30_000), // $0.03
    };

    const accountant = new BudgetAccountant(sqlite, tightConfig, ledger);

    // Try to reserve $0.05 when cap is $0.03
    const res = accountant.reserve({
      objectiveId: 'obj-tight',
      provider: 'openrouter',
      model: 'anthropic/claude-3.5-sonnet',
      estimatedInputTokens: 2000,
      maxOutputTokens: 2000,
      worstCaseMicros: Microdollars.fromNumber(50_000),
      idempotencyKey: 'idemp-tight-1',
    });

    expect(res).toBeNull();
  });

  it('Invariant 2: retries with same idempotencyKey do not duplicate spend or reservation', () => {
    const accountant = new BudgetAccountant(sqlite, testConfig, ledger);

    const reservation1 = accountant.reserve({
      objectiveId: 'obj-retry',
      provider: 'openrouter',
      model: 'anthropic/claude-3.5-sonnet',
      estimatedInputTokens: 1000,
      maxOutputTokens: 1000,
      worstCaseMicros: Microdollars.fromNumber(20_000),
      idempotencyKey: 'idemp-duplicate-test',
    });

    expect(reservation1).not.toBeNull();

    // Call reserve again with the exact same idempotency key
    const reservation2 = accountant.reserve({
      objectiveId: 'obj-retry',
      provider: 'openrouter',
      model: 'anthropic/claude-3.5-sonnet',
      estimatedInputTokens: 1000,
      maxOutputTokens: 1000,
      worstCaseMicros: Microdollars.fromNumber(20_000),
      idempotencyKey: 'idemp-duplicate-test',
    });

    // Returns identical reservation record
    expect(reservation2?.id).toBe(reservation1?.id);

    // Reserved amount in objective account is 20,000 NOT 40,000
    const objAccount = accountant.getAccount('objective:obj-retry');
    expect(objAccount?.reservedMicros).toBe(20_000);
  });

  it('Invariant 5: actual cost overrides estimates, releases unused reservation, and writes to ledger', async () => {
    const accountant = new BudgetAccountant(sqlite, testConfig, ledger);

    const reservation = accountant.reserve({
      objectiveId: 'obj-settle',
      provider: 'openrouter',
      model: 'anthropic/claude-3.5-sonnet',
      estimatedInputTokens: 1000,
      maxOutputTokens: 1000,
      worstCaseMicros: Microdollars.fromNumber(50_000), // Reserved $0.05
      idempotencyKey: 'idemp-settle-1',
    })!;

    expect(reservation).not.toBeNull();

    accountant.markSent(reservation.id, 'provider-req-123');

    // Settle with actual cost of $0.018 (18,000 micros)
    accountant.settle({
      reservationId: reservation.id,
      actualCostMicros: Microdollars.fromNumber(18_000),
      providerRequestId: 'provider-req-123',
    });

    // Objective account verification
    const objAccount = accountant.getAccount('objective:obj-settle')!;
    expect(objAccount.reservedMicros).toBe(0); // All reserved released
    expect(objAccount.spentMicros).toBe(18_000); // Only actual spent recorded

    // Reservation verification
    const updatedRes = accountant.getReservation(reservation.id)!;
    expect(updatedRes.state).toBe('SETTLED');
    expect(updatedRes.actualCostMicros).toBe(18_000);

    // EconomicLedger entry created
    const ledgerEntries = await ledger.latest();
    const computeExpense = ledgerEntries.find(
      (e) => (JSON.parse(e.metadata) as any)?.reservationId === reservation.id
    );
    expect(computeExpense).toBeDefined();
    expect(computeExpense?.amountUsd).toBe(0.018);
    expect(computeExpense?.type).toBe('expense');
  });

  it('releasing a reservation restores full reserved amount to available budget', () => {
    const accountant = new BudgetAccountant(sqlite, testConfig, ledger);

    const reservation = accountant.reserve({
      objectiveId: 'obj-release',
      provider: 'openrouter',
      model: 'anthropic/claude-3.5-sonnet',
      estimatedInputTokens: 1000,
      maxOutputTokens: 1000,
      worstCaseMicros: Microdollars.fromNumber(35_000),
      idempotencyKey: 'idemp-release-1',
    })!;

    const beforeRelease = accountant.getAccount('objective:obj-release')!;
    expect(beforeRelease.reservedMicros).toBe(35_000);

    accountant.release(reservation.id, 'inference_cancelled');

    const afterRelease = accountant.getAccount('objective:obj-release')!;
    expect(afterRelease.reservedMicros).toBe(0);
    expect(afterRelease.spentMicros).toBe(0);

    const resRecord = accountant.getReservation(reservation.id)!;
    expect(resRecord.state).toBe('RELEASED');
  });

  it('Invariant 10: setObjectiveHardCap cannot exceed parent daily hard cap', () => {
    const accountant = new BudgetAccountant(sqlite, testConfig, ledger);

    // Daily hard cap is $2.00 (2,000,000 micros). Attempt to set objective cap to $5.00 (5,000,000 micros).
    const updated = accountant.setObjectiveHardCap(
      'obj-cap-test',
      Microdollars.fromNumber(5_000_000)
    );

    // It is bounded by parent daily hard cap of 2,000,000 micros
    expect(updated.hardCapMicros).toBe(2_000_000);
  });
});
