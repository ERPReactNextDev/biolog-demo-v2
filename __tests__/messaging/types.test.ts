// __tests__/messaging/types.test.ts
import fc from 'fast-check';
import { getUserFullName, getUserInitials } from '@/lib/types';
import type { User } from '@/lib/types';

// Arbitrary that generates User objects matching all possible combinations
const userArb: fc.Arbitrary<User> = fc.record({
  id: fc.integer({ min: 1 }),
  ReferenceID: fc.string({ minLength: 2, maxLength: 20 }).filter(s => s.trim().length >= 2),
  Firstname: fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
  Lastname: fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
  userName: fc.option(fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0), { nil: undefined }),
}) as fc.Arbitrary<User>;

// Feature: biolog-messaging-webrtc, Property 1: getUserFullName fallback chain
test('getUserFullName returns correct value per fallback chain', () => {
  fc.assert(fc.property(userArb, (user) => {
    const result = getUserFullName(user);
    const first = (user.Firstname ?? '').trim();
    const last = (user.Lastname ?? '').trim();
    const expected =
      (first || last)
        ? [first, last].filter(Boolean).join(' ')
        : user.userName?.trim()
        ? user.userName.trim()
        : user.ReferenceID;
    return result === expected;
  }));
});

// Feature: biolog-messaging-webrtc, Property 2: getUserFullName is non-empty
test('getUserFullName is never empty', () => {
  fc.assert(fc.property(userArb, (user) => getUserFullName(user).length > 0));
});

// Feature: biolog-messaging-webrtc, Property 3: getUserFullName is deterministic
test('getUserFullName is deterministic', () => {
  fc.assert(fc.property(userArb, (user) => getUserFullName(user) === getUserFullName(user)));
});

// Feature: biolog-messaging-webrtc, Property 4: getUserInitials length and case
test('getUserInitials returns 1-2 uppercase chars', () => {
  fc.assert(fc.property(userArb, (user) => {
    const initials = getUserInitials(user);
    return initials.length >= 1 && initials.length <= 2 && initials === initials.toUpperCase();
  }));
});

// Feature: biolog-messaging-webrtc, Property 5: getUserInitials fallback chain
test('getUserInitials returns correct initials per fallback chain', () => {
  fc.assert(fc.property(userArb, (user) => {
    const first = (user.Firstname ?? '').trim();
    const last = (user.Lastname ?? '').trim();
    const initials = getUserInitials(user);
    if (first && last) return initials === (first[0] + last[0]).toUpperCase();
    if (first) return initials === first[0].toUpperCase();
    if (last) return initials === last[0].toUpperCase();
    return initials === user.ReferenceID.slice(0, 2).toUpperCase();
  }));
});

// Feature: biolog-messaging-webrtc, Property 6: getUserInitials is deterministic
test('getUserInitials is deterministic', () => {
  fc.assert(fc.property(userArb, (user) => getUserInitials(user) === getUserInitials(user)));
});
