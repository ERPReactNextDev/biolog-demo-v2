"use client";

import { useState } from "react";
import { PencilLine, Search, RefreshCw, MessageSquarePlus } from "lucide-react";
import { getUserFullName } from "@/lib/types";
import ConversationItem, {
  type ConversationWithParticipants,
} from "./ConversationItem";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ConversationListProps {
  conversations: ConversationWithParticipants[];
  selectedId: string | null;
  currentUserId: string;
  onSelect: (conv: ConversationWithParticipants) => void;
  onNewConversation: () => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the display name used for conversation list filtering.
 * For direct conversations: getUserFullName of the other participant.
 * For group conversations: conv.name ?? 'Group Chat'.
 */
function getConversationDisplayName(
  conv: ConversationWithParticipants,
  currentUserId: string
): string {
  if (conv.conversation_type === "direct") {
    const other = conv.participants.find((p) => p.user_id !== currentUserId);
    if (other?.user) return getUserFullName(other.user);
    if (other?.user_id) return other.user_id;
    return "Unknown";
  }
  return conv.name ?? "Group Chat";
}

// ─── Skeleton Row ─────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div
      aria-hidden="true"
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 animate-pulse"
    >
      {/* Avatar placeholder */}
      <div className="h-10 w-10 shrink-0 rounded-full bg-muted" />
      {/* Text placeholders */}
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-32 rounded bg-muted" />
        <div className="h-3 w-48 rounded bg-muted" />
      </div>
    </div>
  );
}

// ─── ConversationList ─────────────────────────────────────────────────────────

/**
 * Sidebar conversation list with search filtering, loading/error/empty states.
 *
 * Requirements 11.1, 11.2, 11.3, 11.6, 11.7
 */
export default function ConversationList({
  conversations,
  selectedId,
  currentUserId,
  onSelect,
  onNewConversation,
  loading,
  error,
  onRetry,
}: ConversationListProps) {
  const [filterQuery, setFilterQuery] = useState("");

  // Client-side filter — updates within one render cycle (Req 11.6)
  const filtered = filterQuery.trim()
    ? conversations.filter((conv) =>
        getConversationDisplayName(conv, currentUserId)
          .toLowerCase()
          .includes(filterQuery.toLowerCase())
      )
    : conversations;

  return (
    <div className="flex h-full flex-col border-r bg-background">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h2 className="text-base font-semibold text-foreground">Messages</h2>
        <button
          type="button"
          onClick={onNewConversation}
          aria-label="New conversation"
          title="New conversation"
          className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <PencilLine className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* ── Search input ─────────────────────────────────────────────────── */}
      <div className="px-3 py-2 border-b">
        <div className="relative">
          <Search
            className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            placeholder="Search conversations..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            aria-label="Search conversations"
            className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {/* Loading — 3 skeleton rows (Req 11.1) */}
        {loading && (
          <>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </>
        )}

        {/* Error state (Req 11.7) */}
        {!loading && error && (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <button
              type="button"
              onClick={onRetry}
              className="flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Retry
            </button>
          </div>
        )}

        {/* Empty state — no conversations at all (Req 11.2) */}
        {!loading && !error && conversations.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <MessageSquarePlus
              className="h-10 w-10 text-muted-foreground/50"
              aria-hidden="true"
            />
            <p className="text-sm text-muted-foreground">
              No conversations yet
            </p>
            <button
              type="button"
              onClick={onNewConversation}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Start one
            </button>
          </div>
        )}

        {/* Empty state — filter returned no matches */}
        {!loading &&
          !error &&
          conversations.length > 0 &&
          filtered.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No conversations match &ldquo;{filterQuery}&rdquo;
            </p>
          )}

        {/* Conversation list (Req 11.1, 11.3, 11.5) */}
        {!loading &&
          !error &&
          filtered.map((conv) => (
            <ConversationItem
              key={conv.id}
              conversation={conv}
              currentUserId={currentUserId}
              isSelected={conv.id === selectedId}
              onClick={() => onSelect(conv)}
            />
          ))}
      </div>
    </div>
  );
}
