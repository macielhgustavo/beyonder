import { describe, it, expect } from 'vitest';
import {
  assertReservationTransition,
  canTransitionReservation,
  InvalidReservationTransitionError,
  SpendReservation,
} from '../spend-reservation.js';
import { Microdollars } from '../money.js';

describe('SpendReservation State Machine', () => {
  const dummyReservation: SpendReservation = {
    id: 'res-1',
    budgetAccountId: 'objective:obj-1',
    scopeHierarchy: ['global', 'monthly:2026-10', 'daily:2026-10-11', 'objective:obj-1'],
    provider: 'openrouter',
    model: 'anthropic/claude-3.5-sonnet',
    estimatedInputTokens: 1000,
    maxOutputTokens: 1000,
    worstCaseMicros: Microdollars.fromNumber(25_000),
    state: 'RESERVED',
    idempotencyKey: 'idemp-1',
    createdAt: new Date().toISOString(),
  };

  it('allows valid state transitions', () => {
    // RESERVED transitions
    expect(canTransitionReservation('RESERVED', 'REQUEST_SENT')).toBe(true);
    expect(canTransitionReservation('RESERVED', 'RELEASED')).toBe(true);
    expect(() => assertReservationTransition('RESERVED', 'REQUEST_SENT')).not.toThrow();
    expect(() => assertReservationTransition('RESERVED', 'RELEASED')).not.toThrow();

    // REQUEST_SENT transitions
    expect(canTransitionReservation('REQUEST_SENT', 'SETTLED')).toBe(true);
    expect(canTransitionReservation('REQUEST_SENT', 'UNKNOWN_OUTCOME')).toBe(true);
    expect(canTransitionReservation('REQUEST_SENT', 'RELEASED')).toBe(true);
    expect(() => assertReservationTransition('REQUEST_SENT', 'SETTLED')).not.toThrow();
    expect(() => assertReservationTransition('REQUEST_SENT', 'UNKNOWN_OUTCOME')).not.toThrow();
    expect(() => assertReservationTransition('REQUEST_SENT', 'RELEASED')).not.toThrow();

    // UNKNOWN_OUTCOME transitions
    expect(canTransitionReservation('UNKNOWN_OUTCOME', 'SETTLED')).toBe(true);
    expect(canTransitionReservation('UNKNOWN_OUTCOME', 'RELEASED')).toBe(true);
    expect(() => assertReservationTransition('UNKNOWN_OUTCOME', 'SETTLED')).not.toThrow();
    expect(() => assertReservationTransition('UNKNOWN_OUTCOME', 'RELEASED')).not.toThrow();
  });

  it('prohibits illegal state transitions from terminal states', () => {
    expect(() => assertReservationTransition('SETTLED', 'RESERVED')).toThrow(InvalidReservationTransitionError);
    expect(() => assertReservationTransition('SETTLED', 'REQUEST_SENT')).toThrow(InvalidReservationTransitionError);
    expect(() => assertReservationTransition('SETTLED', 'RELEASED')).toThrow(InvalidReservationTransitionError);
    expect(() => assertReservationTransition('SETTLED', 'UNKNOWN_OUTCOME')).toThrow(InvalidReservationTransitionError);

    expect(() => assertReservationTransition('RELEASED', 'RESERVED')).toThrow(InvalidReservationTransitionError);
    expect(() => assertReservationTransition('RELEASED', 'REQUEST_SENT')).toThrow(InvalidReservationTransitionError);
    expect(() => assertReservationTransition('RELEASED', 'SETTLED')).toThrow(InvalidReservationTransitionError);
  });

  it('prohibits backwards or skipping transitions', () => {
    // Cannot skip directly from RESERVED to SETTLED without REQUEST_SENT
    expect(() => assertReservationTransition('RESERVED', 'SETTLED')).toThrow(InvalidReservationTransitionError);
    // Cannot move backwards from REQUEST_SENT to RESERVED
    expect(() => assertReservationTransition('REQUEST_SENT', 'RESERVED')).toThrow(InvalidReservationTransitionError);
    // Cannot move backwards from UNKNOWN_OUTCOME to REQUEST_SENT
    expect(() => assertReservationTransition('UNKNOWN_OUTCOME', 'REQUEST_SENT')).toThrow(InvalidReservationTransitionError);
  });
});
