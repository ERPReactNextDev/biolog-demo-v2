"use client";

import { useEffect } from "react";
import { motion } from "framer-motion";
import { Phone, PhoneOff } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface IncomingCallAlertProps {
  callerId: string;
  callerName: string;
  onAccept: () => void;
  onDecline: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns up to 2 uppercase initials from a display name string. */
function getInitialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ─── Animation variants ───────────────────────────────────────────────────────

/** Card slides in from the right edge of the screen. */
const slideVariants = {
  hidden: { x: "110%", opacity: 0 },
  visible: {
    x: 0,
    opacity: 1,
    transition: { type: "spring" as const, stiffness: 300, damping: 30 },
  },
  exit: {
    x: "110%",
    opacity: 0,
    transition: { duration: 0.25, ease: "easeIn" as const },
  },
};

/** Pulsing ring that draws attention to the incoming call. */
const pulseRingVariants = {
  animate: {
    scale: [1, 1.4, 1.4],
    opacity: [0.6, 0, 0],
    transition: {
      duration: 1.5,
      repeat: Infinity,
      ease: "easeOut" as const,
    },
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Incoming call notification overlay.
 *
 * Requirements 14.3 — Displayed when a `call_incoming` socket event is received.
 * Requirements 14.5 — Decline button emits `end_call` and dismisses the overlay.
 *
 * Behaviour:
 * - Fixed: top-4 right-4 z-50 (never blocks conversation content)
 * - Slides in from right via framer-motion spring animation
 * - Pulsing ring animation around caller avatar
 * - Accept (green) → onAccept()   |   Decline (red) → onDecline()
 * - Auto-dismisses after 30 seconds by calling onDecline()
 */
export default function IncomingCallAlert({
  callerName,
  onAccept,
  onDecline,
}: IncomingCallAlertProps) {
  // ── Auto-dismiss after 30 seconds ──────────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => {
      onDecline();
    }, 30_000);

    return () => clearTimeout(timer);
  }, [onDecline]);

  const initials = getInitialsFromName(callerName);

  return (
    <motion.div
      role="alertdialog"
      aria-label={`Incoming call from ${callerName}`}
      aria-live="assertive"
      className="fixed top-4 right-4 z-50 w-80 select-none"
      variants={slideVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      {/* Card */}
      <div className="flex items-center gap-4 rounded-2xl border border-border bg-background/95 px-4 py-4 shadow-2xl backdrop-blur-sm">

        {/* Avatar with pulse ring */}
        <div className="relative shrink-0">
          {/* Outer pulse ring */}
          <motion.span
            aria-hidden="true"
            className="absolute inset-0 rounded-full bg-green-400"
            variants={pulseRingVariants}
            animate="animate"
          />

          {/* Avatar circle */}
          <div
            aria-hidden="true"
            className="relative flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-sm font-bold uppercase text-primary"
          >
            {initials}
          </div>
        </div>

        {/* Call info */}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Incoming call
          </p>
          <p className="truncate text-sm font-semibold text-foreground">
            {callerName}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex shrink-0 items-center gap-2">
          {/* Accept */}
          <button
            type="button"
            onClick={onAccept}
            aria-label={`Accept call from ${callerName}`}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500 text-white shadow transition-colors hover:bg-green-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400 focus-visible:ring-offset-2 active:scale-95"
          >
            <Phone className="h-4 w-4" aria-hidden="true" />
          </button>

          {/* Decline */}
          <button
            type="button"
            onClick={onDecline}
            aria-label={`Decline call from ${callerName}`}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500 text-white shadow transition-colors hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 active:scale-95"
          >
            <PhoneOff className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
