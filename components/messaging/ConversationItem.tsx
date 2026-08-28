"use client";

import { formatDistanceToNow } from "date-fns";
import type {
  Conversation,
  ConversationParticipant,
  User,
} from "@/lib/types";
import { getUserFullName, getUserInitials } from "@/lib/types";

/**
 * The API enriches each Conversation with a `participants` array that
 * contains ConversationParticipant rows (each with a nested `user` field).
 * We extend the base Conversation type locally to capture this shape.
 */
export interface ConversationWithParticipants extends Conversation {
  participants: ConversationParticipant[];
}

interface ConversationItemProps {
  conversation: ConversationWithParticipants;
  currentUserId: string;
  isSelected: boolean;
  onClick: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

function getOtherParticipant(
  participants: ConversationParticipant[],
  currentUserId: string
): ConversationParticipant | undefined {
  return participants.find((p) => p.user_id !== currentUserId);
}

function hasUnread(
  conversation: ConversationWithParticipants,
  currentUserId: string
): boolean {
  const myParticipant = conversation.participants.find(
    (p) => p.user_id === currentUserId
  );
  if (!myParticipant?.last_seen_at) {
    // Never seen → always unread if there's a last_message_at
    return Boolean(conversation.last_message_at);
  }
  return (
    new Date(conversation.last_message_at) >
    new Date(myParticipant.last_seen_at)
  );
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

interface AvatarProps {
  user?: User;
  fallbackLabel: string;
}

function Avatar({ user, fallbackLabel }: AvatarProps) {
  if (user?.profilePicture) {
    return (
      <img
        src={user.profilePicture}
        alt={getUserFullName(user)}
        className="h-10 w-10 shrink-0 rounded-full object-cover"
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold uppercase text-primary select-none"
    >
      {fallbackLabel}
    </div>
  );
}

// ─── ConversationItem ─────────────────────────────────────────────────────────

/**
 * A single row in the conversation sidebar list.
 *
 * Requirements 11.3, 11.5 — shows participant name/group name, message preview
 * (truncated to 60 chars), relative timestamp, selected highlight, and an
 * unread dot when last_message_at is newer than the current user's last_seen_at.
 */
export default function ConversationItem({
  conversation,
  currentUserId,
  isSelected,
  onClick,
}: ConversationItemProps) {
  const isDirect = conversation.conversation_type === "direct";

  // Resolve the other participant (direct) or fall back for group
  const otherParticipant = isDirect
    ? getOtherParticipant(conversation.participants, currentUserId)
    : undefined;
  const otherUser = otherParticipant?.user;

  // Display name
  const displayName = isDirect
    ? otherUser
      ? getUserFullName(otherUser)
      : otherParticipant?.user_id ?? "Unknown"
    : conversation.name ?? "Group Chat";

  // Avatar initials / fallback label
  const avatarLabel = isDirect
    ? otherUser
      ? getUserInitials(otherUser)
      : (otherParticipant?.user_id ?? "?").slice(0, 2).toUpperCase()
    : (conversation.name ?? "GC").slice(0, 2).toUpperCase();

  // Message preview — the Conversation base type doesn't carry the last
  // message content; show a placeholder when not available.
  const rawPreview =
    (conversation as ConversationWithParticipants & { last_message_content?: string })
      .last_message_content ?? "";
  const preview = rawPreview ? truncate(rawPreview, 60) : "";

  // Relative timestamp
  const relativeTime = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), {
        addSuffix: true,
      })
    : "";

  const unread = hasUnread(conversation, currentUserId);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isSelected ? "true" : undefined}
      aria-label={`Open conversation with ${displayName}`}
      className={[
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
        "hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isSelected ? "bg-accent" : "bg-transparent",
      ].join(" ")}
    >
      {/* Avatar */}
      <Avatar user={otherUser} fallbackLabel={avatarLabel} />

      {/* Text content */}
      <div className="min-w-0 flex-1">
        {/* Top row: name + timestamp */}
        <div className="flex items-center justify-between gap-1">
          <span className="truncate text-sm font-semibold text-foreground">
            {displayName}
          </span>
          {relativeTime && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {relativeTime}
            </span>
          )}
        </div>

        {/* Bottom row: preview + unread dot */}
        <div className="flex items-center justify-between gap-1">
          <span
            className={[
              "truncate text-xs",
              unread
                ? "font-medium text-foreground"
                : "text-muted-foreground",
            ].join(" ")}
          >
            {preview || (
              <span className="italic text-muted-foreground/60">
                No messages yet
              </span>
            )}
          </span>

          {/* Unread indicator dot */}
          {unread && (
            <span
              aria-label="Unread messages"
              className="ml-1 h-2 w-2 shrink-0 rounded-full bg-blue-500"
            />
          )}
        </div>
      </div>
    </button>
  );
}
