import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordToolCall, countToolCalls } from '../src/tool_call_writer.js';

const mockQuery = vi.fn();

vi.mock('../src/db.js', () => ({
  getPool: () => ({
    query: (...args: unknown[]) => mockQuery(...args),
  }),
}));

describe('recordToolCall', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [{ id: 'tc-uuid-123' }] });
  });

  it('returns an id on success', async () => {
    const id = await recordToolCall({
      run_id: 'run-1',
      agent: 'search_agent',
      tool_name: 'search',
      query: 'acme corp',
      request: { query: 'acme corp' },
      response: { results: 10 },
      duration_ms: 340,
      status: 'ok',
    });

    expect(id).toBe('tc-uuid-123');
    expect(mockQuery).toHaveBeenCalledTimes(1);

    // Verify the SQL contains expected columns
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('tool_call');
    expect(sql).toContain('agent');
    expect(sql).toContain('tool_name');
    expect(sql).toContain('duration_ms');
  });

  it('handles missing optional fields', async () => {
    const id = await recordToolCall({
      run_id: 'run-1',
      agent: 'search_agent',
      tool_name: 'fetch',
      request: { url: 'https://example.com' },
      duration_ms: 500,
      status: 'error',
    });

    expect(id).toBe('tc-uuid-123');
  });
});

describe('countToolCalls', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('returns numeric count', async () => {
    mockQuery.mockResolvedValue({ rows: [{ count: '7' }] });

    const count = await countToolCalls('run-1', 'search');
    expect(count).toBe(7);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('returns zero when no calls exist', async () => {
    mockQuery.mockResolvedValue({ rows: [{ count: '0' }] });

    const count = await countToolCalls('run-1', 'fetch');
    expect(count).toBe(0);
  });
});
