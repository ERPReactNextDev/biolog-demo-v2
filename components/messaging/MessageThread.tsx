"use client";

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Socket } from "socket.io-client";
import { Video, Send, Phone } from "lucide-react";
import {
  Message,
  Conversation,
  ConversationParticipant,
  getUserFullName,
  getUserInitials,
} from "@/lib/types";
import { MessageBubble } from "./MessageBubble";
import TypingIndicator from "./TypingIndicator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MessageThreadProps {
  conversation: Conversation & { participants: ConversationParticipant[] };
  currentUserId: string;
  socket: Socket | null;
  onStartCall: (calleeId: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the other participant in a direct conversation, or `undefined` for
 * group conversations (or when there is no other participant yet).
 */
function getOtherParticipant(
  participants: ConversationParticipant[],
  currentUserId: string
): ConversationParticipant | undefined {
  return participants.find((p) => p.user_id !== currentUserId);
}

/**
 * Emits mark_read via socket and calls the PATCH API to update the
 * server-side read cursor in one shot.
 */
async function markConversationRead(
  conversationId: string,
  currentUserId: string,
  socket: Socket | null,
  otherUserId?: string
): Promise<void> {
  // Socket event — tells the other user we've read their messages
  if (otherUserId) {
    socket?.emit("mark_read", {
      conversationId,
      userId: otherUserId,
      readerId: currentUserId,
    });
  }

  // REST — persists our read cursor in the DB
  try {
    await fetch("/api/messages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, referenceId: currentUserId }),
    });
  } catch {
    // Non-critical — silently ignore read-cursor failures
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * MessageThread renders the full message history for a single conversation,
 * handles real-time socket events, and provides a composed message input.
 *
 * Requirements 12.1–12.13
 */
export default function MessageThread({
  conversation,
  currentUserId,
  socket,
  onStartCall,
}: MessageThreadProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Map of senderId → auto-clear timeout handle
  const [typingUsers, setTypingUsers] = useState<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastTypingEmitRef = useRef<number>(0);

  const isDirect = conversation.conversation_type === "direct";
  const otherParticipant = isDirect
    ? getOtherParticipant(conversation.participants, currentUserId)
    : undefined;
  const otherUser = otherParticipant?.user;
  const otherUserId = otherParticipant?.user_id;

  const displayName = isDirect
    ? otherUser
      ? getUserFullName(otherUser)
      : otherUserId ?? "Unknown"
    : conversation.name ?? "Group Chat";

  const avatarInitials = isDirect
    ? otherUser
      ? getUserInitials(otherUser)
      : (otherUserId ?? "??").slice(0, 2).toUpperCase()
    : (conversation.name ?? "GC").slice(0, 2).toUpperCase();

  // ── Auto-scroll helper ─────────────────────────────────────────────────────

  /**
   * Scrolls to the bottom if the user is within 100 px of the bottom
   * (Requirement 12.4), or unconditionally when called with `force = true`
   * (used on initial load, Requirement 12.3).
   */
  const scrollToBottomIfNear = useCallback((force = false) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;

    if (force || distanceFromBottom <= 100) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, []);

  // ── Fetch messages on conversation change ──────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function fetchMessages() {
      setLoading(true);
      setFetchError(null);
      setMessages([]);

      try {
        const res = await fetch(
          `/api/messages?conversationId=${encodeURIComponent(conversation.id)}`
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data: Message[] = await res.json();
        if (!cancelled) {
          setMessages(data);
          // Requirement 12.3 — scroll to newest message on open
          requestAnimationFrame(() => scrollToBottomIfNear(true));
        }
      } catch (err) {
        if (!cancelled) {
          setFetchError(
            err instanceof Error ? err.message : "Failed to load messages"
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchMessages();

    // Requirement 12.13 — emit mark_read and update DB read cursor on open
    markConversationRead(conversation.id, currentUserId, socket, otherUserId);

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  // ── Auto-scroll on new messages ─────────────────────────────────────────────

  // Requirement 12.4 — auto-scroll if within 100px of bottom when messages update
  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottomIfNear();
    }
  }, [messages.length, scrollToBottomIfNear]);

  // ── Socket event listeners ──────────────────────────────────────────────────

  useEffect(() => {
    if (!socket) return;

    // Requirement 12.8 — append incoming messages from this conversation
    const onNewMessage = (msg: Message) => {
      if (msg.conversation_id !== conversation.id) return;
      setMessages((prev) => {
        // Deduplicate — optimistic messages are replaced by their server echo
        const exists = prev.some((m) => m.id === msg.id);
        return exists ? prev : [...prev, msg];
      });
      scrollToBottomIfNear();
      // Requirement 12.13 — mark read whenever a message arrives in the open thread
      markConversationRead(conversation.id, currentUserId, socket, otherUserId);
    };

    // Requirement 12.11 — show typing indicator with 3-second auto-clear
    const onUserTyping = (data: { conversationId: string; senderId: string }) => {
      if (data.conversationId !== conversation.id) return;
      if (data.senderId === currentUserId) return;

      setTypingUsers((prev) => {
        const next = new Map(prev);
        // Clear any existing timeout for this sender before setting a new one
        const existing = next.get(data.senderId);
        if (existing !== undefined) clearTimeout(existing);

        const handle = setTimeout(() => {
          setTypingUsers((m) => {
            const updated = new Map(m);
            updated.delete(data.senderId);
            return updated;
          });
        }, 3000);

        next.set(data.senderId, handle);
        return next;
      });
    };

    // Requirement 12.12 — immediately hide typing indicator on stop_typing
    const onUserStopTyping = (data: { conversationId: string; senderId: string }) => {
      if (data.conversationId !== conversation.id) return;
      setTypingUsers((prev) => {
        const next = new Map(prev);
        const existing = next.get(data.senderId);
        if (existing !== undefined) clearTimeout(existing);
        next.delete(data.senderId);
        return next;
      });
    };

    // message_read — update local read state (non-visual state, reserved for
    // future read-receipt UI; the event is consumed to prevent unhandled warnings)
    const onMessageRead = (_data: { conversationId: string; readerId: string }) => {
      // Future: update per-message read receipt indicators here
    };

    socket.on("new_message", onNewMessage);
    socket.on("user_typing", onUserTyping);
    socket.on("user_stop_typing", onUserStopTyping);
    socket.on("message_read", onMessageRead);

    return () => {
      socket.off("new_message", onNewMessage);
      socket.off("user_typing", onUserTyping);
      socket.off("user_stop_typing", onUserStopTyping);
      socket.off("message_read", onMessageRead);
    };
  }, [socket, conversation.id, currentUserId, otherUserId, scrollToBottomIfNear]);

  // ── Cleanup typing timeouts on unmount ─────────────────────────────────────

  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      typingUsers.forEach((handle) => clearTimeout(handle));
    };
  }, []); // intentionally empty — only on unmount

  // ── Send message ───────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    // Requirement 12.6 — clear input immediately for responsiveness
    setInput("");
    setSending(true);

    // Emit stop_typing when message is submitted (Requirement 12.10)
    if (otherUserId) {
      socket?.emit("stop_typing", {
        conversationId: conversation.id,
        senderId: currentUserId,
        receiverId: otherUserId,
      });
    }

    // Optimistic message so the UI feels instant
    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticMsg: Message = {
      id: optimisticId,
      conversation_id: conversation.id,
      sender_id: currentUserId,
      message_type: "text",
      content: trimmed,
      is_edited: false,
      is_deleted: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMsg]);
    requestAnimationFrame(() => scrollToBottomIfNear(true));

    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversation.id,
          senderRefId: currentUserId,
          content: trimmed,
          messageType: "text",
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const saved: Message = await res.json();

      // Replace optimistic message with the persisted one
      setMessages((prev) =>
        prev.map((m) => (m.id === optimisticId ? saved : m))
      );

      // Requirement 12.6 — emit private_message for real-time delivery
      if (otherUserId) {
        socket?.emit("private_message", {
          conversationId: conversation.id,
          senderId: currentUserId,
          receiverId: otherUserId,
          content: trimmed,
        });
      }
    } catch {
      // Requirement 12.7 — mark failed message with meta.failed = true
      setMessages((prev) =>
        prev.map((m) =>
          m.id === optimisticId
            ? { ...m, meta: { ...(m.meta ?? {}), failed: true } }
            : m
        )
      );
    } finally {
      setSending(false);
    }
  }, [input, sending, conversation.id, currentUserId, otherUserId, socket, scrollToBottomIfNear]);

  // Retry handler passed into MessageBubble
  const handleRetry = useCallback(
    async (failedMessage: Message) => {
      // Remove the failed optimistic message and re-send its content
      setMessages((prev) => prev.filter((m) => m.id !== failedMessage.id));
      setInput(failedMessage.content);
    },
    []
  );

  // ── Typing throttle ─────────────────────────────────────────────────────────

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);

      if (!otherUserId) return;

      // Requirement 12.9 — emit typing at most once per second
      const now = Date.now();
      if (now - lastTypingEmitRef.current > 1000) {
        socket?.emit("typing", {
          conversationId: conversation.id,
          senderId: currentUserId,
          receiverId: otherUserId,
        });
        lastTypingEmitRef.current = now;
      }
    },
    [otherUserId, socket, conversation.id, currentUserId]
  );

  // Requirement 12.10 — emit stop_typing on blur
  const handleInputBlur = useCallback(() => {
    if (!otherUserId) return;
    socket?.emit("stop_typing", {
      conversationId: conversation.id,
      senderId: currentUserId,
      receiverId: otherUserId,
    });
  }, [otherUserId, socket, conversation.id, currentUserId]);

  // Submit on Enter (without Shift)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // ── Determine showSenderInfo per bubble ─────────────────────────────────────

  /**
   * Returns true when the avatar + name label should be shown above a bubble.
   * We show it only for the first message in a consecutive run from the same sender.
   */
  function shouldShowSenderInfo(index: number): boolean {
    if (index === 0) return true;
    const prev = messages[index - 1];
    const curr = messages[index];
    return prev.sender_id !== curr.sender_id;
  }

  // ── Typing user display names ───────────────────────────────────────────────

  /**
   * Resolves a display name for a typing sender from the conversation participants.
   */
  function typingSenderName(senderId: string): string {
    const participant = conversation.participants.find(
      (p) => p.user_id === senderId
    );
    if (participant?.user) return getUserFullName(participant.user);
    return senderId;
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {/* Avatar */}
          <Avatar className="h-9 w-9 shrink-0">
            {otherUser?.profilePicture && (
              <AvatarImage
                src={otherUser.profilePicture}
                alt={displayName}
              />
            )}
            <AvatarFallback className="text-xs bg-secondary text-secondary-foreground">
              {avatarInitials}
            </AvatarFallback>
          </Avatar>

          {/* Name + online indicator */}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-none text-foreground">
              {displayName}
            </p>
          </div>
        </div>

        {/* Video call button — only for direct conversations (Requirement 14.1) */}
        {isDirect && otherUserId && (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={`Start video call with ${displayName}`}
            onClick={() => onStartCall(otherUserId)}
          >
            <Video className="h-5 w-5" />
          </Button>
        )}
      </div>

      {/* ── Message list ───────────────────────────────────────────────────── */}
      <div
        ref={scrollContainerRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-1"
      >
        {/* Loading skeleton */}
        {loading && (
          <div className="flex flex-col gap-3 pt-4" aria-busy="true" aria-label="Loading messages">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className={cn(
                  "h-10 rounded-2xl bg-muted animate-pulse",
                  i % 2 === 0 ? "w-2/3 self-end" : "w-1/2 self-start"
                )}
              />
            ))}
          </div>
        )}

        {/* Fetch error */}
        {!loading && fetchError && (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <p className="text-sm text-destructive">{fetchError}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // Re-trigger fetch by toggling a piece of state isn't needed —
                // easiest is to clear error so user knows to change conversation
                // and come back, or the parent can handle retry at a higher level.
                // For now, reload the page as a fallback.
                window.location.reload();
              }}
            >
              Retry
            </Button>
          </div>
        )}

        {/* Requirement 12.2 — empty state */}
        {!loading && !fetchError && messages.length === 0 && (
          <div className="flex items-center justify-center h-full py-10">
            <p className="text-sm text-muted-foreground italic">
              No messages yet. Say hello!
            </p>
          </div>
        )}

        {/* Message bubbles */}
        {!loading &&
          !fetchError &&
          messages.map((msg, index) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isOwn={msg.sender_id === currentUserId}
              showSenderInfo={shouldShowSenderInfo(index)}
              onRetry={handleRetry}
            />
          ))}

        {/* Typing indicators — Requirement 12.11 */}
        {Array.from(typingUsers.keys()).map((senderId) => (
          <TypingIndicator
            key={senderId}
            senderName={typingSenderName(senderId)}
          />
        ))}

        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>

      {/* ── Compose input ──────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t px-4 py-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            onKeyDown={handleKeyDown}
            placeholder="Type a message…"
            rows={1}
            className="flex-1 min-h-[40px] max-h-40 resize-none rounded-2xl py-2 px-3 text-sm leading-relaxed focus-visible:ring-1"
            aria-label="Message input"
            disabled={sending}
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!input.trim() || sending}
            aria-label="Send message"
            className="rounded-full h-10 w-10 shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
