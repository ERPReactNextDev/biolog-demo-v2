"use client";

import { motion } from "framer-motion";

interface TypingIndicatorProps {
  senderName: string;
}

const dotVariants = {
  initial: { y: 0 },
  animate: { y: -6 },
};

const containerVariants = {
  animate: {
    transition: {
      staggerChildren: 0.18,
      repeat: Infinity,
      repeatDelay: 0.4,
    },
  },
};

/**
 * Displays a "{senderName} is typing..." label with three staggered bouncing dots.
 * Requirement 12.11 — shown when a user_typing socket event is received.
 */
export default function TypingIndicator({ senderName }: TypingIndicatorProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground select-none">
      <span className="font-medium text-foreground/70">{senderName}</span>
      <span className="text-muted-foreground">is typing</span>

      {/* Animated dots */}
      <motion.div
        className="flex items-center gap-0.5"
        variants={containerVariants}
        initial="initial"
        animate="animate"
        aria-label="typing"
      >
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="block h-1.5 w-1.5 rounded-full bg-muted-foreground"
            variants={dotVariants}
            transition={{
              duration: 0.35,
              ease: "easeInOut",
              repeat: Infinity,
              repeatType: "reverse",
            }}
          />
        ))}
      </motion.div>
    </div>
  );
}
