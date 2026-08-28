/**
 * @jest-environment node
 */
// __tests__/messaging/users.search.api.test.ts
import fc from 'fast-check';
import { GET } from '@/app/api/users/search/route';

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

import { supabaseAdmin } from '@/lib/supabase-admin';
const mockFrom = supabaseAdmin.from as jest.Mock;

function makeChain(finalData: unknown[] = []) {
  const chain: Record<string, jest.Mock> = {};
  const methods = ['select', 'eq', 'neq', 'in', 'order', 'ilike', 'or', 'limit'];
  methods.forEach(m => { chain[m] = jest.fn().mockReturnValue(chain); });
  chain.limit = jest.fn().mockResolvedValue({ data: finalData, error: null });
  return chain;
}

beforeEach(() => jest.clearAllMocks());

describe('GET /api/users/search', () => {
  test('returns 400 when keyword is missing', async () => {
    const req = new Request('http://localhost/api/users/search');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  test('returns 400 when keyword is empty string', async () => {
    const req = new Request('http://localhost/api/users/search?keyword=');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  test('returns 400 when keyword is all whitespace', async () => {
    const req = new Request('http://localhost/api/users/search?keyword=%20%20%20');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  test('returns 400 when keyword exceeds 200 chars', async () => {
    const longKeyword = 'a'.repeat(201);
    const req = new Request(`http://localhost/api/users/search?keyword=${longKeyword}`);
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test('returns 200 with mocked user array for valid keyword', async () => {
    const mockUsers = [
      { id: 1, ReferenceID: 'REF1', Firstname: 'John', Lastname: 'Doe' },
    ];
    const chain = makeChain(mockUsers);
    mockFrom.mockReturnValue(chain);

    const req = new Request('http://localhost/api/users/search?keyword=John');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test('returns 500 on Supabase error', async () => {
    const chain: Record<string, jest.Mock> = {};
    const methods = ['select', 'eq', 'neq', 'in', 'order', 'ilike', 'or'];
    methods.forEach(m => { chain[m] = jest.fn().mockReturnValue(chain); });
    chain.limit = jest.fn().mockResolvedValue({ data: null, error: new Error('db error') });
    mockFrom.mockReturnValue(chain);

    const req = new Request('http://localhost/api/users/search?keyword=test');
    const res = await GET(req);
    expect(res.status).toBe(500);
  });
});

// Feature: biolog-messaging-webrtc, Property 9: User search rejects all-whitespace keywords
// Validates: Requirements 4.3
describe('Property 9: User search rejects all-whitespace keywords', () => {
  test('GET returns 400 for any all-whitespace keyword', async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 1, maxLength: 50 }).map(chars => chars.join('')),
      async (keyword) => {
        const req = new Request(
          `http://localhost/api/users/search?keyword=${encodeURIComponent(keyword)}`
        );
        const res = await GET(req);
        return res.status === 400;
      }
    ), { numRuns: 100 });
  });
});
