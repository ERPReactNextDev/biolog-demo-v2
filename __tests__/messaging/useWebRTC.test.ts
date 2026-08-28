import { renderHook, act } from '@testing-library/react';
import { useWebRTC, RTC_CONFIG } from '@/hooks/useWebRTC';

// ─── Mock RTCPeerConnection ───────────────────────────────────────────────────

const mockClose = jest.fn();
const mockAddTrack = jest.fn();
const mockCreateOffer = jest.fn().mockResolvedValue({ type: 'offer', sdp: 'sdp' });
const mockSetLocalDescription = jest.fn().mockResolvedValue(undefined);
const mockSetRemoteDescription = jest.fn().mockResolvedValue(undefined);
const mockCreateAnswer = jest.fn().mockResolvedValue({ type: 'answer', sdp: 'sdp' });
const mockAddIceCandidate = jest.fn().mockResolvedValue(undefined);

const MockRTCPeerConnection = jest.fn().mockImplementation(() => ({
  close: mockClose,
  addTrack: mockAddTrack,
  createOffer: mockCreateOffer,
  setLocalDescription: mockSetLocalDescription,
  setRemoteDescription: mockSetRemoteDescription,
  createAnswer: mockCreateAnswer,
  addIceCandidate: mockAddIceCandidate,
  ontrack: null,
  onicecandidate: null,
}));

// ─── Mock navigator.mediaDevices.getUserMedia ─────────────────────────────────

const mockGetUserMedia = jest.fn();

// ─── Mock socket ──────────────────────────────────────────────────────────────

const mockSocket = { emit: jest.fn() };

beforeAll(() => {
  // @ts-ignore
  global.RTCPeerConnection = MockRTCPeerConnection;
  // @ts-ignore
  global.RTCSessionDescription = jest.fn().mockImplementation((init) => init);
  // @ts-ignore
  global.RTCIceCandidate = jest.fn().mockImplementation((init) => init);

  Object.defineProperty(global.navigator, 'mediaDevices', {
    value: { getUserMedia: mockGetUserMedia },
    writable: true,
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  MockRTCPeerConnection.mockImplementation(() => ({
    close: mockClose,
    addTrack: mockAddTrack,
    createOffer: mockCreateOffer,
    setLocalDescription: mockSetLocalDescription,
    setRemoteDescription: mockSetRemoteDescription,
    createAnswer: mockCreateAnswer,
    addIceCandidate: mockAddIceCandidate,
    ontrack: null,
    onicecandidate: null,
  }));
});

// ─── RTC_CONFIG smoke tests ───────────────────────────────────────────────────

describe('RTC_CONFIG smoke tests', () => {
  it('has at least 5 STUN servers', () => {
    expect(RTC_CONFIG.iceServers!.length).toBeGreaterThanOrEqual(5);
  });

  it('iceCandidatePoolSize is 10', () => {
    expect(RTC_CONFIG.iceCandidatePoolSize).toBe(10);
  });

  it('rtcpMuxPolicy is "require"', () => {
    expect(RTC_CONFIG.rtcpMuxPolicy).toBe('require');
  });

  it('bundlePolicy is "max-bundle"', () => {
    expect(RTC_CONFIG.bundlePolicy).toBe('max-bundle');
  });
});

// ─── useWebRTC example tests ──────────────────────────────────────────────────

describe('useWebRTC examples', () => {
  it('startCall("") is a no-op — isCalling stays false', async () => {
    const { result } = renderHook(() => useWebRTC(mockSocket as any, 'REF_CALLER'));

    await act(async () => {
      await result.current.startCall('');
    });

    expect(result.current.isCalling).toBe(false);
    expect(mockGetUserMedia).not.toHaveBeenCalled();
  });

  it('startCall sets error and resets isCalling when getUserMedia rejects', async () => {
    const notAllowedError = new DOMException('Permission denied', 'NotAllowedError');
    mockGetUserMedia.mockRejectedValue(notAllowedError);

    const { result } = renderHook(() => useWebRTC(mockSocket as any, 'REF_CALLER'));

    await act(async () => {
      await result.current.startCall('CALLEE_ID');
    });

    expect(result.current.isCalling).toBe(false);
    expect(result.current.error).toBeTruthy();
    expect(result.current.error).toContain('Permission denied');
  });

  it('endCall stops local tracks and closes peer connection', async () => {
    const mockTrack = { stop: jest.fn() };
    const mockStream = {
      getTracks: jest.fn().mockReturnValue([mockTrack]),
    };
    mockGetUserMedia.mockResolvedValue(mockStream);

    const { result } = renderHook(() => useWebRTC(mockSocket as any, 'REF_CALLER'));

    // Start a call to set up localStream and peerConnection
    await act(async () => {
      await result.current.startCall('CALLEE_ID');
    });

    // Now end the call
    act(() => {
      result.current.endCall();
    });

    expect(mockTrack.stop).toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
    expect(result.current.isCallActive).toBe(false);
    expect(result.current.isCalling).toBe(false);
    expect(result.current.localStream).toBe(null);
  });
});
