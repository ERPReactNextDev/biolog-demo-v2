// __tests__/messaging/messages.api.test.ts
/**
 * @jest-environment node
 */
// Unit + property-based tests for app/api/messages/route.ts
// Mocks @/lib/supabase-admin — no real DB calls are made.

import fc from 'fast-check';
import { GET, POST, PATCH } from '@/app/api/messages/route';

// ---------------------------------------------------------------------------
// Mock supabase-admin
// ---------------------------------------------------------------------------
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

import { supabaseAdmin } from '@/lib/supabase-admin';
const mockFrom = supabaseAdmin.from as jest.Mock;

// ---------------------------------------------------------------------------
// Chain builder helpers
// ---------------------------------------------------------------------------

/**
 * makeChain builds a chainable mock where every method returns the same
 * chain object. Override the terminal calls (maybeSingle / single / limit /
 * returns) after calling makeChain to control what each handler receives.
 */
function makeChain() {
  const chain: Record<string, jest.Mock> = {};
  const methods = [
    'select', 'eq', 'neq', 'in', 'order', 'limit',
    'maybeSingle', 'single', 'insert', 'update', 'returns',
    'or', 'ilike',
  ];
  methods.forEach((m) => {
    chain[m] = jest.fn().mockReturnValue(chain);
  });
  return chain;
}

/**
 * resolveWith makes the named terminal method resolve with the given value.
 */
function resolveWith(
  chain: Record<string, jest.Mock>,
  method: string,
  value: unknown,
) {
  chain[method] = jest.fn().mockReturnValue(chain);
  // Overwrite to resolve with value when called
  const orig = chain[method];
  chain[method] = jest.fn().mockResolvedValue(value);
  return orig; // not used, but returned for symmetry
}

beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// GET /api/messages
// ---------------------------------------------------------------------------

describe('GET /api/messages', () => {
  test('returns 400 when conversationId is missing', async () => {
    const req = new Request('http://localhost/api/messages');
    const res = await GET(req as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test('returns 400 when conversationId is empty string', async () => {
    const req = new Request('http://localhost/api/messages?conversationId=');
    const res = await GET(req as never);
    expect(res.status).toBe(400);
  });

  test('returns 400 when conversationId is whitespace', async () => {
    const req = new Request('http://localhost/api/messages?conversationId=%20');
    const res = await GET(req as never);
    expect(res.status).toBe(400);
  });

  test('returns 404 when conversation does not exist (maybeSingle → null)', async () => {
    // The route checks conversations first via .maybeSingle()
    const convChain = makeChain();
    convChain.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
    mockFrom.mockReturnValue(convChain);

    const req = new Request('http://localhost/api/messages?conversationId=nonexistent-uuid');
    const res = await GET(req as never);
    expect(res.status).toBe(404);
  });

  test('returns 500 when conversation lookup has a DB error', async () => {
    const convChain = makeChain();
    convChain.maybeSingle = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'db error' },
    });
    mockFrom.mockReturnValue(convChain);

    const req = new Request('http://localhost/api/messages?conversationId=some-uuid');
    const res = await GET(req as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toContain('db error'); // no internals exposed
  });

  test('returns 200 with message array when conversation exists', async () => {
    const msgData = [
      {
        id: 'msg-1',
        conversation_id: 'conv-1',
        sender_id: 'REF1',
        message_type: 'text',
        content: 'hello',
        is_edited: false,
        is_deleted: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    // First call → conversations chain (maybeSingle resolves with a row)
    const convChain = makeChain();
    convChain.maybeSingle = jest.fn().mockResolvedValue({ data: { id: 'conv-1' }, error: null });

    // Second call → messages chain (.limit(100) is the terminal call)
    const msgChain = makeChain();
    msgChain.limit = jest.fn().mockResolvedValue({ data: msgData, error: null });

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      return callCount === 1 ? convChain : msgChain;
    });

    const req = new Request('http://localhost/api/messages?conversationId=conv-1');
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('msg-1');
  });

  test('returns 200 with empty array when conversation exists but has no messages', async () => {
    const convChain = makeChain();
    convChain.maybeSingle = jest.fn().mockResolvedValue({ data: { id: 'conv-empty' }, error: null });

    const msgChain = makeChain();
    msgChain.limit = jest.fn().mockResolvedValue({ data: [], error: null });

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      return callCount === 1 ? convChain : msgChain;
    });

    const req = new Request('http://localhost/api/messages?conversationId=conv-empty');
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  test('returns 500 when messages query has a DB error', async () => {
    const convChain = makeChain();
    convChain.maybeSingle = jest.fn().mockResolvedValue({ data: { id: 'conv-1' }, error: null });

    const msgChain = makeChain();
    msgChain.limit = jest.fn().mockResolvedValue({ data: null, error: { message: 'query failed' } });

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      return callCount === 1 ? convChain : msgChain;
    });

    const req = new Request('http://localhost/api/messages?conversationId=conv-1');
    const res = await GET(req as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toContain('query failed'); // no internals exposed
  });
});

// ---------------------------------------------------------------------------
// POST /api/messages
// ---------------------------------------------------------------------------

describe('POST /api/messages', () => {
  test('returns 400 when body is not valid JSON', async () => {
    const req = new Request('http://localhost/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  test('returns 400 when conversationId is missing', async () => {
    const req = new Request('http://localhost/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senderRefId: 'REF1', content: 'hello' }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test('returns 400 when senderRefId is missing', async () => {
    const req = new Request('http://localhost/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conv-1', content: 'hello' }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test('returns 400 when content is missing', async () => {
    const req = new Request('http://localhost/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conv-1', senderRefId: 'REF1' }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test('returns 400 when content is empty string', async () => {
    const req = new Request('http://localhost/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conv-1', senderRefId: 'REF1', content: '' }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  test('returns 400 when content is whitespace only', async () => {
    const req = new Request('http://localhost/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conv-1', senderRefId: 'REF1', content: '   ' }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  test('returns 400 when content exceeds 2000 chars', async () => {
    const req = new Request('http://localhost/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: 'conv-1',
        senderRefId: 'REF1',
        content: 'x'.repeat(2001),
      }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  test('returns 400 when content is exactly 2001 chars (boundary)', async () => {
    const req = new Request('http://localhost/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: 'conv-1',
        senderRefId: 'REF1',
        content: 'a'.repeat(2001),
      }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  test('returns 201 when all fields are valid (content at boundary: 2000 chars)', async () => {
    const insertedMessage = {
      id: 'msg-new',
      conversation_id: 'conv-1',
      sender_id: 'REF1',
      message_type: 'text',
      content: 'a'.repeat(2000),
      is_edited: false,
      is_deleted: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      sender: { id: 1, ReferenceID: 'REF1', Firstname: 'Alice', Lastname: 'Smith' },
    };

    // POST handler: from('messages').insert({...}).select(...).single()
    const insertChain = makeChain();
    insertChain.single = jest.fn().mockResolvedValue({ data: insertedMessage, error: null });
    mockFrom.mockReturnValue(insertChain);

    const req = new Request('http://localhost/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: 'conv-1',
        senderRefId: 'REF1',
        content: 'a'.repeat(2000),
      }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe('msg-new');
    expect(body.content).toHaveLength(2000);
  });

  test('returns 201 with default messageType "text" when not specified', async () => {
    const insertedMessage = {
      id: 'msg-2',
      conversation_id: 'conv-1',
      sender_id: 'REF1',
      message_type: 'text',
      content: 'hello world',
      is_edited: false,
      is_deleted: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const insertChain = makeChain();
    insertChain.single = jest.fn().mockResolvedValue({ data: insertedMessage, error: null });
    mockFrom.mockReturnValue(insertChain);

    const req = new Request('http://localhost/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conv-1', senderRefId: 'REF1', content: 'hello world' }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.message_type).toBe('text');
  });

  test('returns 500 when DB insert fails', async () => {
    const insertChain = makeChain();
    insertChain.single = jest.fn().mockResolvedValue({ data: null, error: { message: 'insert failed' } });
    mockFrom.mockReturnValue(insertChain);

    const req = new Request('http://localhost/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conv-1', senderRefId: 'REF1', content: 'hello' }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toContain('insert failed'); // no internals exposed
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/messages
// ---------------------------------------------------------------------------

describe('PATCH /api/messages', () => {
  test('returns 400 when conversationId is missing', async () => {
    const req = new Request('http://localhost/api/messages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referenceId: 'REF1' }),
    });
    const res = await PATCH(req as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test('returns 400 when referenceId is missing', async () => {
    const req = new Request('http://localhost/api/messages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conv-1' }),
    });
    const res = await PATCH(req as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test('returns 400 when body is invalid JSON', async () => {
    const req = new Request('http://localhost/api/messages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const res = await PATCH(req as never);
    expect(res.status).toBe(400);
  });

  test('returns 404 when participant not found (0 rows updated)', async () => {
    // First call: find latest message
    const latestMsgChain = makeChain();
    latestMsgChain.maybeSingle = jest.fn().mockResolvedValue({ data: { id: 'msg-uuid' }, error: null });

    // Second call: update participant → .returns() resolves with empty array
    const updateChain = makeChain();
    updateChain.returns = jest.fn().mockResolvedValue({ data: [], error: null });

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      return callCount === 1 ? latestMsgChain : updateChain;
    });

    const req = new Request('http://localhost/api/messages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conv-1', referenceId: 'REF_MISSING' }),
    });
    const res = await PATCH(req as never);
    expect(res.status).toBe(404);
  });

  test('returns 200 with updated participant when all is valid', async () => {
    const updatedParticipant = {
      conversation_id: 'conv-1',
      user_id: 'REF1',
      last_read_message_id: 'msg-latest',
      last_seen_at: new Date().toISOString(),
    };

    // First call: find latest message
    const latestMsgChain = makeChain();
    latestMsgChain.maybeSingle = jest.fn().mockResolvedValue({ data: { id: 'msg-latest' }, error: null });

    // Second call: update participant → .returns() resolves with one row
    const updateChain = makeChain();
    updateChain.returns = jest.fn().mockResolvedValue({ data: [updatedParticipant], error: null });

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      return callCount === 1 ? latestMsgChain : updateChain;
    });

    const req = new Request('http://localhost/api/messages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conv-1', referenceId: 'REF1' }),
    });
    const res = await PATCH(req as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.last_read_message_id).toBe('msg-latest');
  });

  test('returns 200 even when no latest message exists (empty conversation)', async () => {
    // Conversation has no messages yet → maybeSingle returns null
    const latestMsgChain = makeChain();
    latestMsgChain.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });

    const updatedParticipant = {
      conversation_id: 'conv-empty',
      user_id: 'REF1',
      last_read_message_id: null,
      last_seen_at: new Date().toISOString(),
    };
    const updateChain = makeChain();
    updateChain.returns = jest.fn().mockResolvedValue({ data: [updatedParticipant], error: null });

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      return callCount === 1 ? latestMsgChain : updateChain;
    });

    const req = new Request('http://localhost/api/messages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conv-empty', referenceId: 'REF1' }),
    });
    const res = await PATCH(req as never);
    expect(res.status).toBe(200);
  });

  test('returns 500 when latest-message query has a DB error', async () => {
    const latestMsgChain = makeChain();
    latestMsgChain.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: { message: 'db error' } });
    mockFrom.mockReturnValue(latestMsgChain);

    const req = new Request('http://localhost/api/messages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conv-1', referenceId: 'REF1' }),
    });
    const res = await PATCH(req as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toContain('db error'); // no internals exposed
  });

  test('returns 500 when participant update has a DB error', async () => {
    const latestMsgChain = makeChain();
    latestMsgChain.maybeSingle = jest.fn().mockResolvedValue({ data: { id: 'msg-1' }, error: null });

    const updateChain = makeChain();
    updateChain.returns = jest.fn().mockResolvedValue({ data: null, error: { message: 'update failed' } });

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      return callCount === 1 ? latestMsgChain : updateChain;
    });

    const req = new Request('http://localhost/api/messages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conv-1', referenceId: 'REF1' }),
    });
    const res = await PATCH(req as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toContain('update failed'); // no internals exposed
  });
});

// ---------------------------------------------------------------------------
// Feature: biolog-messaging-webrtc, Property 8: Message content validation boundary
// Validates: Requirements 3.5
// ---------------------------------------------------------------------------

describe('Property 8: message content validation boundary', () => {
  // Content > 2000 chars must always be rejected with HTTP 400
  test('POST rejects content longer than 2000 chars (no DB call needed)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 2001, maxLength: 3000 }),
        async (content) => {
          const req = new Request('http://localhost/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversationId: 'conv-uuid', senderRefId: 'REF1', content }),
          });
          const res = await POST(req as never);
          return res.status === 400;
        },
      ),
      { numRuns: 50 },
    );
  });

  // Content within 1..2000 chars with valid companion fields must NOT be
  // rejected with 400 due to content length (validation passes; any 400 here
  // would be a logic error). We skip DB setup — validation happens before DB.
  // We verify only that the route does NOT return 400 due to content length.
  // (It may reach DB and get 500 with mock returning nothing, that's fine.)
  test('POST does not reject valid content length (1–2000 chars)', async () => {
    // Setup a generic DB stub so the route can proceed past validation
    const insertChain = makeChain();
    insertChain.single = jest.fn().mockResolvedValue({
      data: {
        id: 'msg-ok',
        conversation_id: 'conv-uuid',
        sender_id: 'REF1',
        message_type: 'text',
        content: 'x',
        is_edited: false,
        is_deleted: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      error: null,
    });
    mockFrom.mockReturnValue(insertChain);

    await fc.assert(
      fc.asyncProperty(
        // Generate a string of 1–2000 printable non-whitespace-only chars
        fc.string({ minLength: 1, maxLength: 2000 }).filter((s) => s.trim().length > 0),
        async (content) => {
          jest.clearAllMocks();
          mockFrom.mockReturnValue(insertChain);

          const req = new Request('http://localhost/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversationId: 'conv-uuid', senderRefId: 'REF1', content }),
          });
          const res = await POST(req as never);
          // The route must NOT return 400 (content-length validation must pass)
          return res.status !== 400;
        },
      ),
      { numRuns: 50 },
    );
  });
});
