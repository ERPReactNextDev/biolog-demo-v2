/**
 * socket-server.ts
 * Standalone Socket.IO server for the Biolog Messaging + WebRTC module.
 *
 * Start with:  npx ts-node socket-server.ts
 * Or compile:  tsc socket-server.ts && node socket-server.js
 *
 * Listens on SOCKET_PORT (default 3001).
 * This file is both executable (starts the HTTP + Socket.IO server when run as main)
 * and importable (exports onlineUsers, isOnline for unit tests).
 */

import * as http from 'http';
import { Server, Socket } from 'socket.io';

// ---------------------------------------------------------------------------
// Online_Map  ─  ReferenceID → socket.id
// Exported so unit tests can inspect and mutate it directly.
// ---------------------------------------------------------------------------
export const onlineUsers = new Map<string, string>();

// ---------------------------------------------------------------------------
// isOnline helper — exported for testability
// ---------------------------------------------------------------------------
export function isOnline(referenceId: string): boolean {
  return onlineUsers.has(referenceId);
}

// ---------------------------------------------------------------------------
// requireFields — validates that each named field exists, is a string, and is
// non-empty after trimming.  Emits an 'error' event to the socket and returns
// false on the first failing field; returns true if all fields pass.
// ---------------------------------------------------------------------------
function requireFields(
  data: Record<string, unknown>,
  fields: string[],
  socket: Socket
): boolean {
  for (const field of fields) {
    if (
      !data[field] ||
      typeof data[field] !== 'string' ||
      (data[field] as string).trim() === ''
    ) {
      socket.emit('error', {
        message: `Field '${field}' is required and must be a non-empty string`,
      });
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// requirePresent — validates that a field exists (non-null / non-undefined).
// Used for object fields such as RTCSessionDescriptionInit where string check
// is inappropriate.
// ---------------------------------------------------------------------------
function requirePresent(
  data: Record<string, unknown>,
  field: string,
  socket: Socket
): boolean {
  if (data[field] === null || data[field] === undefined) {
    socket.emit('error', {
      message: `Field '${field}' is required`,
    });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// createSocketServer — factory that attaches Socket.IO to an http.Server.
// Separated from the listen() call so tests can import without side-effects.
// ---------------------------------------------------------------------------
export function createSocketServer(httpServer: http.Server): Server {
  const io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  io.on('connection', (socket: Socket) => {
    // -----------------------------------------------------------------------
    // user_connected
    // -----------------------------------------------------------------------
    socket.on('user_connected', (data: Record<string, unknown>) => {
      try {
        if (!requireFields(data, ['referenceId'], socket)) return;
        const referenceId = (data.referenceId as string).trim();
        onlineUsers.set(referenceId, socket.id);
      } catch (err) {
        console.error('[socket] user_connected error:', err);
      }
    });

    // -----------------------------------------------------------------------
    // disconnect — remove all Online_Map entries that point to this socket
    // -----------------------------------------------------------------------
    socket.on('disconnect', () => {
      try {
        for (const [refId, sockId] of onlineUsers.entries()) {
          if (sockId === socket.id) {
            onlineUsers.delete(refId);
          }
        }
      } catch (err) {
        console.error('[socket] disconnect error:', err);
      }
    });

    // -----------------------------------------------------------------------
    // private_message
    // -----------------------------------------------------------------------
    socket.on('private_message', (data: Record<string, unknown>) => {
      try {
        if (
          !requireFields(
            data,
            ['conversationId', 'senderId', 'receiverId', 'content'],
            socket
          )
        )
          return;

        const receiverId = (data.receiverId as string).trim();
        const targetSocketId = onlineUsers.get(receiverId);
        if (!targetSocketId) return; // silently drop — receiver offline

        io.to(targetSocketId).emit('new_message', {
          conversationId: data.conversationId,
          senderId: data.senderId,
          content: data.content,
        });
      } catch (err) {
        console.error('[socket] private_message error:', err);
      }
    });

    // -----------------------------------------------------------------------
    // typing
    // -----------------------------------------------------------------------
    socket.on('typing', (data: Record<string, unknown>) => {
      try {
        if (
          !requireFields(data, ['conversationId', 'senderId', 'receiverId'], socket)
        )
          return;

        const receiverId = (data.receiverId as string).trim();
        const targetSocketId = onlineUsers.get(receiverId);
        if (!targetSocketId) return;

        io.to(targetSocketId).emit('user_typing', {
          conversationId: data.conversationId,
          senderId: data.senderId,
        });
      } catch (err) {
        console.error('[socket] typing error:', err);
      }
    });

    // -----------------------------------------------------------------------
    // stop_typing
    // -----------------------------------------------------------------------
    socket.on('stop_typing', (data: Record<string, unknown>) => {
      try {
        if (
          !requireFields(data, ['conversationId', 'senderId', 'receiverId'], socket)
        )
          return;

        const receiverId = (data.receiverId as string).trim();
        const targetSocketId = onlineUsers.get(receiverId);
        if (!targetSocketId) return;

        io.to(targetSocketId).emit('user_stop_typing', {
          conversationId: data.conversationId,
          senderId: data.senderId,
        });
      } catch (err) {
        console.error('[socket] stop_typing error:', err);
      }
    });

    // -----------------------------------------------------------------------
    // mark_read
    // -----------------------------------------------------------------------
    socket.on('mark_read', (data: Record<string, unknown>) => {
      try {
        if (
          !requireFields(data, ['conversationId', 'userId', 'readerId'], socket)
        )
          return;

        const userId = (data.userId as string).trim();
        const targetSocketId = onlineUsers.get(userId);
        if (!targetSocketId) return;

        io.to(targetSocketId).emit('message_read', {
          conversationId: data.conversationId,
          readerId: data.readerId,
        });
      } catch (err) {
        console.error('[socket] mark_read error:', err);
      }
    });

    // -----------------------------------------------------------------------
    // initiate_call
    // -----------------------------------------------------------------------
    socket.on('initiate_call', (data: Record<string, unknown>) => {
      try {
        if (
          !requireFields(data, ['callerId', 'calleeId', 'callerName'], socket)
        )
          return;

        const calleeId = (data.calleeId as string).trim();
        const targetSocketId = onlineUsers.get(calleeId);
        if (!targetSocketId) return;

        io.to(targetSocketId).emit('call_incoming', {
          callerId: data.callerId,
          callerName: data.callerName,
        });
      } catch (err) {
        console.error('[socket] initiate_call error:', err);
      }
    });

    // -----------------------------------------------------------------------
    // webrtc_offer  —  offer is an RTCSessionDescriptionInit object, not a string
    // -----------------------------------------------------------------------
    socket.on('webrtc_offer', (data: Record<string, unknown>) => {
      try {
        // calleeId must be a non-empty string
        if (!requireFields(data, ['calleeId'], socket)) return;
        // offer must be present (non-null object) — use requirePresent
        if (!requirePresent(data, 'offer', socket)) return;

        const calleeId = (data.calleeId as string).trim();
        const targetSocketId = onlineUsers.get(calleeId);
        if (!targetSocketId) return;

        io.to(targetSocketId).emit('webrtc_offer', {
          offer: data.offer,
          from: socket.id,
        });
      } catch (err) {
        console.error('[socket] webrtc_offer error:', err);
      }
    });

    // -----------------------------------------------------------------------
    // webrtc_answer  —  answer is an RTCSessionDescriptionInit object
    // -----------------------------------------------------------------------
    socket.on('webrtc_answer', (data: Record<string, unknown>) => {
      try {
        if (!requireFields(data, ['callerId'], socket)) return;
        if (!requirePresent(data, 'answer', socket)) return;

        const callerId = (data.callerId as string).trim();
        const targetSocketId = onlineUsers.get(callerId);
        if (!targetSocketId) return;

        io.to(targetSocketId).emit('webrtc_answer', {
          answer: data.answer,
        });
      } catch (err) {
        console.error('[socket] webrtc_answer error:', err);
      }
    });

    // -----------------------------------------------------------------------
    // webrtc_ice_candidate
    // -----------------------------------------------------------------------
    socket.on('webrtc_ice_candidate', (data: Record<string, unknown>) => {
      try {
        if (!requireFields(data, ['targetId'], socket)) return;
        if (!requirePresent(data, 'candidate', socket)) return;

        const targetId = (data.targetId as string).trim();
        const targetSocketId = onlineUsers.get(targetId);
        if (!targetSocketId) return;

        io.to(targetSocketId).emit('webrtc_ice_candidate', {
          candidate: data.candidate,
        });
      } catch (err) {
        console.error('[socket] webrtc_ice_candidate error:', err);
      }
    });

    // -----------------------------------------------------------------------
    // end_call
    // -----------------------------------------------------------------------
    socket.on('end_call', (data: Record<string, unknown>) => {
      try {
        if (!requireFields(data, ['targetId'], socket)) return;

        const targetId = (data.targetId as string).trim();
        const targetSocketId = onlineUsers.get(targetId);
        if (!targetSocketId) return;

        io.to(targetSocketId).emit('call_ended');
      } catch (err) {
        console.error('[socket] end_call error:', err);
      }
    });
  });

  return io;
}

// ---------------------------------------------------------------------------
// Main — only starts the server when this file is executed directly.
// When imported by tests, nothing is started.
// ---------------------------------------------------------------------------
// CommonJS-style main detection that also works under ts-node ESM and CJS modes
const isMain =
  require.main === module ||
  (typeof process !== 'undefined' &&
    process.argv[1] &&
    process.argv[1].endsWith('socket-server.ts'));

if (isMain) {
  const PORT = parseInt(process.env.SOCKET_PORT ?? '3001', 10);
  const httpServer = http.createServer();
  createSocketServer(httpServer);
  httpServer.listen(PORT, () => {
    console.log(`[socket-server] Listening on port ${PORT}`);
  });
}
