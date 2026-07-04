import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizeBrief } from '../src/brief_normalizer.js';
import type { Brief } from '../src/types.js';

describe('normalizeBrief', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockOk(body: unknown) {
    const respContent = typeof body === 'string' ? body : JSON.stringify(body);
    return {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: respContent } }],
      }),
      text: vi.fn().mockResolvedValue(respContent),
    };
  }

  function mockApiError(status: number, text: string) {
    return {
      ok: false,
      status,
      json: vi.fn().mockRejectedValue(new Error('Not JSON')),
      text: vi.fn().mockResolvedValue(text),
    };
  }

  it('returns a valid brief on first pass', async () => {
    const brief: Brief = {
      target: { name: 'Northwind Robotics' },
      slots: [
        { slot_name: 'overview', required: true, question: 'What does the company do?' },
      ],
    };

    vi.mocked(fetch).mockResolvedValue(mockOk(brief) as unknown as Response);

    const result = await normalizeBrief(
      { target: 'Northwind Robotics' },
      { baseUrl: 'https://api.deepinfra.com/v1/openai', apiKey: 'test-key' }
    );

    expect(result.result.brief).toBeTruthy();
    expect(result.result.brief!.target.name).toBe('Northwind Robotics');
    expect(result.result.clarify).toBeNull();
    expect(result.attempts).toBe(1);
  });

  it('returns clarify on unresolvable target', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockOk({ status: 'unresolvable', reason: 'Ambiguous target name' }) as unknown as Response
    );

    const result = await normalizeBrief(
      { target: 'Apple' },
      { baseUrl: 'https://api.deepinfra.com/v1/openai', apiKey: 'test-key' }
    );

    expect(result.result.brief).toBeNull();
    expect(result.result.clarify).toEqual({ status: 'clarify', reason: 'Ambiguous target name' });
    expect(result.attempts).toBe(1);
  });

  it('repairs once on schema failure then succeeds', async () => {
    let callCount = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // First call returns invalid schema (missing required "slots")
        return mockOk({ target: { name: 'BadCo' } }) as unknown as Response;
      }
      // Second call returns valid brief
      const brief: Brief = {
        target: { name: 'BadCo' },
        slots: [
          { slot_name: 'overview', required: true, question: 'What does the company do?' },
        ],
      };
      return mockOk(brief) as unknown as Response;
    });

    const result = await normalizeBrief(
      { target: 'BadCo' },
      { baseUrl: 'https://api.deepinfra.com/v1/openai', apiKey: 'test-key' }
    );

    expect(result.result.brief).toBeTruthy();
    expect(result.result.brief!.target.name).toBe('BadCo');
    expect(result.attempts).toBe(2);
    expect(callCount).toBe(2);
  });

  it('throws after two schema failures', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockOk({ target: { name: 'BadCo' } }) as unknown as Response
    );

    await expect(
      normalizeBrief(
        { target: 'BadCo' },
        { baseUrl: 'https://api.deepinfra.com/v1/openai', apiKey: 'test-key' }
      )
    ).rejects.toThrow(/failed schema validation after repair/);

    expect(vi.mocked(fetch).mock.calls.length).toBe(2);
  });

  it('throws on DeepInfra API error', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockApiError(500, 'Internal server error') as unknown as Response
    );

    await expect(
      normalizeBrief(
        { target: 'SomeCo' },
        { baseUrl: 'https://api.deepinfra.com/v1/openai', apiKey: 'test-key' }
      )
    ).rejects.toThrow(/DeepInfra API error 500/);
  });
});
