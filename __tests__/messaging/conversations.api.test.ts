// __tests__/messaging/conversations.api.test.ts
/**
 * @jest-environment node
 */
import fc from 'fast-check';
import { GET, POST } from '@/app/api/conversations/route';

// Mock supabase-admin
jest.mock('@/lib/supabase-admin', () => {
  const mockFrom = jest.fn();
  return {
    supabaseAdmin: {
      from: mockFrom,
    },
    __mockFrom: mockFrom,
  };
});

import { supabaseAdmin } from '@/lib/supabase-admin';
const mockFrom = supabaseAdmin.from as jest.Mock;

// Helper to create a mock chainable Supabase query
function mockChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, jest.Mock> = {};
  const methods = ['select', 'eq', 'in', 'neq', 'order', 'limit', 'maybeSingle', 'single', 'insert', 'update', 'returns', 'ilike', 'or'];
  methods.forEach(m => {
    chain[m] = jest.fn().mockReturnValue(chain);
  });
  // Default resolve values
  chain.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
  chain.single = jest.fn().mockResolvedValue({ data: null, error: null });
  Object.assign(chain, overrides);
  return chain;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── GET Tests ───────────────────────────────────────────────────────────────

describe('GET /api/conversations', () => {
  test('returns 400 when referenceId is missing', async () => {
    const req = new Request('http://localhost/api/conversations');
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test('returns 400 when referenceId is empty string', async () => {
    const req = new Request('http://localhost/api/conversations?referenceId=');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  test('returns 200 with empty array when user has no conversations', async () => {
    const chain = mockChain();
    chain.select = jest.fn().mockReturnValue(chain);
    chain.eq = jest.fn().mockResolvedValue({ data: [], error: null });
    mockFrom.mockReturnValue(chain);

    const req = new Request('http://localhost/api/conversations?referenceId=REF1');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test('returns 500 when Supabase throws', async () => {
    const chain = mockChain();
    chain.eq = jest.fn().mockResolvedValue({ data: null, error: new Error('DB error') });
    chain.select = jest.fn().mockReturnValue(chain);
    mockFrom.mockReturnValue(chain);

    const req = new Request('http://localhost/api/conversations?referenceId=REF1');
    const res = await GET(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    // Must not expose internal details
    expect(body.error).not.toContain('DB error');
  });
});

// ─── POST Tests ──────────────────────────────────────────────────────────────

describe('POST /api/conversations', () => {
  test('returns 400 when user1RefId is missing', async () => {
    const req = new Request('http://localhost/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user2RefId: 'REF2' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/user1RefId/);
  });

  test('returns 400 when user2RefId is missing', async () => {
    const req = new Request('http://localhost/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user1RefId: 'REF1' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/user2RefId/);
  });

  test('returns 200 with existing conversation when pair already exists', async () => {
    const existingConv = { id: 'conv-uuid', conversation_type: 'direct', created_by: 'REF1', last_message_at: new Date().toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };

    // Mock: both users have conversation_id 'conv-uuid'
    const participantChain = mockChain();
    participantChain.eq = jest.fn().mockResolvedValue({ data: [{ conversation_id: 'conv-uuid' }], error: null });
    participantChain.select = jest.fn().mockReturnValue(participantChain);

    // Mock: existing direct conv found
    const convChain = mockChain();
    convChain.maybeSingle = jest.fn().mockResolvedValue({ data: existingConv, error: null });
    convChain.select = jest.fn().mockReturnValue(convChain);
    convChain.in = jest.fn().mockReturnValue(convChain);
    convChain.eq = jest.fn().mockReturnValue(convChain);
    convChain.limit = jest.fn().mockReturnValue(convChain);

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount <= 2) return participantChain; // first two calls for participants
      return convChain; // third call for conversations
    });

    const req = new Request('http://localhost/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user1RefId: 'REF1', user2RefId: 'REF2' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('conv-uuid');
  });

  test('returns 500 with generic message when Supabase throws', async () => {
    const chain = mockChain();
    chain.eq = jest.fn().mockResolvedValue({ data: null, error: new Error('connection failed') });
    chain.select = jest.fn().mockReturnValue(chain);
    mockFrom.mockReturnValue(chain);

    const req = new Request('http://localhost/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user1RefId: 'REF1', user2RefId: 'REF2' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toContain('connection failed');
  });
});

// Feature: biolog-messaging-webrtc, Property 7: Direct conversation creation is idempotent
describe('Property 7: Direct conversation creation is idempotent', () => {
  test('POST /api/conversations returns same id for same pair (mock returns existing)', async () => {
    await fc.assert(fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
      fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
      async (ref1, ref2) => {
        const existingConv = { id: 'idempotent-uuid', conversation_type: 'direct', created_by: ref1, last_message_at: new Date().toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };

        const participantChain = mockChain();
        participantChain.eq = jest.fn().mockResolvedValue({ data: [{ conversation_id: 'idempotent-uuid' }], error: null });
        participantChain.select = jest.fn().mockReturnValue(participantChain);

        const convChain = mockChain();
        convChain.maybeSingle = jest.fn().mockResolvedValue({ data: existingConv, error: null });
        convChain.select = jest.fn().mockReturnValue(convChain);
        convChain.in = jest.fn().mockReturnValue(convChain);
        convChain.eq = jest.fn().mockReturnValue(convChain);
        convChain.limit = jest.fn().mockReturnValue(convChain);

        let callCount = 0;
        mockFrom.mockImplementation(() => {
          callCount++;
          return callCount <= 2 ? participantChain : convChain;
        });

        const makeReq = () => new Request('http://localhost/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user1RefId: ref1, user2RefId: ref2 }),
        });

        callCount = 0;
        const res1 = await POST(makeReq());
        const body1 = await res1.json();

        callCount = 0;
        const res2 = await POST(makeReq());
        const body2 = await res2.json();

        return body1.id === body2.id && body1.id === 'idempotent-uuid';
      }
    ), { numRuns: 20 });
  });
});
