import { renderHook, act } from '@testing-library/react';
import { useSocket } from '@/hooks/useSocket';

// ─── Mock socket.io-client ────────────────────────────────────────────────────

const mockEmit = jest.fn();
const mockOn = jest.fn();
const mockOff = jest.fn();
const mockDisconnect = jest.fn();
const mockIoOn = jest.fn(); // for socketInstance.io.on('reconnect', ...)

const mockSocketInstance = {
  emit: mockEmit,
  on: mockOn,
  off: mockOff,
  disconnect: mockDisconnect,
  io: { on: mockIoOn },
};

const mockIo = jest.fn().mockReturnValue(mockSocketInstance);

jest.mock('socket.io-client', () => ({
  io: (...args: unknown[]) => mockIo(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockIo.mockReturnValue(mockSocketInstance);
});

// ─── Helper to simulate socket events ────────────────────────────────────────

function simulateEvent(eventName: string) {
  // Find the callback registered via socket.on(eventName, cb) and call it
  const calls = mockOn.mock.calls as [string, () => void][];
  const handler = calls.find(([name]) => name === eventName)?.[1];
  if (handler) act(() => handler());
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useSocket', () => {
  it('does not call io() when userId is null', () => {
    renderHook(() => useSocket(null));
    expect(mockIo).not.toHaveBeenCalled();
  });

  it('does not call io() when userId is empty string', () => {
    renderHook(() => useSocket(''));
    expect(mockIo).not.toHaveBeenCalled();
  });

  it('returns isConnected = false when userId is null', () => {
    const { result } = renderHook(() => useSocket(null));
    expect(result.current.isConnected).toBe(false);
  });

  it('calls io() with socket URL when userId is non-empty', () => {
    renderHook(() => useSocket('REF123'));
    expect(mockIo).toHaveBeenCalledTimes(1);
    expect(mockIo).toHaveBeenCalledWith(
      expect.stringContaining('localhost:3001'),
      expect.any(Object)
    );
  });

  it('sets isConnected = true and emits user_connected on connect event', () => {
    const { result } = renderHook(() => useSocket('REF123'));

    simulateEvent('connect');

    expect(result.current.isConnected).toBe(true);
    expect(mockEmit).toHaveBeenCalledWith('user_connected', { referenceId: 'REF123' });
  });

  it('sets isConnected = false on disconnect event', () => {
    const { result } = renderHook(() => useSocket('REF123'));

    simulateEvent('connect');
    expect(result.current.isConnected).toBe(true);

    simulateEvent('disconnect');
    expect(result.current.isConnected).toBe(false);
  });

  it('calls disconnect() on unmount', () => {
    const { unmount } = renderHook(() => useSocket('REF123'));
    unmount();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('removes connect/disconnect listeners on unmount', () => {
    const { unmount } = renderHook(() => useSocket('REF123'));
    unmount();
    expect(mockOff).toHaveBeenCalledWith('connect', expect.any(Function));
    expect(mockOff).toHaveBeenCalledWith('disconnect', expect.any(Function));
  });

  it('emit helper calls socket.emit when socket exists', () => {
    const { result } = renderHook(() => useSocket('REF123'));
    act(() => result.current.emit('test_event', { data: 1 }));
    // user_connected is emitted on connect, but we're testing the emit helper here
    // The emit helper uses socketRef.current which is the mock instance
    expect(mockEmit).toHaveBeenCalledWith('test_event', { data: 1 });
  });
});
