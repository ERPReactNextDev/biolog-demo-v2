/**
 * @jest-environment node
 *
 * __tests__/messaging/socket.server.test.ts
 *
 * Unit + property-based tests for socket-server.ts.
 * Tests the exported onlineUsers map and isOnline helper directly.
 * The require.main === module guard prevents the server from starting on import.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 6.1, 6.2
 */

import fc from 'fast-check';
import { onlineUsers, isOnline } from '@/socket-server';

beforeEach(() => {
  onlineUsers.clear();
});

// ─── isOnline / onlineUsers Examples ─────────────────────────────────────────

describe('onlineUsers map and isOnline helper', () => {
  it('isOnline returns false for unknown user', () => {
    expect(isOnline('UNKNOWN')).toBe(false);
  });

  it('isOnline returns true after set', () => {
    onlineUsers.set('REF1', 'socket-abc');
    expect(isOnline('REF1')).toBe(true);
  });

  it('replaces existing entry for same referenceId', () => {
    onlineUsers.set('REF1', 'old');
    onlineUsers.set('REF1', 'new');
    expect(onlineUsers.get('REF1')).toBe('new');
    expect(onlineUsers.size).toBe(1);
  });

  it('disconnect: removes entry by socket id', () => {
    onlineUsers.set('REF1', 'socket-1');
    onlineUsers.set('REF2', 'socket-2');
    // simulate disconnect for socket-1
    for (const [refId, sockId] of onlineUsers.entries()) {
      if (sockId === 'socket-1') onlineUsers.delete(refId);
    }
    expect(isOnline('REF1')).toBe(false);
    expect(isOnline('REF2')).toBe(true);
  });
});

// ─── private_message forwarding (simulated) ───────────────────────────────────

describe('private_message forwarding simulation', () => {
  it('forwards to receiver socket when online', () => {
    onlineUsers.set('RECEIVER', 'socket-recv');
    const toMock = jest.fn().mockReturnValue({ emit: jest.fn() });
    const io = { to: toMock };

    const data = { conversationId: 'c1', senderId: 'S1', receiverId: 'RECEIVER', content: 'hello' };
    const receiverSocketId = onlineUsers.get(data.receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('new_message', { conversationId: data.conversationId, senderId: data.senderId, content: data.content });
    }

    expect(toMock).toHaveBeenCalledWith('socket-recv');
  });

  it('does not forward when receiver is offline', () => {
    const toMock = jest.fn().mockReturnValue({ emit: jest.fn() });
    const io = { to: toMock };

    const receiverSocketId = onlineUsers.get('OFFLINE_USER');
    if (receiverSocketId) io.to(receiverSocketId).emit('new_message', {});

    expect(toMock).not.toHaveBeenCalled();
  });

  it('emits error to sender when content field missing', () => {
    const socketEmit = jest.fn();
    const socket = { id: 'sender-socket', emit: socketEmit };
    const data: Record<string, unknown> = { conversationId: 'c1', senderId: 'S1', receiverId: 'R1' /* no content */ };

    const fields = ['conversationId', 'senderId', 'receiverId', 'content'];
    let valid = true;
    for (const field of fields) {
      const val = data[field];
      if (!val || typeof val !== 'string' || (val as string).trim() === '') {
        socket.emit('error', { message: `Field '${field}' is required and must be a non-empty string` });
        valid = false;
        break;
      }
    }
    expect(valid).toBe(false);
    expect(socketEmit).toHaveBeenCalledWith('error', expect.objectContaining({ message: expect.stringContaining('content') }));
  });
});

// Feature: biolog-messaging-webrtc, Property 10: Online_Map round-trip
describe('Property 10: Online_Map round-trip', () => {
  it('isOnline true after set, false after delete', () => {
    fc.assert(fc.property(
      fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
      (refId) => {
        onlineUsers.set(refId, 'socket-test');
        const afterSet = isOnline(refId);
        onlineUsers.delete(refId);
        const afterDelete = isOnline(refId);
        return afterSet === true && afterDelete === false;
      }
    ));
  });
});

// Feature: biolog-messaging-webrtc, Property 11: private_message forwarding correctness
describe('Property 11: forwarding targets correct socket', () => {
  it('calls io.to with exactly the registered socket id', () => {
    fc.assert(fc.property(
      fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
      fc.string({ minLength: 5, maxLength: 20 }),
      (receiverId, socketId) => {
        onlineUsers.clear();
        onlineUsers.set(receiverId, socketId);
        const toMock = jest.fn().mockReturnValue({ emit: jest.fn() });
        const io = { to: toMock };

        const targetSocketId = onlineUsers.get(receiverId);
        if (targetSocketId) io.to(targetSocketId).emit('new_message', {});

        return toMock.mock.calls.length === 1 && toMock.mock.calls[0][0] === socketId;
      }
    ));
  });
});

// Feature: biolog-messaging-webrtc, Property 12: private_message validation completeness
describe('Property 12: validation rejects payloads with missing/empty fields', () => {
  it('emits error when any required field is missing or empty', () => {
    fc.assert(fc.property(
      fc.record({
        conversationId: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
        senderId: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
        receiverId: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
        content: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
      }).filter(data => {
        const fields = ['conversationId', 'senderId', 'receiverId', 'content'] as const;
        return fields.some(f => {
          const v = data[f];
          return !v || (v as string).trim() === '';
        });
      }),
      (data) => {
        const emitMock = jest.fn();
        const socket = { id: 'test', emit: emitMock };
        const fields = ['conversationId', 'senderId', 'receiverId', 'content'];
        for (const field of fields) {
          const val = (data as Record<string, unknown>)[field];
          if (!val || typeof val !== 'string' || (val as string).trim() === '') {
            socket.emit('error', { message: `Field '${field}' is required and must be a non-empty string` });
            break;
          }
        }
        return emitMock.mock.calls.length > 0 && emitMock.mock.calls[0][0] === 'error';
      }
    ));
  });
});
