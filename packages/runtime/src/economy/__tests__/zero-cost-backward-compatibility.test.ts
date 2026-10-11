import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '../../db/client.js';
import { BudgetAccountant } from '../budget-accountant.js';
import { resolveComputeEconomy } from '../compute-economy-config.js';
import { Microdollars, ZERO_MICROS } from '../money.js';

describe('Zero Cost Backward Compatibility (Default Mode)', () => {
  let sqlite: ReturnType<typeof openDatabase>['sqlite'];

  beforeEach(() => {
    const client = openDatabase(':memory:');
    sqlite = client.sqlite;
  });

  it('defaults to zero_cost mode with zero dollar spending caps when no env is set', () => {
    const defaultConfig = resolveComputeEconomy({});
    expect(defaultConfig.mode).toBe('zero_cost');
    expect(defaultConfig.monthlyHardCapMicros).toBe(0);
    expect(defaultConfig.dailyHardCapMicros).toBe(0);
    expect(defaultConfig.defaultObjectiveHardCapMicros).toBe(250_000); // template default
  });

  it('strictly rejects any paid reservation attempt in zero_cost mode', () => {
    const zeroCostConfig = resolveComputeEconomy({});
    const accountant = new BudgetAccountant(sqlite, zeroCostConfig);
    const scope = { objectiveId: 'obj-v05-compat' };

    // canAfford returns false for even 1 microdollar
    expect(accountant.canAfford(scope, Microdollars.fromNumber(1))).toBe(false);
    expect(accountant.available(scope)).toBe(ZERO_MICROS);

    // Paid reservation returns null
    const paidReservation = accountant.reserve({
      objectiveId: 'obj-v05-compat',
      provider: 'openrouter',
      model: 'anthropic/claude-3.5-sonnet',
      estimatedInputTokens: 100,
      maxOutputTokens: 100,
      worstCaseMicros: Microdollars.fromNumber(500),
      idempotencyKey: 'zero-cost-paid-attempt',
    });

    expect(paidReservation).toBeNull();
  });

  it('permits free compute reservations and transitions in zero_cost mode', () => {
    const zeroCostConfig = resolveComputeEconomy({});
    const accountant = new BudgetAccountant(sqlite, zeroCostConfig);
    const scope = { objectiveId: 'obj-v05-compat' };

    // canAfford returns true for 0 microdollars (Invariant 6)
    expect(accountant.canAfford(scope, ZERO_MICROS)).toBe(true);

    const freeReservation = accountant.reserve({
      objectiveId: 'obj-v05-compat',
      provider: 'gemini',
      model: 'gemini-1.5-flash',
      estimatedInputTokens: 2000,
      maxOutputTokens: 1000,
      worstCaseMicros: ZERO_MICROS,
      idempotencyKey: 'zero-cost-free-attempt',
    });

    expect(freeReservation).not.toBeNull();
    expect(freeReservation?.state).toBe('RESERVED');
    expect(freeReservation?.worstCaseMicros).toBe(0);

    // markSent and settle work seamlessly
    accountant.markSent(freeReservation!.id);
    accountant.settle({
      reservationId: freeReservation!.id,
      actualCostMicros: ZERO_MICROS,
    });

    const settled = accountant.getReservation(freeReservation!.id)!;
    expect(settled.state).toBe('SETTLED');
    expect(settled.actualCostMicros).toBe(0);
  });
});
