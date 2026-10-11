import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '../../db/client.js';
import { BudgetAccountant } from '../budget-accountant.js';
import { ResolvedComputeEconomy } from '../compute-economy-config.js';
import { Microdollars, ZERO_MICROS } from '../money.js';

describe('BudgetAccountant Concurrency Stress Test', () => {
  let sqlite: ReturnType<typeof openDatabase>['sqlite'];

  const concurrencyConfig: ResolvedComputeEconomy = {
    mode: 'bounded',
    monthlyHardCapMicros: Microdollars.fromNumber(1_000_000), // $1.00
    dailyHardCapMicros: Microdollars.fromNumber(100_000), // $0.10 hard limit
    defaultObjectiveHardCapMicros: Microdollars.fromNumber(100_000), // $0.10
    defaultObjectiveSoftTargetMicros: Microdollars.fromNumber(50_000),
    maxSingleInferenceMicros: Microdollars.fromNumber(50_000),
  };

  beforeEach(() => {
    const client = openDatabase(':memory:');
    sqlite = client.sqlite;
  });

  it('prevents race conditions: 100 concurrent requests for $0.01 against $0.10 budget yields exactly 10 successes', async () => {
    const accountant = new BudgetAccountant(sqlite, concurrencyConfig);
    const objectiveId = 'obj-concurrency-test';
    const requestCost = Microdollars.fromNumber(10_000); // $0.01 each

    // Issue 100 concurrent requests across Promise.all
    const promises = Array.from({ length: 100 }, (_, i) => {
      return Promise.resolve().then(() => {
        return accountant.reserve({
          objectiveId,
          provider: 'openrouter',
          model: 'anthropic/claude-3.5-sonnet',
          estimatedInputTokens: 500,
          maxOutputTokens: 500,
          worstCaseMicros: requestCost,
          idempotencyKey: `concurrent-req-${i}`,
        });
      });
    });

    const results = await Promise.all(promises);

    const successfulReservations = results.filter((r) => r !== null);
    const failedReservations = results.filter((r) => r === null);

    // Hard invariant: Exactly 10 can fit into 100,000 micros at 10,000 each!
    expect(successfulReservations.length).toBe(10);
    expect(failedReservations.length).toBe(90);

    // Verify account state: total reserved must be exactly 100,000 and spent must be 0
    const objAccount = accountant.getAccount(`objective:${objectiveId}`)!;
    expect(objAccount.reservedMicros).toBe(100_000);
    expect(objAccount.spentMicros).toBe(0);

    // Available budget should now be 0
    expect(accountant.available({ objectiveId })).toBe(ZERO_MICROS);

    // Any subsequent reservation attempt must fail
    const lateReservation = accountant.reserve({
      objectiveId,
      provider: 'openrouter',
      model: 'anthropic/claude-3.5-sonnet',
      estimatedInputTokens: 100,
      maxOutputTokens: 100,
      worstCaseMicros: Microdollars.fromNumber(100),
      idempotencyKey: 'late-request',
    });
    expect(lateReservation).toBeNull();

    // Settle 5 reservations and release 5 reservations
    const firstFive = successfulReservations.slice(0, 5);
    const lastFive = successfulReservations.slice(5, 10);

    for (const res of firstFive) {
      accountant.markSent(res!.id);
      // Settle at actual cost of 6,000 micros ($0.006)
      accountant.settle({
        reservationId: res!.id,
        actualCostMicros: Microdollars.fromNumber(6_000),
      });
    }

    for (const res of lastFive) {
      accountant.release(res!.id, 'cancelled');
    }

    // After settling 5 * 6,000 = 30,000 micros and releasing 5 * 10,000 = 50,000 micros:
    // Reserved should be 0
    // Spent should be 30,000
    // Available should be 100,000 - 30,000 = 70,000 micros
    const finalAccount = accountant.getAccount(`objective:${objectiveId}`)!;
    expect(finalAccount.reservedMicros).toBe(0);
    expect(finalAccount.spentMicros).toBe(30_000);
    expect(accountant.available({ objectiveId })).toBe(70_000);
  });
});
