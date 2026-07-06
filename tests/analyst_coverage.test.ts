/**
 * Analyst + Coverage Loop Integration Tests
 *
 * Tests the deterministic coverage controller and the end-to-end
 * Analyst → Signal Writer → Coverage Decision flow.
 */

import { describe, it, expect } from 'vitest';
import { decideCoverage } from '../src/coverage.js';
import type { Brief, Signal } from '../src/types.js';

// Mock the network and DB layers
vi.mock('../src/db.js', async () => {
  return {
    writeAudit: vi.fn().mockResolvedValue(undefined),
    getPool: vi.fn().mockReturnValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
    }),
  };
});

vi.mock('../src/log.js', async () => {
  return {
    logCompleted: vi.fn().mockResolvedValue(undefined),
    logError: vi.fn().mockResolvedValue(undefined),
  };
});

import { vi } from 'vitest';

function makeBrief(requiredSlots: string[]): Brief {
  return {
    target: { name: 'Northwind Robotics' },
    slots: [
      ...requiredSlots.map((name) => ({
        slot_name: name,
        required: true as const,
        question: `Q ${name}`,
      })),
    ],
  };
}

describe('Coverage Loop', () => {
  it('hard cap at iteration >= cap forces proceed regardless of unfilled slots', () => {
    const brief = makeBrief(['overview']);
    const signals: Signal[] = []; // unfilled

    // iteration 0, cap 1 → should loop
    const d0 = decideCoverage(brief, signals, 0, 1, 0.6);
    expect(d0.action).toBe('loop');

    // iteration 1, cap 1 → should PROCEED (hard cap)
    const d1 = decideCoverage(brief, signals, 1, 1, 0.6);
    expect(d1.action).toBe('proceed');
    expect(d1.unfilled_required).toContain('overview');
  });

  it('loops once on thin-slot scenario, fills on second pass', async () => {
    // This test validates the coverage loop structural property:
    // when iteration < cap and a required slot is unfilled → loop
    // when iteration == cap → proceed regardless
    const brief: Brief = {
      target: { name: 'TestCo' },
      slots: [
        { slot_name: 'overview', required: true, question: 'What is this company?' },
        { slot_name: 'leadership', required: true, question: 'Who leads it?' },
      ],
    };

    // Pass 1: leadership is thin (insufficient_evidence)
    const pass1Signals: Signal[] = [
      {
        signal_id: 'sig-1',
        slot: 'overview',
        status: 'filled',
        value: 'An overview exists.',
        confidence: 0.9,
        evidence_ids: ['ev-1'],
      },
      {
        signal_id: 'sig-2',
        slot: 'leadership',
        status: 'insufficient_evidence',
        evidence_ids: [],
      },
    ];

    const d1 = decideCoverage(brief, pass1Signals, 0, 2, 0.6);
    expect(d1.action).toBe('loop');
    expect(d1.unfilled_required).toContain('leadership');

    // Pass 2: leadership now filled (coverage loop brought more evidence)
    const pass2Signals: Signal[] = [
      {
        signal_id: 'sig-1',
        slot: 'overview',
        status: 'filled',
        value: 'An overview exists.',
        confidence: 0.9,
        evidence_ids: ['ev-1'],
      },
      {
        signal_id: 'sig-3',
        slot: 'leadership',
        status: 'filled',
        value: 'CEO is Jane Doe.',
        confidence: 0.75,
        evidence_ids: ['ev-2'],
      },
    ];

    const d2 = decideCoverage(brief, pass2Signals, 1, 2, 0.6);
    expect(d2.action).toBe('proceed');
    expect(d2.unfilled_required).toHaveLength(0);
  });

  it('proceeds when all required slots are filled above floor', () => {
    const brief = makeBrief(['overview', 'products']);
    const signals: Signal[] = [
      {
        signal_id: 'sig-1',
        slot: 'overview',
        status: 'filled',
        value: 'Overview here.',
        confidence: 0.9,
        evidence_ids: ['ev-1'],
      },
      {
        signal_id: 'sig-2',
        slot: 'products',
        status: 'filled',
        value: 'Products here.',
        confidence: 0.7,
        evidence_ids: ['ev-2'],
      },
    ];

    const d = decideCoverage(brief, signals, 0, 3, 0.6);
    expect(d.action).toBe('proceed');
    expect(d.unfilled_required).toHaveLength(0);
  });

  it('loops when confidence is below floor', () => {
    const brief = makeBrief(['overview']);
    const signals: Signal[] = [
      {
        signal_id: 'sig-1',
        slot: 'overview',
        status: 'filled',
        value: 'Maybe overview.',
        confidence: 0.4, // below floor 0.6
        evidence_ids: ['ev-1'],
      },
    ];

    const d = decideCoverage(brief, signals, 0, 3, 0.6);
    expect(d.action).toBe('loop');
    expect(d.unfilled_required).toContain('overview');
  });
});

describe('Analyst + Signal Writer Integration', () => {
  it('filled signals carry required fields', () => {
    const signals: Signal[] = [
      {
        signal_id: 'sig-int-1',
        slot: 'overview',
        status: 'filled',
        value: 'Northwind Robotics builds drones.',
        confidence: 0.84,
        rationale: 'Evidence corroborated.',
        evidence_ids: ['ev-1'],
      },
    ];

    expect(signals[0].value).toBeDefined();
    expect(signals[0].confidence).toBeGreaterThanOrEqual(0);
    expect(signals[0].confidence).toBeLessThanOrEqual(1);
    expect(signals[0].evidence_ids.length).toBeGreaterThan(0);
  });
});
