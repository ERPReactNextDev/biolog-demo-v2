# Implementation Plan: Biolog Messaging + WebRTC Video Call

## Overview

Implement the Biolog Messaging + WebRTC module as a dedicated Messaging tab within the existing Acculog Next.js 14+ App Router project. The implementation follows a bottom-up order: shared types and utilities first, then the API layer, then the Socket.IO server, then hooks, then UI components, and finally the test suite. All files are new additions; no existing files are modified except `.env.local`.

---

## Tasks

- [x] 1. Shared types and utilities (`lib/types.ts`, `lib/supabase-admin.ts`)
  - [x] 1.1 Create `lib/types.ts` with all exported interfaces and helper functions
    - Export `ReferenceID` type alias as `string`
    - Export `User`, `Conversation`, `ConversationParticipant`, `Message`, `MessageReaction` interfaces exactly as specified in the Data Models section of the design
    - Implement `getUserFullName(user: User): string` — priority: trimmed "Firstname Lastname" → `userName` → `ReferenceID`
    - Implement `getUserInitials(user: User): string` — priority: first char of each name → single initial → first 2 chars of `ReferenceID` uppercased
    - Both functions must be pure and deterministic
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10_

  - [x] 1.2 Create `lib/supabase-admin.ts` service-role client
    - Import `createClient` from `@supabase/supabase-js`
    - Export `supabaseAdmin` using `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` env vars
    - Add a comment warning against client-component imports
    - _Requirements: 2.1, 3.1 (dependency for all API routes)_

  - [x] 1.3 Add required environment variables to `.env.local`
    - Add `SUPABASE_SERVICE_ROLE_KEY=` (server-side only)
    - Add `NEXT_PUBLIC_SOCKET_URL=http://localhost:3001`
    - Add `SOCKET_PORT=3001`
    - _Requirements: 8.1, 9.1 (socket and WebRTC configuration dependency)_

- [x] 2. API Routes
  - [x] 2.1 Create `app/api/conversations/route.ts` — GET and POST handlers
    - **GET**: validate `referenceId` query param (non-empty) → 400 if missing/empty; query `conversation_participants` for user's conversation IDs; join `conversations` ordered by `last_message_at DESC`; for each conversation fetch all participants with nested `user` join; return `200 Conversation[]`
    - **POST**: validate `user1RefId` and `user2RefId` body fields (both non-empty strings) → 400 per field if invalid; find intersection of both users' conversation IDs filtered by `conversation_type = 'direct'`; if found return `200` existing; if not found insert new `conversations` row + two `conversation_participants` rows, return `201`
    - Wrap all DB calls in try/catch; return `500` with generic message on DB failure; never expose stack traces or internal details
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 2.2 Create `app/api/messages/route.ts` — GET, POST, and PATCH handlers
    - **GET**: validate `conversationId` non-empty → 400; verify conversation exists → 404; select messages where `is_deleted = false` ordered by `created_at ASC` limit 100 with nested `sender` join; return `200 Message[]`
    - **POST**: validate `conversationId`, `senderRefId`, `content` all non-empty and `content.length ≤ 2000` → 400 if any fail; insert message row with `message_type = messageType ?? 'text'`, `is_edited = false`, `is_deleted = false`; return `201 Message` with sender; rely on DB trigger for `last_message_at` update
    - **PATCH**: validate `conversationId` and `referenceId` non-empty → 400; find latest message by `created_at DESC LIMIT 1`; update `conversation_participants` `last_read_message_id` and `last_seen_at`; if 0 rows updated → 404; return `200` updated participant
    - Wrap all DB calls in try/catch; return `500` on DB failure
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

  - [x] 2.3 Create `app/api/users/search/route.ts` — GET handler
    - Validate `keyword`: must be present, non-empty after trim, ≥ 1 non-whitespace char, ≤ 200 characters → 400 with reason if any fail
    - Query `users` with ILIKE on `Firstname`, `Lastname`, `Email`, `userName`; exclude `excludeRefId` if provided; order by `Lastname ASC, Firstname ASC`; limit 20
    - Return `200 User[]`; return `500` on DB failure
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 3. Socket.IO Server (`socket-server.ts`)
  - [x] 3.1 Create `socket-server.ts` standalone Socket.IO server
    - Import `http`, `Server` from `socket.io`; listen on `SOCKET_PORT` (default 3001)
    - Declare `const onlineUsers = new Map<string, string>()` (ReferenceID → socket.id)
    - Implement `requireFields(data, fields, socket): boolean` validation helper; emit `error` event and return `false` on missing/empty/non-string field
    - Implement `isOnline(referenceId: string): boolean` export for testability
    - Handle `user_connected`: validate `referenceId`; `onlineUsers.set(referenceId, socket.id)` replacing existing entry
    - Handle `disconnect`: remove all entries where value = disconnected `socket.id`
    - Handle `private_message` (`conversationId, senderId, receiverId, content`): validate all four fields; look up `receiverId` in Online_Map; emit `new_message` to target socket; silently drop if offline
    - Handle `typing` (`conversationId, senderId, receiverId`): validate; forward `user_typing { conversationId, senderId }` to `receiverId` socket; silently drop if offline
    - Handle `stop_typing`: same pattern as `typing`, forward `user_stop_typing`
    - Handle `mark_read` (`conversationId, userId, readerId`): validate; forward `message_read { conversationId, readerId }` to `userId` socket; silently drop if offline
    - Handle `initiate_call` (`callerId, calleeId, callerName`): validate; forward `call_incoming { callerId, callerName }` to `calleeId` socket
    - Handle `webrtc_offer` (`offer, calleeId`): validate presence (offer is object, calleeId is string); forward `webrtc_offer { offer, from: socket.id }` to `calleeId` socket
    - Handle `webrtc_answer` (`answer, callerId`): validate presence; forward `webrtc_answer { answer }` to `callerId` socket
    - Handle `webrtc_ice_candidate` (`candidate, targetId`): validate; forward `webrtc_ice_candidate { candidate }` to `targetId` socket
    - Handle `end_call` (`targetId`): validate; forward `call_ended` to `targetId` socket
    - All forwarding silently drops if target not in Online_Map; all async handlers wrapped in try/catch
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

- [x] 4. React Hooks
  - [x] 4.1 Create `hooks/useSocket.ts`
    - Add `"use client"` directive
    - Accept `userId: string | null`; return `{ socket: Socket | null; isConnected: boolean; emit: (...) => void }`
    - If `userId` is null/empty, do NOT establish a connection; `isConnected` stays `false`
    - On connect: `setIsConnected(true)`, emit `user_connected { referenceId: userId }`
    - On disconnect: `setIsConnected(false)`
    - On reconnect (via `socketInstance.io.on('reconnect')`): re-emit `user_connected` to restore Online_Map entry
    - On unmount: call `socketInstance.disconnect()`, remove listeners, null the ref
    - `emit` helper: calls `socketRef.current?.emit(event, ...args)` — safe if socket is null
    - Use `useRef` for socket instance, `useCallback` for `emit`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [x] 4.2 Create `hooks/useWebRTC.ts`
    - Add `"use client"` directive
    - Define module-level frozen `RTC_CONFIG` with 9 STUN servers, `iceCandidatePoolSize: 10`, `rtcpMuxPolicy: 'require'`, `bundlePolicy: 'max-bundle'`
    - Define `getUserMediaWithTimeout(constraints)` helper with 30-second timeout via `Promise.race`
    - State: `localStream`, `remoteStream`, `isCallActive`, `isCalling`, `isReceivingCall`, `error`
    - Refs: `peerConnectionRef`, `localStreamRef`, `remoteIdRef`, `callTimeoutRef`
    - Implement `startCall(calleeId, callType?)`: guard empty calleeId (no-op); `setIsCalling(true)`; acquire media with timeout; create `RTCPeerConnection(RTC_CONFIG)`; add tracks; wire `ontrack` and `onicecandidate`; create offer; `setLocalDescription`; emit `webrtc_offer`; emit `initiate_call`; on media error: `setError`, reset `isCalling`
    - Implement `handleOffer({ from, offer })`: `setIsReceivingCall(true)`; create peer connection; wire handlers; acquire media; add tracks; `setRemoteDescription(offer)`; create answer; `setLocalDescription`; emit `webrtc_answer`; on media error: reset
    - Implement `handleAnswer({ answer })`: `setRemoteDescription(answer)`; `setIsCallActive(true)`
    - Implement `handleIceCandidate({ candidate })`: early return if no `peerConnectionRef.current`; `addIceCandidate`
    - Implement `endCall()`: `clearTimeout`; stop all local tracks; `peerConnection.close()`; emit `end_call` if `remoteIdRef.current` set; reset all state and refs to initial values
    - Return all public API members
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10, 10.11_

- [x] 5. Checkpoint — API and hooks foundation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Messaging UI Components
  - [x] 6.1 Create `components/messaging/MessageBubble.tsx`
    - Props: `message: Message`, `isOwn: boolean`, `showSenderInfo: boolean`
    - Own messages: right-aligned, `bg-primary text-primary-foreground`
    - Other messages: left-aligned, `bg-muted`, show sender avatar (initials via `getUserInitials`) + name via `getUserFullName`
    - Show `message.content`
    - Show `created_at` formatted as `HH:mm` using `date-fns format`
    - If `message.meta?.failed`: show ⚠ icon + "Retry" button
    - If `message.is_edited`: show "(edited)" label
    - _Requirements: 12.5, 12.7_

  - [x] 6.2 Create `components/messaging/TypingIndicator.tsx`
    - Props: `senderName: string`
    - Render "{senderName} is typing..." with three animated bouncing dots
    - Use `framer-motion` for staggered dot animation
    - _Requirements: 12.11_

  - [x] 6.3 Create `components/messaging/ConversationItem.tsx`
    - Props: `conversation: Conversation`, `currentUserId: string`, `isSelected: boolean`, `onClick: () => void`
    - Avatar: if `otherUser?.profilePicture` → `<img>`; else → div with `getUserInitials(otherUser)` or group initials
    - Name: `getUserFullName(otherUser)` for direct; `conversation.name ?? 'Group Chat'` for group
    - Preview: truncate content to 60 chars + "…"
    - Timestamp: `formatDistanceToNow` from `date-fns` with `{ addSuffix: true }`
    - Selected state: `bg-accent` highlight
    - Unread indicator: small blue dot if `last_message_at > participant.last_seen_at`
    - _Requirements: 11.3, 11.5_

  - [x] 6.4 Create `components/messaging/ConversationList.tsx`
    - Props: `ConversationListProps` as per design interface contract
    - State: `filterQuery: string`
    - Header: "Messages" title + "New" button (PencilLine icon from `lucide-react`)
    - Controlled search input filtering `conversations` by `getConversationDisplayName` in-memory (no debounce needed)
    - Loading state: 3 skeleton rows
    - Error state: error message + "Retry" button (calls `onRetry`)
    - Empty state (no conversations): "No conversations yet" + "Start one" CTA
    - Empty state (filter no match): "No conversations match '...'"
    - Render filtered list as `<ConversationItem>` components
    - _Requirements: 11.1, 11.2, 11.3, 11.6, 11.7_

  - [x] 6.5 Create `components/messaging/MessageThread.tsx`
    - Props: `MessageThreadProps` as per design interface contract
    - State: `messages[]`, `input`, `sending`, `typingUsers: Map<string, NodeJS.Timeout>`
    - Refs: `scrollContainerRef`, `bottomRef`, `lastTypingEmitRef`
    - On mount / `conversation.id` change: fetch `GET /api/messages?conversationId=...`; emit `mark_read`; call `PATCH /api/messages`
    - Socket listeners: `new_message` → append + auto-scroll if within 100px of bottom + mark read; `user_typing` → add to `typingUsers` with 3s auto-clear; `user_stop_typing` → immediately clear sender; `message_read` → update local read cursor
    - Send handler: validate non-empty input; `POST /api/messages`; emit `private_message`; clear input; on error mark message with `meta.failed = true`
    - Typing throttle: emit `typing` at most once per second (compare `Date.now()` vs `lastTypingEmitRef.current`)
    - onBlur / onSubmit: emit `stop_typing`
    - Auto-scroll on `messages.length` change: `scrollIntoView({ behavior: 'smooth' })` if within 100px threshold
    - Header: other user avatar, name, online indicator, call button (direct conversations only)
    - Render `<MessageBubble>` for each message; render `<TypingIndicator>` for each entry in `typingUsers`
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10, 12.11, 12.12, 12.13_

  - [x] 6.6 Create `components/messaging/NewConversationModal.tsx`
    - Use Radix UI `Dialog` (shadcn/ui Dialog component)
    - Props: `onClose: () => void`, `onConversationCreated: (conv: Conversation) => void`
    - State: `keyword`, `results: User[]`, `searching`, `error`, `selectedUser`
    - `useEffect` watching `keyword` with 300ms debounce: skip if `keyword.trim().length < 2`; call `GET /api/users/search?keyword=...&excludeRefId=currentUserId`
    - On user select: `POST /api/conversations { user1RefId, user2RefId }`; on success call `onConversationCreated` + close; on error show inline error + retry option
    - Render: search input, user result rows (avatar, name, role), loading skeleton, empty state, error state
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

  - [x] 6.7 Create `components/messaging/IncomingCallAlert.tsx`
    - Props: `IncomingCallAlertProps` as per design interface contract
    - Fixed position: `top-4 right-4 z-50`
    - `framer-motion`: slide in from right + pulse ring animation
    - Show caller avatar initials, "Incoming call from {callerName}"
    - Accept button (green, `Phone` icon from `lucide-react`) → `onAccept()`
    - Decline button (red, `PhoneOff` icon) → `onDecline()`
    - `useEffect`: auto-dismiss after 30 seconds → calls `onDecline()`
    - _Requirements: 14.3, 14.5_

  - [x] 6.8 Create `components/messaging/VideoCallOverlay.tsx`
    - Props: `VideoCallOverlayProps` as per design interface contract
    - Fixed full-screen overlay, `z-40`, dark background
    - Remote video: `<video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />`; attach `remoteStream` via `useEffect`
    - Local video (PiP): absolute `bottom-4 right-4 w-40 h-30 rounded-xl border-2 white`; attach `localStream` via `useEffect`
    - Calling state (`isCalling && !isCallActive`): centered spinner + "Calling..." text
    - End call button: absolute `bottom-8` center, red circle, `PhoneOff` icon → `onEndCall()`
    - Error banner: absolute `top-4` center, red/amber background, `error` message, dismiss (X) button
    - _Requirements: 14.6, 14.7, 14.9_

- [x] 7. Messaging Page (`app/messaging/page.tsx`)
  - [x] 7.1 Create `app/messaging/page.tsx` — root layout and wiring
    - Add `"use client"` directive
    - Read `userId` from `useUser()` context; redirect to login if null
    - State: `selectedConversation`, `conversations`, `showNewConvModal`, `incomingCall`
    - Call `useSocket(userId)` and `useWebRTC(socket, userId ?? '')`
    - Register socket event listeners in `useEffect`:
      - `new_message` → move affected conversation to top of list, update preview and timestamp
      - `call_incoming` → `setIncomingCall({ callerId, callerName })`
      - `webrtc_offer` → call `handleOffer(data)`
      - `webrtc_answer` → call `handleAnswer(data)`
      - `webrtc_ice_candidate` → call `handleIceCandidate(data)`
      - `call_ended` → call `endCall()`
    - 60-second call timeout `useEffect` watching `[isCalling, isCallActive]`: if `isCalling && !isCallActive` set 60s timeout → `endCall()` + `toast("Call not answered")`; clear timeout when `isCallActive` becomes true or `isCalling` becomes false
    - Layout: full-height flex; `<ConversationList>` (w-80, shrink-0, border-r); flex-1 area with `<MessageThread>` or empty-state; conditional `<IncomingCallAlert>`; conditional `<VideoCallOverlay>`; conditional `<NewConversationModal>`
    - Pass `startCall` to `<MessageThread>` via `onStartCall` prop
    - _Requirements: 11.1, 11.4, 11.5, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10_

- [x] 8. Checkpoint — Full UI wired end-to-end
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Test Suite
  - [x] 9.1 Create `__tests__/messaging/types.test.ts` — property-based tests for pure helpers
    - Import `fc` from `fast-check` and the two helper functions from `lib/types`
    - Define `userArb` arbitrary as specified in the design testing strategy
    - **Property 1: getUserFullName fallback chain** — assert correct priority: trimmed full name → userName → ReferenceID
      - Tag: `// Feature: biolog-messaging-webrtc, Property 1: getUserFullName fallback chain`
      - _Validates: Requirements 1.7_
    - **Property 2: getUserFullName non-empty** — assert result is never empty string
      - Tag: `// Feature: biolog-messaging-webrtc, Property 2: getUserFullName is non-empty`
      - _Validates: Requirements 1.7_
    - **Property 3: getUserFullName deterministic** — assert two calls return identical values
      - Tag: `// Feature: biolog-messaging-webrtc, Property 3: getUserFullName is deterministic`
      - _Validates: Requirements 1.10, 15.3_
    - **Property 4: getUserInitials length and case** — assert length 1–2, all uppercase
      - Tag: `// Feature: biolog-messaging-webrtc, Property 4: getUserInitials length and case`
      - _Validates: Requirements 1.8, 1.9_
    - **Property 5: getUserInitials fallback chain** — assert correct priority per design
      - Tag: `// Feature: biolog-messaging-webrtc, Property 5: getUserInitials fallback chain`
      - _Validates: Requirements 1.8, 1.9_
    - **Property 6: getUserInitials deterministic** — assert two calls return identical values
      - Tag: `// Feature: biolog-messaging-webrtc, Property 6: getUserInitials is deterministic`
      - _Validates: Requirements 1.10, 15.4_

  - [x] 9.2 Create `__tests__/messaging/conversations.api.test.ts` — unit + property tests
    - Mock `lib/supabase-admin.ts` module
    - Example: `GET /api/conversations` without `referenceId` → 400
    - Example: `POST /api/conversations` with `user1RefId` missing → 400 with field name in response
    - Example: `POST /api/conversations` with same pair twice (mock Supabase returning existing) → second call returns 200
    - Example: Supabase throws on GET → 500 with generic message (no internal details)
    - **Property 7: Direct conversation creation is idempotent** — with mock returning existing conversation, two identical POST calls return the same `id`
      - Tag: `// Feature: biolog-messaging-webrtc, Property 7: Direct conversation creation is idempotent`
      - _Validates: Requirements 2.4, 2.5_

  - [x] 9.3 Create `__tests__/messaging/messages.api.test.ts` — unit + property tests
    - Mock `lib/supabase-admin.ts` module
    - Example: `GET /api/messages` without `conversationId` → 400
    - Example: `GET /api/messages` with valid `conversationId` not in DB (mock 0 rows) → 404
    - Example: `POST /api/messages` with `content` missing → 400
    - Example: `PATCH /api/messages` with no matching participant → 404
    - **Property 8: Message content validation boundary** — content > 2000 chars → 400; 1–2000 chars with valid other fields → not 400 due to content length
      - Tag: `// Feature: biolog-messaging-webrtc, Property 8: Message content validation boundary`
      - _Validates: Requirements 3.5_

  - [x] 9.4 Create `__tests__/messaging/users.search.api.test.ts` — unit + property tests
    - Mock `lib/supabase-admin.ts` module
    - Example: `GET /api/users/search` without `keyword` → 400
    - Example: `GET /api/users/search?keyword=` (empty) → 400
    - Example: `GET /api/users/search?keyword=abc` → 200 with mocked user array
    - Example: keyword > 200 chars → 400 with reason
    - **Property 9: User search rejects all-whitespace keywords** — `fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 1 })` → 400
      - Tag: `// Feature: biolog-messaging-webrtc, Property 9: User search rejects all-whitespace keywords`
      - _Validates: Requirements 4.3_

  - [x] 9.5 Create `__tests__/messaging/socket.server.test.ts` — unit + property tests for Socket.IO server
    - Import `onlineUsers` map and `isOnline` export from `socket-server.ts`
    - Create mock Socket helper (object with `emit: jest.fn()`, `id: string`)
    - Example: `user_connected` with valid `referenceId` → entry added to `onlineUsers`
    - Example: `user_connected` with empty `referenceId` → `error` event emitted, `onlineUsers` unchanged
    - Example: `disconnect` → removes correct entry from `onlineUsers`
    - Example: `private_message` with receiver online → `new_message` emitted to receiver socket only
    - Example: `private_message` with receiver offline → no event emitted to any socket
    - Example: `private_message` missing `content` → `error` emitted to sender, no forwarding
    - **Property 10: Online_Map round-trip** — for any non-empty `refId`: set → `isOnline` true; delete → `isOnline` false
      - Tag: `// Feature: biolog-messaging-webrtc, Property 10: Online_Map round-trip`
      - _Validates: Requirements 5.1, 5.3, 5.4_
    - **Property 11: private_message forwarding correctness** — when `receiverId` in map, `new_message` emitted to exactly the correct socket
      - Tag: `// Feature: biolog-messaging-webrtc, Property 11: private_message forwarding correctness`
      - _Validates: Requirements 6.1_
    - **Property 12: private_message validation completeness** — any payload missing one of `conversationId/senderId/receiverId/content` or containing empty string → `error` emitted to sender, no forwarding
      - Tag: `// Feature: biolog-messaging-webrtc, Property 12: private_message validation completeness`
      - _Validates: Requirements 6.2_

  - [x] 9.6 Create `__tests__/messaging/useSocket.test.ts` — renderHook lifecycle tests
    - Mock `socket.io-client` module
    - Example: `useSocket(null)` → `io()` not called, `isConnected = false`
    - Example: `useSocket('')` → `io()` not called
    - Example: `useSocket('REF123')` → `io()` called with correct URL; `user_connected` emitted on simulated `connect` event
    - Example: simulate `connect` event → `isConnected` becomes `true`
    - Example: simulate `disconnect` event → `isConnected` becomes `false`
    - Example: unmount → `disconnect()` called on socket instance (no memory leaks)

  - [x] 9.7 Create `__tests__/messaging/useWebRTC.test.ts` — smoke tests and example tests
    - Mock `navigator.mediaDevices.getUserMedia`
    - Mock `RTCPeerConnection`
    - Smoke: `RTC_CONFIG.iceServers.length >= 5`
    - Smoke: `RTC_CONFIG.iceCandidatePoolSize === 10`
    - Smoke: `RTC_CONFIG.rtcpMuxPolicy === 'require'`
    - Smoke: `RTC_CONFIG.bundlePolicy === 'max-bundle'`
    - Example: `startCall('')` → `isCalling` remains `false` (empty calleeId guard — no-op)
    - Example: `getUserMedia` rejects with `NotAllowedError` → `error` state contains message, `isCalling = false`
    - Example: `endCall()` stops all local tracks and closes peer connection

- [ ] 10. Final checkpoint — Ensure all tests pass
  - Run `npx jest --testPathPattern=__tests__/messaging --runInBand` and verify all tests pass
  - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (Properties 1–12 are unit-testable; Properties 13–14 require integration tests against a live Supabase instance)
- Unit tests validate specific examples and edge cases
- The Socket.IO server (`socket-server.ts`) is a standalone Node process — start it separately with `npx ts-node socket-server.ts` alongside `npm run dev`
- The `supabase-admin.ts` client uses the service role key and must never be imported in client components

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "3.1"] },
    { "id": 2, "tasks": ["4.1", "4.2"] },
    { "id": 3, "tasks": ["6.1", "6.2", "6.3"] },
    { "id": 4, "tasks": ["6.4", "6.5", "6.6", "6.7", "6.8"] },
    { "id": 5, "tasks": ["7.1"] },
    { "id": 6, "tasks": ["9.1", "9.2", "9.3", "9.4", "9.5", "9.6", "9.7"] }
  ]
}
```
