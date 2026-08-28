"use client";

import { useCallback, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';

// ---------------------------------------------------------------------------
// RTCConfiguration — module-level frozen constant
// Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
// ---------------------------------------------------------------------------
const RTC_CONFIG: RTCConfiguration = Object.freeze({
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.relay.metered.ca:80' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.ekiga.net' },
    { urls: 'stun:stun.ideasip.com' },
  ],
  iceCandidatePoolSize: 10,
  rtcpMuxPolicy: 'require' as RTCRtcpMuxPolicy,
  bundlePolicy: 'max-bundle' as RTCBundlePolicy,
});

// Exported so test suites can inspect the configuration without importing the hook.
export { RTC_CONFIG };

// ---------------------------------------------------------------------------
// getUserMediaWithTimeout — wraps getUserMedia with a 30-second hard limit
// Requirements: 10.9, 10.10
// ---------------------------------------------------------------------------
async function getUserMediaWithTimeout(
  constraints: MediaStreamConstraints
): Promise<MediaStream> {
  return Promise.race([
    navigator.mediaDevices.getUserMedia(constraints),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Media access timeout after 30 seconds')),
        30_000
      )
    ),
  ]);
}

// ---------------------------------------------------------------------------
// useWebRTC hook
// Requirements: 10.1–10.11
// ---------------------------------------------------------------------------

/**
 * Manages the full WebRTC peer-to-peer call lifecycle.
 *
 * @param socket   - Active Socket.IO instance from useSocket (may be null while connecting).
 * @param currentUserRefId - The calling user's ReferenceID; used as callerId in signaling events.
 */
export function useWebRTC(
  socket: Socket | null,
  currentUserRefId: string
): {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isCallActive: boolean;
  isCalling: boolean;
  isReceivingCall: boolean;
  error: string | null;
  startCall: (calleeId: string, callType?: 'video' | 'audio') => Promise<void>;
  handleOffer: (data: { from: string; offer: RTCSessionDescriptionInit }) => Promise<void>;
  handleAnswer: (data: { answer: RTCSessionDescriptionInit }) => Promise<void>;
  handleIceCandidate: (data: { candidate: RTCIceCandidateInit }) => Promise<void>;
  endCall: () => void;
} {
  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isCallActive, setIsCallActive] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const [isReceivingCall, setIsReceivingCall] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Refs (mutable, not re-render triggers)
  // -------------------------------------------------------------------------
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteIdRef = useRef<string | null>(null);
  const callTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Wire the standard ontrack and onicecandidate handlers onto a new RTCPeerConnection.
   * targetId is the remote peer's ReferenceID — used to route ICE candidates.
   */
  function wireHandlers(pc: RTCPeerConnection, targetId: string): void {
    // Requirement 10.7 — assign remote MediaStream to remoteStream ref
    pc.ontrack = (event: RTCTrackEvent) => {
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
      }
    };

    // Requirement 10.6 — emit webrtc_ice_candidate when a new ICE candidate is generated
    pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate) {
        socket?.emit('webrtc_ice_candidate', {
          candidate: event.candidate,
          targetId,
        });
      }
    };
  }

  // -------------------------------------------------------------------------
  // startCall
  // Requirement 10.1
  // -------------------------------------------------------------------------
  const startCall = useCallback(
    async (calleeId: string, callType?: 'video' | 'audio'): Promise<void> => {
      // Guard: empty calleeId is a no-op (Requirement 10.1)
      if (!calleeId || calleeId.trim() === '') return;

      setIsCalling(true);

      let stream: MediaStream;
      try {
        stream = await getUserMediaWithTimeout({
          video: callType !== 'audio',
          audio: true,
        });
      } catch (e) {
        // Requirement 10.9 / 10.10 — media access denied or timed out
        const message =
          e instanceof Error ? e.message : 'Camera and microphone access was denied';
        setError(message);
        setIsCalling(false);
        return;
      }

      setLocalStream(stream);
      localStreamRef.current = stream;
      remoteIdRef.current = calleeId;

      // Create peer connection
      const pc = new RTCPeerConnection(RTC_CONFIG);
      peerConnectionRef.current = pc;

      // Add all local tracks
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // Wire event handlers
      wireHandlers(pc, calleeId);

      // Create and set local description (offer)
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Emit signaling events via socket
      socket?.emit('webrtc_offer', { offer, calleeId });
      socket?.emit('initiate_call', {
        callerId: currentUserRefId,
        calleeId,
        callerName: currentUserRefId,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [socket, currentUserRefId]
  );

  // -------------------------------------------------------------------------
  // handleOffer
  // Requirement 10.2
  // -------------------------------------------------------------------------
  const handleOffer = useCallback(
    async (data: { from: string; offer: RTCSessionDescriptionInit }): Promise<void> => {
      const { from, offer } = data;

      setIsReceivingCall(true);

      // Create peer connection
      const pc = new RTCPeerConnection(RTC_CONFIG);
      peerConnectionRef.current = pc;
      remoteIdRef.current = from;

      // Wire handlers before acquiring media so ICE candidates generated
      // during answer creation are not lost
      wireHandlers(pc, from);

      let stream: MediaStream;
      try {
        stream = await getUserMediaWithTimeout({ video: true, audio: true });
      } catch (e) {
        // Requirement 10.9 / 10.10 — media access denied or timed out
        const message =
          e instanceof Error ? e.message : 'Camera and microphone access was denied';
        setError(message);
        setIsReceivingCall(false);
        // Clean up the peer connection we just created
        pc.close();
        peerConnectionRef.current = null;
        remoteIdRef.current = null;
        return;
      }

      setLocalStream(stream);
      localStreamRef.current = stream;

      // Add all local tracks
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // Set remote description from caller's offer
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      // Create answer and set as local description
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // Send answer back to caller
      socket?.emit('webrtc_answer', { answer, callerId: from });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [socket]
  );

  // -------------------------------------------------------------------------
  // handleAnswer
  // Requirement 10.3
  // -------------------------------------------------------------------------
  const handleAnswer = useCallback(
    async (data: { answer: RTCSessionDescriptionInit }): Promise<void> => {
      const { answer } = data;
      await peerConnectionRef.current?.setRemoteDescription(
        new RTCSessionDescription(answer)
      );
      setIsCallActive(true);
    },
    []
  );

  // -------------------------------------------------------------------------
  // handleIceCandidate
  // Requirements 10.4, 10.5
  // -------------------------------------------------------------------------
  const handleIceCandidate = useCallback(
    async (data: { candidate: RTCIceCandidateInit }): Promise<void> => {
      // Requirement 10.5 — discard silently if no active peer connection
      if (!peerConnectionRef.current) return;
      await peerConnectionRef.current.addIceCandidate(
        new RTCIceCandidate(data.candidate)
      );
    },
    []
  );

  // -------------------------------------------------------------------------
  // endCall
  // Requirement 10.8
  // -------------------------------------------------------------------------
  const endCall = useCallback((): void => {
    // Clear the call-not-answered timeout if still pending
    if (callTimeoutRef.current !== null) {
      clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }

    // Stop all local media tracks
    localStreamRef.current?.getTracks().forEach((track) => track.stop());

    // Close the peer connection
    peerConnectionRef.current?.close();

    // Notify the remote peer the call has ended
    if (remoteIdRef.current) {
      socket?.emit('end_call', { targetId: remoteIdRef.current });
    }

    // Reset all state to initial values
    setLocalStream(null);
    setRemoteStream(null);
    setIsCallActive(false);
    setIsCalling(false);
    setIsReceivingCall(false);
    setError(null);

    // Reset refs
    peerConnectionRef.current = null;
    localStreamRef.current = null;
    remoteIdRef.current = null;
  }, [socket]);

  // -------------------------------------------------------------------------
  // Public API — Requirement 10.11
  // -------------------------------------------------------------------------
  return {
    localStream,
    remoteStream,
    isCallActive,
    isCalling,
    isReceivingCall,
    error,
    startCall,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    endCall,
  };
}
