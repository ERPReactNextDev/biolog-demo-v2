"use client";

import { useEffect, useRef, useState } from "react";
import { PhoneOff, X } from "lucide-react";

export interface VideoCallOverlayProps {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isCallActive: boolean;
  isCalling: boolean;
  error: string | null;
  onEndCall: () => void;
}

/**
 * Full-screen video call overlay.
 *
 * Requirements 14.6, 14.7, 14.9
 *
 * - Remote video fills the screen (object-cover).
 * - Local video appears as a PiP in the bottom-right corner.
 * - When isCalling && !isCallActive a centred "Calling…" spinner is shown.
 * - A red PhoneOff button is always visible at the bottom-centre to end the call.
 * - If `error` is non-null an amber/red dismissable banner appears at the top.
 */
export default function VideoCallOverlay({
  localStream,
  remoteStream,
  isCallActive,
  isCalling,
  error,
  onEndCall,
}: VideoCallOverlayProps) {
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);

  // Tracks whether the user has manually dismissed the error banner.
  const [errorDismissed, setErrorDismissed] = useState(false);

  // Re-show banner whenever a new (non-null) error arrives.
  useEffect(() => {
    if (error) {
      setErrorDismissed(false);
    }
  }, [error]);

  // Attach remote stream to the full-screen video element.
  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // Attach local stream to the PiP video element.
  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  const showError = Boolean(error) && !errorDismissed;
  const showCallingState = isCalling && !isCallActive;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Video call"
      className="fixed inset-0 z-40 bg-black"
    >
      {/* ── Remote video (full-screen) ───────────────────────────────────────── */}
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        className="h-full w-full object-cover"
        aria-label="Remote participant video"
      />

      {/* ── "Calling…" spinner overlay ───────────────────────────────────────── */}
      {showCallingState && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/60">
          {/* Spinner */}
          <div
            aria-hidden="true"
            className="h-14 w-14 animate-spin rounded-full border-4 border-white/20 border-t-white"
          />
          <p className="text-lg font-medium text-white">Calling…</p>
        </div>
      )}

      {/* ── Error banner ─────────────────────────────────────────────────────── */}
      {showError && (
        <div
          role="alert"
          className="absolute left-1/2 top-4 z-50 flex w-[90vw] max-w-md -translate-x-1/2 items-start gap-3 rounded-xl bg-red-600/90 px-4 py-3 text-white shadow-lg backdrop-blur-sm"
        >
          <p className="flex-1 text-sm">{error}</p>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setErrorDismissed(true)}
            className="shrink-0 rounded p-0.5 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* ── Local PiP video ───────────────────────────────────────────────────── */}
      <video
        ref={localVideoRef}
        autoPlay
        playsInline
        muted
        className="absolute bottom-4 right-4 h-30 w-40 rounded-xl border-2 border-white object-cover shadow-xl"
        aria-label="Your local video"
      />

      {/* ── End call button ───────────────────────────────────────────────────── */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
        <button
          type="button"
          aria-label="End call"
          onClick={onEndCall}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 shadow-lg transition-colors hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-black active:scale-95"
        >
          <PhoneOff className="h-6 w-6 text-white" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
