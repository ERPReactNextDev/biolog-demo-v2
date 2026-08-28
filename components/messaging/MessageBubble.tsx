"use client";

import React from "react";
import { format } from "date-fns";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Message, getUserInitials, getUserFullName } from "@/lib/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  showSenderInfo: boolean;
  onRetry?: (message: Message) => void;
}

export function MessageBubble({
  message,
  isOwn,
  showSenderInfo,
  onRetry,
}: MessageBubbleProps) {
  const hasFailed = Boolean(message.meta?.failed);

  const formattedTime = React.useMemo(() => {
    try {
      return format(new Date(message.created_at), "HH:mm");
    } catch {
      return "";
    }
  }, [message.created_at]);

  const senderInitials = React.useMemo(() => {
    if (!message.sender) return "??";
    return getUserInitials(message.sender);
  }, [message.sender]);

  const senderName = React.useMemo(() => {
    if (!message.sender) return message.sender_id;
    return getUserFullName(message.sender);
  }, [message.sender, message.sender_id]);

  return (
    <div
      className={cn(
        "flex items-end gap-2 w-full",
        isOwn ? "flex-row-reverse" : "flex-row"
      )}
    >
      {/* Sender avatar — only shown for others, with spacing reserved for alignment */}
      {!isOwn && (
        <div className="shrink-0 mb-1">
          {showSenderInfo ? (
            <Avatar className="h-8 w-8">
              {message.sender?.profilePicture && (
                <AvatarImage
                  src={message.sender.profilePicture}
                  alt={senderName}
                />
              )}
              <AvatarFallback className="text-xs bg-secondary text-secondary-foreground">
                {senderInitials}
              </AvatarFallback>
            </Avatar>
          ) : (
            // Placeholder to keep bubbles aligned when avatar is hidden
            <div className="h-8 w-8" />
          )}
        </div>
      )}

      {/* Bubble + metadata */}
      <div
        className={cn(
          "flex flex-col max-w-[70%] gap-1",
          isOwn ? "items-end" : "items-start"
        )}
      >
        {/* Sender name — only for other users when showSenderInfo is true */}
        {!isOwn && showSenderInfo && (
          <span className="text-xs font-medium text-muted-foreground px-1">
            {senderName}
          </span>
        )}

        {/* Bubble */}
        <div
          className={cn(
            "relative rounded-2xl px-4 py-2 text-sm leading-relaxed break-words",
            isOwn
              ? "bg-primary text-primary-foreground rounded-br-sm"
              : "bg-muted text-foreground rounded-bl-sm",
            hasFailed && "opacity-70"
          )}
        >
          {message.content}

          {/* Failed indicator inside bubble */}
          {hasFailed && (
            <span
              className="inline-flex items-center gap-1 ml-2 align-middle text-destructive-foreground"
              aria-label="Message failed to send"
            >
              <AlertTriangle className="h-3.5 w-3.5 text-yellow-400 shrink-0" />
            </span>
          )}
        </div>

        {/* Footer: timestamp, edited label, retry button */}
        <div
          className={cn(
            "flex items-center gap-2 px-1",
            isOwn ? "flex-row-reverse" : "flex-row"
          )}
        >
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {formattedTime}
          </span>

          {message.is_edited && (
            <span className="text-[11px] text-muted-foreground italic">
              (edited)
            </span>
          )}

          {hasFailed && onRetry && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto px-1.5 py-0.5 text-[11px] text-destructive hover:text-destructive gap-1"
              onClick={() => onRetry(message)}
              aria-label="Retry sending message"
            >
              <RotateCcw className="h-3 w-3" />
              Retry
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default MessageBubble;
