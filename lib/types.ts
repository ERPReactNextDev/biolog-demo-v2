// lib/types.ts
// Shared TypeScript interfaces and pure helper functions for the Biolog Messaging module.
// Safe to import in both client and server code.

export type ReferenceID = string;

export interface User {
  id: number;                         // bigint PK stored as number
  ReferenceID: ReferenceID;
  Firstname?: string;
  Lastname?: string;
  Email?: string;
  userName?: string;
  Role?: string;
  Position?: string;
  Department?: string;
  profilePicture?: string;
  ContactNumber?: string;
  Status?: string;
}

export interface Conversation {
  id: string;                         // UUID
  conversation_type: 'direct' | 'group';
  created_by: ReferenceID;
  last_message_at: string;            // ISO-8601
  created_at: string;                 // ISO-8601
  updated_at: string;                 // ISO-8601
  name?: string;
  description?: string;
  photo_url?: string;
}

export interface ConversationParticipant {
  id: number;
  conversation_id: string;            // UUID
  user_id: ReferenceID;
  role: 'admin' | 'member';
  last_read_message_id?: string;
  last_seen_at?: string;              // ISO-8601
  user?: User;
}

export interface Message {
  id: string;                         // UUID
  conversation_id: string;
  sender_id: ReferenceID;
  message_type: 'text' | 'image' | 'file' | 'link' | 'voice' | 'video' | 'location' | 'system';
  content: string;
  is_edited: boolean;
  is_deleted: boolean;
  created_at: string;                 // ISO-8601
  updated_at: string;                 // ISO-8601
  reply_to_message_id?: string;
  meta?: Record<string, unknown>;
  sender?: User;
  reactions?: MessageReaction[];
}

export interface MessageReaction {
  id: number;
  message_id: string;
  user_id: ReferenceID;
  reaction: string;
  created_at: string;                 // ISO-8601
}

/**
 * Returns the user's full display name.
 * Priority: trimmed "Firstname Lastname" → userName → ReferenceID
 */
export function getUserFullName(user: User): string {
  const first = (user.Firstname ?? '').trim();
  const last = (user.Lastname ?? '').trim();
  const full = [first, last].filter(Boolean).join(' ');
  if (full.length > 0) return full;
  if (user.userName && user.userName.trim().length > 0) return user.userName.trim();
  return user.ReferenceID;
}

/**
 * Returns 1-2 uppercase initials.
 * Priority: first char of Firstname + first char of Lastname → single available initial → first 2 chars of ReferenceID
 */
export function getUserInitials(user: User): string {
  const first = (user.Firstname ?? '').trim();
  const last = (user.Lastname ?? '').trim();
  if (first.length > 0 && last.length > 0) {
    return (first[0] + last[0]).toUpperCase();
  }
  if (first.length > 0) return first[0].toUpperCase();
  if (last.length > 0) return last[0].toUpperCase();
  return user.ReferenceID.slice(0, 2).toUpperCase();
}
