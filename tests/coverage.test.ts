import { describe, it, expect } from 'vitest';
import { decideCoverage } from '../src/coverage.js';
import type { Brief, Signal } from '../src/types.js';

function makeBrief(requiredSlots: string[], optionalSlots: string[] = []): Brief {
  return {
    target: { name: 'TestCo' },
    slots: [
      ...requiredSlots.map((name) => ({
        slot_name: name,
        required: true as const,
        question: `Q ${name}`,
      })),
      ...optionalSlots.map((name) => ({
        slot_name: name,
        required: false as const,
        question: `Q ${name}`,
      })),
    ],
  };
}

describe('decideCoverage', () => {
  it('proceeds when all required slots are filled above floor', () => {
    const brief = makeBrief(['overview']);
    const signals: Signal[] = [
      {
        signal_id: 'sig-1',
        slot: 'overview',
        status: 'filled',
        value: 'text',
        confidence: 0.9,
        evidence_ids: ['ev-1'],
      },
    ];

    const decision = decideCoverage(brief, signals, 0, 3, 0.6);
    expect(decision.action).toBe('proceed');
    expect(decision.unfilled_required).toHaveLength(0);
  });

  it('proceeds when an optional slot is unfilled', () => {
    const brief = makeBrief(['overview'], ['funding']);
    const signals: Signal[] = [
      {
        signal_id: 'sig-1',
        slot: 'overview',
        status: 'filled',
        value: 'text',
        confidence: 0.9,
        evidence_ids: ['ev-1'],
      },
      {
        signal_id: 'sig-2',
        slot: 'funding',
        status: 'insufficient_evidence',
        evidence_ids: [],
      },
    ];

    const decision = decideCoverage(brief, signals, 0, 3, 0.6);
    expect(decision.action).toBe('proceed');
    expect(decision.unfilled_required).toHaveLength(0);
  });

  it('loops when a required slot is unfilled and budget remains', () => {
    const brief = makeBrief(['overview']);
    const signals: Signal[] = []; // no signal for overview

    const decision = decideCoverage(brief, signals, 0, 3, 0.6);
    expect(decision.action).toBe('loop');
    expect(decision.unfilled_required).toContain('overview');
  });

  it('proceeds when at cap even if required slot unfilled', () => {
    const brief = makeBrief(['overview']);
    const signals: Signal[] = []; // unfilled

    const decision = decideCoverage(brief, signals, 3, 3, 0.6);
    expect(decision.action).toBe('proceed');
    expect(decision.unfilled_required).toContain('overview');
  });

  it('loops when confidence is below floor', () => {
    const brief = makeBrief(['overview']);
    const signals: Signal[] = [
      {
        signal_id: 'sig-1',
        slot: 'overview',
        status: 'filled',
        value: 'text',
        confidence: 0.4, // below floor 0.6
        evidence_ids: ['ev-1'],
      },
    ];

    const decision = decideCoverage(brief, signals, 0, 3, 0.6);
    expect(decision.action).toBe('loop');
    expect(decision.unfilled_required).toContain('overview');
  });

  it('proceeds when confidence is exactly at floor', () => {
    const brief = makeBrief(['overview']);
    const signals: Signal[] = [
      {
        signal_id: 'sig-1',
        slot: 'overview',
        status: 'filled',
        value: 'text',
        confidence: 0.6,
        evidence_ids: ['ev-1'],
      },
    ];

    const decision = decideCoverage(brief, signals, 0, 3, 0.6);
    expect(decision.action).toBe('proceed');
  });

  it('loops when signal is abstaining', () => {
    const brief = makeBrief(['overview']);
    const signals: Signal[] = [
      {
        signal_id: 'sig-1',
        slot: 'overview',
        status: 'abstain',
        evidence_ids: [],
      },
    ];

    const decision = decideCoverage(brief, signals, 0, 3, 0.6);
    expect(decision.action).toBe('loop');
  });

  it('returns all unfilled required slot names', () => {
    const brief = makeBrief(['overview', 'products']);
    const signals: Signal[] = []; // both unfilled

    const decision = decideCoverage(brief, signals, 1, 3, 0.6);
    expect(decision.action).toBe('loop');
    expect(decision.unfilled_required).toEqual(['overview', 'products']);
  });
});
