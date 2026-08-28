"use client";

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

/**
 * Manages the Socket.IO client connection lifecycle.
 *
 * - Connects only when `userId` is a non-empty string.
 * - Emits `user_connected` on initial connect and on every reconnect
 *   so the server's Online_Map is always up to date.
 * - Cleans up the socket (disconnect + remove listeners) on unmount.
 *
 * Requirements: 8.1–8.7
 */
export function useSocket(userId: string | null): {
  socket: Socket | null;
  isConnected: boolean;
  emit: (event: string, ...args: unknown[]) => void;
} {
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // Stable emit helper — safe to call even when socket is null
  const emit = useCallback((event: string, ...args: unknown[]) => {
    socketRef.current?.emit(event, ...args);
  }, []);

  useEffect(() => {
    // Requirement 8.2 — do not connect for null / empty userId
    if (!userId || userId.trim() === '') return;

    const socketInstance = io(
      process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:3001',
      { transports: ['websocket', 'polling'] }
    );

    socketRef.current = socketInstance;

    // Requirement 8.6 — set isConnected = true; Requirement 8.1 — emit user_connected
    const onConnect = () => {
      setIsConnected(true);
      socketInstance.emit('user_connected', { referenceId: userId });
    };

    // Requirement 8.5 — isConnected = false while disconnected
    const onDisconnect = () => setIsConnected(false);

    socketInstance.on('connect', onConnect);
    socketInstance.on('disconnect', onDisconnect);

    // Requirement 8.7 — re-emit user_connected on reconnect to restore Online_Map entry
    socketInstance.io.on('reconnect', () => {
      socketInstance.emit('user_connected', { referenceId: userId });
    });

    // Requirement 8.3 — disconnect and remove listeners on unmount
    return () => {
      socketInstance.off('connect', onConnect);
      socketInstance.off('disconnect', onDisconnect);
      socketInstance.disconnect();
      socketRef.current = null;
    };
  }, [userId]);

  // Requirement 8.4 — expose socket, isConnected, emit
  return { socket: socketRef.current, isConnected, emit };
}
