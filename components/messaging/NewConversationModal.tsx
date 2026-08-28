"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Search, UserCircle2, AlertCircle, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  User,
  Conversation,
  getUserFullName,
  getUserInitials,
} from "@/lib/types";

// ─── Props ────────────────────────────────────────────────────────────────────

interface NewConversationModalProps {
  /** Called when the user dismisses the dialog without creating a conversation */
  onClose: () => void;
  /** Called with the newly-found or newly-created Conversation */
  onConversationCreated: (conv: Conversation) => void;
  /** ReferenceID of the currently logged-in user (excluded from search results) */
  currentUserId: string;
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────

function UserRowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2.5">
      <Skeleton className="h-10 w-10 rounded-full shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  );
}

// ─── User result row ──────────────────────────────────────────────────────────

interface UserRowProps {
  user: User;
  onSelect: (user: User) => void;
  isLoading: boolean;
}

function UserRow({ user, onSelect, isLoading }: UserRowProps) {
  const fullName = getUserFullName(user);
  const initials = getUserInitials(user);
  const subtitle = user.Role ?? user.Position ?? user.Department ?? user.Email ?? "";

  return (
    <button
      type="button"
      disabled={isLoading}
      onClick={() => onSelect(user)}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
        "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-50"
      )}
      aria-label={`Start conversation with ${fullName}`}
    >
      <Avatar className="h-10 w-10 shrink-0">
        {user.profilePicture && (
          <AvatarImage src={user.profilePicture} alt={fullName} />
        )}
        <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold uppercase">
          {initials}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{fullName}</p>
        {subtitle && (
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>
    </button>
  );
}

// ─── NewConversationModal ─────────────────────────────────────────────────────

/**
 * Dialog for searching users and starting a new direct conversation.
 *
 * Requirements 13.1–13.6:
 *  - Calls /api/users/search with 300ms debounce once keyword ≥ 2 chars
 *  - Excludes currentUserId from results via excludeRefId param
 *  - Shows empty state when keyword < 2 or no results found
 *  - On selection calls POST /api/conversations and invokes onConversationCreated
 *  - Shows inline error with retry option on API failure
 */
export function NewConversationModal({
  onClose,
  onConversationCreated,
  currentUserId,
}: NewConversationModalProps) {
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Keep a ref to the latest keyword to avoid stale closures inside the
  // debounce timer.
  const keywordRef = useRef(keyword);
  keywordRef.current = keyword;

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Search with 300ms debounce ─────────────────────────────────────────────

  const runSearch = useCallback(
    async (kw: string) => {
      // Requirement 13.2: don't call API if fewer than 2 chars
      if (kw.trim().length < 2) {
        setResults([]);
        setSearchError(null);
        return;
      }

      setSearching(true);
      setSearchError(null);

      try {
        const params = new URLSearchParams({
          keyword: kw.trim(),
          excludeRefId: currentUserId,
        });
        const res = await fetch(`/api/users/search?${params.toString()}`);

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? `Search failed (${res.status})`);
        }

        // Guard against a response for a stale keyword
        if (keywordRef.current.trim() !== kw.trim()) return;

        const data: User[] = await res.json();
        setResults(data);
      } catch (err) {
        if (keywordRef.current.trim() !== kw.trim()) return;
        setSearchError(err instanceof Error ? err.message : "Search failed. Please try again.");
        setResults([]);
      } finally {
        // Only clear the spinner if this is still the active search
        if (keywordRef.current.trim() === kw.trim()) {
          setSearching(false);
        }
      }
    },
    [currentUserId]
  );

  // Debounced search — Requirement 13.1
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (keyword.trim().length < 2) {
      setResults([]);
      setSearchError(null);
      setSearching(false);
      return;
    }

    // Show a brief loading state immediately so the UI doesn't feel frozen
    setSearching(true);
    debounceTimerRef.current = setTimeout(() => {
      runSearch(keyword);
    }, 300);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [keyword, runSearch]);

  // ── Start conversation on user select ────────────────────────────────────

  const handleSelectUser = useCallback(
    async (user: User) => {
      setSelectedUser(user);
      setCreateError(null);
      setCreating(true);

      try {
        const res = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user1RefId: currentUserId,
            user2RefId: user.ReferenceID,
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? `Failed to create conversation (${res.status})`);
        }

        const conversation: Conversation = await res.json();
        onConversationCreated(conversation);
        onClose();
      } catch (err) {
        setCreateError(
          err instanceof Error ? err.message : "Could not start the conversation. Please try again."
        );
        setCreating(false);
      }
    },
    [currentUserId, onConversationCreated, onClose]
  );

  const handleRetryCreate = useCallback(() => {
    if (selectedUser) {
      handleSelectUser(selectedUser);
    }
  }, [selectedUser, handleSelectUser]);

  // ── Determine what to render in the list area ─────────────────────────────

  const trimmedKeyword = keyword.trim();

  const showSkeletons = searching;
  const showResults = !searching && results.length > 0 && !searchError;
  const showSearchError = !searching && Boolean(searchError);
  const showEmptyKeyword = !searching && trimmedKeyword.length < 2;
  const showNoResults =
    !searching && trimmedKeyword.length >= 2 && results.length === 0 && !searchError;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="text-base font-semibold">New Conversation</DialogTitle>
        </DialogHeader>

        {/* Search input */}
        <div className="px-4 pt-4 pb-2">
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
              aria-hidden="true"
            />
            <Input
              type="search"
              placeholder="Search by name, email, or username…"
              value={keyword}
              onChange={(e) => {
                setKeyword(e.target.value);
                // Clear create error when user starts a new search
                setCreateError(null);
                setSelectedUser(null);
              }}
              className="pl-9"
              autoFocus
              aria-label="Search users"
              aria-busy={searching}
            />
          </div>
        </div>

        {/* Create error banner */}
        {createError && (
          <div
            role="alert"
            className="mx-4 mb-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">{createError}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRetryCreate}
              disabled={creating}
              className="h-auto px-2 py-0.5 text-xs text-destructive hover:text-destructive gap-1 shrink-0"
              aria-label="Retry starting the conversation"
            >
              <RotateCcw className="h-3 w-3" />
              Retry
            </Button>
          </div>
        )}

        {/* Results area */}
        <div
          className="overflow-y-auto px-2 pb-4"
          style={{ maxHeight: "20rem", minHeight: "6rem" }}
          role="listbox"
          aria-label="Search results"
          aria-live="polite"
          aria-busy={searching}
        >
          {/* Loading skeletons */}
          {showSkeletons && (
            <div aria-label="Searching…">
              <UserRowSkeleton />
              <UserRowSkeleton />
              <UserRowSkeleton />
            </div>
          )}

          {/* Search error */}
          {showSearchError && (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <AlertCircle className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">{searchError}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => runSearch(keyword)}
                className="gap-2 mt-1"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Try again
              </Button>
            </div>
          )}

          {/* Prompt to type more — Requirement 13.2 */}
          {showEmptyKeyword && (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <UserCircle2
                className="h-10 w-10 text-muted-foreground/40"
                aria-hidden="true"
              />
              <p className="text-sm text-muted-foreground">
                Type at least 2 characters to search for colleagues
              </p>
            </div>
          )}

          {/* No results — Requirement 13.3 */}
          {showNoResults && (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <UserCircle2
                className="h-10 w-10 text-muted-foreground/40"
                aria-hidden="true"
              />
              <p className="text-sm text-muted-foreground">
                No users found matching &ldquo;{trimmedKeyword}&rdquo;
              </p>
            </div>
          )}

          {/* User result rows */}
          {showResults &&
            results.map((user) => (
              <UserRow
                key={user.ReferenceID}
                user={user}
                onSelect={handleSelectUser}
                isLoading={creating && selectedUser?.ReferenceID === user.ReferenceID}
              />
            ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default NewConversationModal;
