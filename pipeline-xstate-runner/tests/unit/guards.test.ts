import { describe, expect, it } from 'vitest';
import {
  ALL_GUARDS,
  HUMAN_GUARDS,
  RUN_GUARDS,
  STEP_GUARDS,
  defineGuard,
} from '../../src/features/machines/machines.guards.js';
import { predicatesOf } from '../../src/features/machines/machines.guards.js';
import { formatGuards } from '../../src/features/report/report.utils.js';

describe('named guards', () => {
  it('every guard has a unique kebab-case id and a description', () => {
    const ids = ALL_GUARDS.flatMap(({ guards }) => guards.map((guard) => guard.id));
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/));
    ALL_GUARDS.flatMap(({ guards }) => guards).forEach((guard) =>
      expect(guard.description.length).toBeGreaterThan(10),
    );
  });

  it("the four ways a route can be refused are guards of the run machine, in the recorder's order", () => {
    expect([
      RUN_GUARDS.eventIsUnknown.id,
      RUN_GUARDS.conditionIsInvalid.id,
      RUN_GUARDS.fallbackIsMissing.id,
      RUN_GUARDS.capIsSpent.id,
    ]).toEqual(['event-is-unknown', 'condition-is-invalid', 'fallback-is-missing', 'cap-is-spent']);
  });

  it('predicatesOf keeps the keys and the checks', () => {
    const guard = defineGuard<{ n: number }>({ id: 'n-is-positive', description: 'n > 0.' })(
      ({ context }) => context.n > 0,
    );
    const predicates = predicatesOf({ positive: guard });
    expect(predicates.positive({ context: { n: 1 }, event: { type: 'x' } })).toBe(true);
    expect(predicates.positive({ context: { n: 0 }, event: { type: 'x' } })).toBe(false);
  });

  it('--list-guards prints every machine and guard', () => {
    const text = formatGuards(ALL_GUARDS);
    expect(text).toContain('run machine');
    expect(text).toContain('step machine');
    expect(text).toContain('human-step machine');
    [
      ...Object.values(RUN_GUARDS),
      ...Object.values(STEP_GUARDS),
      ...Object.values(HUMAN_GUARDS),
    ].forEach((guard) => expect(text).toContain(guard.id));
  });
});
