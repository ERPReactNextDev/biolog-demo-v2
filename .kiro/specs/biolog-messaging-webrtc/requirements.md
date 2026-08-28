# Requirements Document

## Introduction

This document defines requirements for the **Biolog Messaging + WebRTC Video Call** module — a new tab within the Biolog Attendance and Time Tracking System. The feature adds real-time direct and group messaging backed by Supabase PostgreSQL, delivered via Socket.IO, and extends the platform with peer-to-peer WebRTC video calls that use Google and public STUN servers to traverse NAT boundaries across different networks, ISPs, and mobile data connections.

The module reuses the existing `conversations`, `conversation_participants`, `messages`, and `users` Supabase tables. No schema migrations are required.

---

## Glossary

- **Messaging_Module**: The new messaging tab and all its client-side and server-side components.
- **Socket_Server**: The Socket.IO server process (`socket-server.ts`) responsible for real-time event brokering.
- **API_Layer**: The Next.js App Router API route handlers under `app/api/`.
- **WebRTC_Hook**: The `hooks/useWebRTC.ts` React hook that manages `RTCPeerConnection` lifecycle.
- **Socket_Hook**: The `hooks/useSocket.ts` React hook that maintains the Socket.IO client connection.
- **Conversation**: A record in the `conversations` table representing either a direct (two-participant) or group chat thread.
- **Message**: A record in the `messages` table belonging to a Conversation.
- **Participant**: A record in the `conversation_participants` table linking a user (by `ReferenceID`) to a Conversation.
- **ReferenceID**: The unique text identifier from `users."ReferenceID"` used as the canonical user key across all messaging tables.
- **Caller**: The user who initiates a WebRTC video call.
- **Callee**: The user who receives and may accept a WebRTC video call.
- **ICE_Candidate**: A network path candidate exchanged via Socket.IO to establish the WebRTC peer connection.
- **STUN_Server**: A Session Traversal Utilities for NAT server used to discover public IP/port mappings.
- **Peer_Connection**: An `RTCPeerConnection` instance held by both the Caller and Callee during an active call.
- **Online_Map**: An in-memory `Map<ReferenceID, socketId>` on the Socket_Server tracking connected users.
- **Type_Definitions**: TypeScript interfaces defined in `lib/types.ts` shared across the Messaging_Module.

---

## Requirements

### Requirement 1: Type Definitions

**User Story:** As a TypeScript developer, I want shared type definitions for all messaging entities, so that the compiler enforces correctness across API routes, hooks, and components.

#### Acceptance Criteria

1. THE Type_Definitions SHALL declare a `ReferenceID` type alias as `string`, used as the canonical user identifier across all messaging interfaces.
2. THE Type_Definitions SHALL export a `User` interface with the following typed fields: `id` (number — bigint PK), `ReferenceID` (ReferenceID), and optional fields `Firstname` (string), `Lastname` (string), `Email` (string), `userName` (string), `Role` (string), `Position` (string), `Department` (string), `profilePicture` (string), `ContactNumber` (string), and `Status` (string).
3. THE Type_Definitions SHALL export a `Conversation` interface with fields: `id` (string — UUID), `conversation_type` (literal union `'direct' | 'group'`), `created_by` (ReferenceID), `last_message_at` (ISO-8601 string), `created_at` (ISO-8601 string), `updated_at` (ISO-8601 string), and optional fields `name` (string), `description` (string), and `photo_url` (string).
4. THE Type_Definitions SHALL export a `ConversationParticipant` interface with fields: `id` (number), `conversation_id` (string — UUID), `user_id` (ReferenceID), `role` (literal union `'admin' | 'member'`), and optional fields `last_read_message_id` (string), `last_seen_at` (ISO-8601 string), and `user` (User).
5. THE Type_Definitions SHALL export a `Message` interface with fields: `id` (string — UUID), `conversation_id` (string), `sender_id` (ReferenceID), `message_type` (literal union `'text' | 'image' | 'file' | 'link' | 'voice' | 'video' | 'location' | 'system'`), `content` (string), `is_edited` (boolean), `is_deleted` (boolean), `created_at` (ISO-8601 string), `updated_at` (ISO-8601 string), and optional fields `reply_to_message_id` (string), `meta` (Record\<string, unknown\>), `sender` (User), and `reactions` (MessageReaction[]).
6. THE Type_Definitions SHALL export a `MessageReaction` interface with fields: `id` (number), `message_id` (string), `user_id` (ReferenceID), `reaction` (string), and `created_at` (ISO-8601 string).
7. THE Type_Definitions SHALL export a `getUserFullName` helper function that accepts a `User` object and returns the trimmed concatenation of `Firstname` and `Lastname`; if both are absent or empty it SHALL return `userName` if present, otherwise `ReferenceID`.
8. THE Type_Definitions SHALL export a `getUserInitials` helper function that accepts a `User` object and returns the uppercased first character of `Firstname` concatenated with the uppercased first character of `Lastname`.
9. IF `Firstname` or `Lastname` is absent or an empty string in `getUserInitials`, THEN the function SHALL return only the single available initial character; IF both are absent or empty, THEN it SHALL return the first two characters of `ReferenceID` uppercased.
10. THE `getUserFullName` and `getUserInitials` helper functions SHALL be pure and deterministic: given the same `User` input they SHALL always return the same output.

---

### Requirement 2: Conversations API

**User Story:** As a logged-in user, I want to list my conversations and create direct conversations, so that I can start chatting with colleagues.

#### Acceptance Criteria

1. WHEN a GET request is sent to `/api/conversations` with a valid `referenceId` query parameter (non-empty ReferenceID string), THE API_Layer SHALL return an array of Conversation objects where the requesting user is a Participant, ordered by `last_message_at` descending; if no conversations exist for that user it SHALL return an empty array.
2. IF a GET request is sent to `/api/conversations` with the `referenceId` query parameter absent or empty, THEN THE API_Layer SHALL return HTTP 400 with a JSON error body indicating that `referenceId` is required.
3. IF a POST request is sent to `/api/conversations` with a JSON body where `user1RefId` or `user2RefId` is absent, empty, or not a string, THEN THE API_Layer SHALL return HTTP 400 with a JSON error body indicating which field failed validation.
4. WHEN a POST request is sent to `/api/conversations` with a valid JSON body containing `user1RefId` and `user2RefId` (both non-empty ReferenceID strings), THE API_Layer SHALL check whether a direct Conversation already exists between those two users.
5. WHEN a direct Conversation already exists between `user1RefId` and `user2RefId`, THE API_Layer SHALL return the existing Conversation object with HTTP 200 rather than creating a duplicate.
6. WHEN no direct Conversation exists between `user1RefId` and `user2RefId`, THE API_Layer SHALL insert a new Conversation with `conversation_type = 'direct'`, insert two Participant records linking both users to the new Conversation, and return the new Conversation object with HTTP 201.
7. IF the Supabase query fails during a GET or POST request to `/api/conversations`, THEN THE API_Layer SHALL return HTTP 500 with a JSON error body containing an error message that does not expose internal system details.

---

### Requirement 3: Messages API

**User Story:** As a participant in a conversation, I want to fetch message history, send new messages, and mark messages as read, so that I can communicate in real time.

#### Acceptance Criteria

1. WHEN a GET request is sent to `/api/messages` with a `conversationId` query parameter that is non-empty and references an existing Conversation, THE API_Layer SHALL return an array of up to 100 Message objects belonging to that Conversation, ordered by `created_at` ascending.
2. IF the `conversationId` query parameter is absent or empty in a GET request to `/api/messages`, THEN THE API_Layer SHALL return HTTP 400 with a JSON error body.
3. IF the `conversationId` in a GET request to `/api/messages` is non-empty but does not reference an existing Conversation, THEN THE API_Layer SHALL return HTTP 404 with a JSON error body.
4. WHEN a POST request is sent to `/api/messages` with a JSON body containing a non-empty `conversationId` referencing an existing Conversation, a non-empty `senderRefId`, and a non-empty `content` of at most 2000 characters, THE API_Layer SHALL insert a new Message record and return the inserted Message object with HTTP 201.
5. IF a POST request to `/api/messages` contains a JSON body where any of `conversationId`, `senderRefId`, or `content` is absent, empty, or `content` exceeds 2000 characters, THEN THE API_Layer SHALL return HTTP 400 with a JSON error body.
6. WHEN a Message is successfully inserted, the Supabase database trigger `trg_new_message_updates_conv` SHALL automatically update `last_message_at` on the parent Conversation to the current timestamp.
7. WHEN a PATCH request is sent to `/api/messages` with a JSON body containing a non-empty `conversationId` and a non-empty `referenceId` that both reference existing records, THE API_Layer SHALL update the `last_read_message_id` (to the Message with the greatest `created_at` in that Conversation) and `last_seen_at` on the matching Participant record, and return HTTP 200 with the updated Participant object.
8. IF a PATCH request to `/api/messages` contains a `conversationId` and `referenceId` combination that does not match an existing Participant record, THEN THE API_Layer SHALL return HTTP 404 with a JSON error body.
9. IF the Supabase query fails during any request to `/api/messages`, THEN THE API_Layer SHALL return HTTP 500 with a JSON error body containing an error message indicating the reason for the failure.

---

### Requirement 4: User Search API

**User Story:** As a user, I want to search for other users by name or email, so that I can find colleagues to start a conversation with.

#### Acceptance Criteria

1. WHEN a GET request is sent to `/api/users/search` with a `keyword` query parameter containing at least one non-whitespace character and no more than 200 characters, THE API_Layer SHALL return an array of User objects whose `Firstname`, `Lastname`, `Email`, or `userName` contains the keyword (case-insensitive), ordered ascending by `Lastname` then `Firstname`.
2. WHEN a GET request is sent to `/api/users/search` with both a `keyword` and an `excludeRefId` (ReferenceID) query parameter, THE API_Layer SHALL exclude the user matching `excludeRefId` from the results.
3. IF a GET request is sent to `/api/users/search` and the `keyword` query parameter is absent, empty, composed entirely of whitespace characters, or exceeds 200 characters, THEN THE API_Layer SHALL return HTTP 400 with a JSON error body indicating the validation failure reason.
4. THE API_Layer SHALL limit the search result to a maximum of 20 User objects per request.
5. IF the Supabase query fails during a search request, THEN THE API_Layer SHALL return HTTP 500 with a JSON error body indicating that the search operation failed.

---

### Requirement 5: Socket.IO Server — Connection and Online Status

**User Story:** As a user, I want the system to track which colleagues are currently online, so that I can see their availability in the messaging UI.

#### Acceptance Criteria

1. WHEN a client emits a `user_connected` event with a `referenceId` that is a non-empty string, THE Socket_Server SHALL store the mapping `referenceId → socket.id` in the Online_Map, replacing any existing entry for that `referenceId`.
2. WHEN a client emits a `user_connected` event with a missing or non-string `referenceId`, THE Socket_Server SHALL emit an error event to the originating socket indicating the `referenceId` is invalid, without modifying the Online_Map.
3. WHEN a client socket disconnects, THE Socket_Server SHALL remove all Online_Map entries whose value matches the disconnected `socket.id` within 5 seconds of the disconnect event.
4. THE Socket_Server SHALL expose a synchronous lookup function that accepts a ReferenceID and returns a truthy value if an entry exists in the Online_Map, or a falsy value if no entry exists.

---

### Requirement 6: Socket.IO Server — Messaging Events

**User Story:** As a participant in a conversation, I want messages, typing indicators, and read receipts delivered in real time, so that the chat feels instant.

#### Acceptance Criteria

1. WHEN a client emits a `private_message` event with `{ conversationId, senderId, receiverId, content }` where all four fields are present and non-empty strings, THE Socket_Server SHALL look up the socket ID for `receiverId` in the Online_Map and emit the message payload to that socket.
2. WHEN a client emits a `private_message` event with any of `conversationId`, `senderId`, `receiverId`, or `content` missing or empty, THE Socket_Server SHALL emit an error event to the originating socket indicating which field failed validation, without forwarding the message.
3. WHEN the `receiverId` is not present in the Online_Map, THE Socket_Server SHALL silently drop the `private_message` event without emitting an error to any socket.
4. WHEN a client emits a `typing` event with `{ conversationId, senderId, receiverId }` where all three fields are present and non-empty strings, THE Socket_Server SHALL forward a `user_typing` event containing `{ conversationId, senderId }` to the socket matching `receiverId`.
5. WHEN the `receiverId` of a `typing` event is not present in the Online_Map, THE Socket_Server SHALL silently drop the `typing` event without error.
6. WHEN a client emits a `stop_typing` event with `{ conversationId, senderId, receiverId }` where all three fields are present and non-empty strings, THE Socket_Server SHALL forward a `user_stop_typing` event containing `{ conversationId, senderId }` to the socket matching `receiverId`.
7. WHEN the `receiverId` of a `stop_typing` event is not present in the Online_Map, THE Socket_Server SHALL silently drop the `stop_typing` event without error.
8. WHEN a client emits a `mark_read` event with `{ conversationId, userId, readerId }` where all three fields are present and non-empty strings, THE Socket_Server SHALL forward a `message_read` event containing `{ conversationId, readerId }` to the socket matching `userId`.
9. WHEN the `userId` of a `mark_read` event is not present in the Online_Map, THE Socket_Server SHALL silently drop the `mark_read` event without error.

---

### Requirement 7: Socket.IO Server — WebRTC Signaling Events

**User Story:** As a Caller, I want to exchange WebRTC signaling data with the Callee through the server, so that a peer-to-peer video call can be established without the server relaying media.

#### Acceptance Criteria

1. WHEN a client emits an `initiate_call` event with `{ callerId, calleeId, callerName }` where all three fields are present and non-empty strings, THE Socket_Server SHALL forward a `call_incoming` event containing `{ callerId, callerName }` to the socket matching `calleeId`.
2. WHEN a client emits a `webrtc_offer` event with `{ offer, calleeId }` where both fields are present and non-empty, THE Socket_Server SHALL forward a `webrtc_offer` event containing the SDP offer to the socket matching `calleeId`.
3. WHEN a client emits a `webrtc_answer` event with `{ answer, callerId }` where both fields are present and non-empty, THE Socket_Server SHALL forward a `webrtc_answer` event containing the SDP answer to the socket matching `callerId`.
4. WHEN a client emits a `webrtc_ice_candidate` event with `{ candidate, targetId }` where both fields are present and non-empty, THE Socket_Server SHALL forward a `webrtc_ice_candidate` event containing the ICE_Candidate to the socket matching `targetId`.
5. WHEN a client emits an `end_call` event with `{ targetId }` where `targetId` is a present and non-empty string, THE Socket_Server SHALL forward a `call_ended` event to the socket matching `targetId`.
6. IF the target user identified by `calleeId`, `callerId`, or `targetId` is not present in the Online_Map, THEN THE Socket_Server SHALL silently drop the signaling event directed at that target without emitting an error to any socket.
7. IF any signaling event (`initiate_call`, `webrtc_offer`, `webrtc_answer`, `webrtc_ice_candidate`, `end_call`) is received with a missing or empty required field, THEN THE Socket_Server SHALL emit an error event to the originating socket indicating which field failed validation, without forwarding the event.

---

### Requirement 8: Socket Hook

**User Story:** As a React component, I want a hook that manages the Socket.IO client connection lifecycle, so that components can emit and subscribe to events without managing connection details.

#### Acceptance Criteria

1. WHEN the Socket_Hook is mounted with a `userId` (ReferenceID) that is a non-empty string, THE Socket_Hook SHALL establish a Socket.IO connection to the server and emit `user_connected` with the provided `userId`.
2. WHEN the Socket_Hook is mounted with a `userId` that is null, undefined, or an empty string, THE Socket_Hook SHALL NOT establish a Socket.IO connection.
3. WHEN the Socket_Hook is unmounted, THE Socket_Hook SHALL disconnect the Socket.IO client and remove all registered event listeners to prevent memory leaks.
4. THE Socket_Hook SHALL expose the connected `socket` instance, an `isConnected` boolean flag, and an `emit` helper function as its return value.
5. WHILE the Socket.IO connection has not yet been established, THE Socket_Hook SHALL set `isConnected` to `false`.
6. WHEN the Socket.IO connection is established, THE Socket_Hook SHALL set `isConnected` to `true`.
7. WHEN the Socket.IO connection is lost and automatically re-established by the client library, THE Socket_Hook SHALL re-emit `user_connected` with the original `userId` to restore the Online_Map entry on the Socket_Server.

---

### Requirement 9: WebRTC Hook — Configuration

**User Story:** As a developer, I want the WebRTC peer connection configured with multiple public STUN servers, so that calls succeed across different networks, ISPs, and mobile data connections.

#### Acceptance Criteria

1. THE WebRTC_Hook SHALL initialize `RTCPeerConnection` using an `RTCConfiguration` object that includes at least five STUN server entries from the following: `stun.l.google.com:19302`, `stun1.l.google.com:19302`, `stun2.l.google.com:19302`, `stun3.l.google.com:19302`, `stun4.l.google.com:19302`, `stun.relay.metered.ca:80`, `stun.cloudflare.com:3478`, `stun.ekiga.net`, and `stun.ideasip.com`.
2. THE WebRTC_Hook SHALL set `iceCandidatePoolSize` to `10` in the RTCConfiguration.
3. THE WebRTC_Hook SHALL set `rtcpMuxPolicy` to `'require'` in the RTCConfiguration.
4. THE WebRTC_Hook SHALL set `bundlePolicy` to `'max-bundle'` in the RTCConfiguration.
5. THE WebRTC_Hook SHALL use the same RTCConfiguration object for both the Caller-side and Callee-side Peer_Connection instances.

---

### Requirement 10: WebRTC Hook — Call Lifecycle

**User Story:** As a Caller or Callee, I want a hook that handles the full video call lifecycle including media capture, offer/answer exchange, and teardown, so that I can initiate and receive calls from the messaging UI.

#### Acceptance Criteria

1. WHEN `startCall` is invoked on the WebRTC_Hook with a `calleeId` that is a non-empty string, THE WebRTC_Hook SHALL set `isCalling` to `true`, request camera and microphone permissions, create a local `MediaStream`, create a Peer_Connection using the RTCConfiguration from Requirement 9, add all local media tracks to the Peer_Connection, create an SDP offer, set it as the local description, and emit `webrtc_offer` with the SDP offer and `calleeId` via the Socket_Hook.
2. WHEN `handleOffer` is invoked on the WebRTC_Hook with an incoming SDP offer and a `callerId`, THE WebRTC_Hook SHALL set `isReceivingCall` to `true`, create a Peer_Connection using the RTCConfiguration from Requirement 9, request camera and microphone permissions, create a local `MediaStream`, add all local media tracks, set the incoming offer as the remote description, create an SDP answer, set it as the local description, and emit `webrtc_answer` with the SDP answer and `callerId` via the Socket_Hook.
3. WHEN `handleAnswer` is invoked on the WebRTC_Hook with an SDP answer, THE WebRTC_Hook SHALL set the answer as the remote description on the existing Peer_Connection and set `isCallActive` to `true`.
4. WHEN `handleIceCandidate` is invoked with an ICE_Candidate object, THE WebRTC_Hook SHALL add the candidate to the active Peer_Connection via `addIceCandidate`.
5. IF `handleIceCandidate` is invoked when no active Peer_Connection exists, THEN THE WebRTC_Hook SHALL discard the ICE_Candidate and SHALL NOT throw an unhandled error.
6. WHEN the Peer_Connection generates a new ICE_Candidate, THE WebRTC_Hook SHALL emit a `webrtc_ice_candidate` event with the ICE_Candidate object and the remote peer's ID via the Socket_Hook.
7. WHEN a remote track is received on the Peer_Connection, THE WebRTC_Hook SHALL assign the remote `MediaStream` to the exposed `remoteStream` ref so the UI can attach it to a video element.
8. WHEN `endCall` is invoked on the WebRTC_Hook, THE WebRTC_Hook SHALL stop all tracks on the local `MediaStream`, close the Peer_Connection, emit an `end_call` event with the remote peer's ID via the Socket_Hook, and reset `localStream`, `remoteStream`, `isCallActive`, `isCalling`, and `isReceivingCall` to their initial values.
9. IF `getUserMedia` is denied by the browser or OS, THEN THE WebRTC_Hook SHALL set `error` to a message indicating that camera and microphone access was denied, set `isCalling` and `isReceivingCall` back to `false`, and SHALL NOT proceed with offer or answer creation.
10. IF `getUserMedia` is not resolved within 30 seconds, THEN THE WebRTC_Hook SHALL set `error` to a message indicating a media access timeout, set `isCalling` and `isReceivingCall` back to `false`, and SHALL NOT proceed with offer or answer creation.
11. THE WebRTC_Hook SHALL expose `localStream`, `remoteStream`, `isCallActive`, `isCalling`, `isReceivingCall`, `error`, `startCall`, `handleOffer`, `handleAnswer`, `handleIceCandidate`, and `endCall` as its return value.

---

### Requirement 11: Messaging UI — Conversation List

**User Story:** As a user, I want to see a list of my conversations in a dedicated messaging tab, so that I can quickly navigate between chats.

#### Acceptance Criteria

1. WHEN the Messaging_Module tab is opened with a valid `userId`, THE Messaging_Module SHALL fetch all Conversations for that user from the API_Layer and display them sorted by `last_message_at` descending.
2. WHEN no Conversations exist for the user, THE Messaging_Module SHALL display an empty state message prompting the user to start a new conversation.
3. THE Messaging_Module SHALL display each Conversation with: the participant name or group name, a preview of the most recent message content (truncated to 60 characters), and the `last_message_at` timestamp formatted as a human-readable relative time (e.g. "2 minutes ago").
4. WHEN a new Message arrives via the Socket_Hook, THE Messaging_Module SHALL move the affected Conversation to the top of the list and update its message preview and timestamp without requiring a full page reload.
5. WHEN the user clicks a Conversation in the list, THE Messaging_Module SHALL open the message thread for that Conversation.
6. THE Messaging_Module SHALL display a search input that filters the visible Conversation list by participant name as the user types, with results updating within 300 milliseconds.
7. IF the API_Layer returns an error when fetching Conversations, THEN THE Messaging_Module SHALL display an error message and a retry action.

---

### Requirement 12: Messaging UI — Message Thread

**User Story:** As a participant in a conversation, I want to read and send messages in a thread view, so that I can follow the conversation history.

#### Acceptance Criteria

1. WHEN a Conversation is opened, THE Messaging_Module SHALL fetch and display all Messages for that Conversation from the API_Layer, with the oldest messages at the top and the newest at the bottom.
2. WHEN no Messages exist in the Conversation, THE Messaging_Module SHALL display an empty state indicating that the conversation has no messages yet.
3. WHEN the message thread is opened, THE Messaging_Module SHALL automatically scroll to the most recent Message.
4. WHEN a new Message is appended to the thread and the user's scroll position is within 100 pixels of the bottom, THE Messaging_Module SHALL automatically scroll to the new Message.
5. THE Messaging_Module SHALL visually distinguish messages sent by the current user (right-aligned) from messages sent by others (left-aligned), including the sender's avatar and display name.
6. WHEN the user submits a non-empty message in the input field, THE Messaging_Module SHALL call the Messages API POST endpoint to persist the Message and emit a `private_message` event via the Socket_Hook; the input field SHALL be cleared after successful submission.
7. IF the Messages API POST endpoint returns an error, THEN THE Messaging_Module SHALL display an error indicator on the failed message and allow the user to retry.
8. WHEN a `private_message` event is received via the Socket_Hook matching the open Conversation, THE Messaging_Module SHALL append the new Message to the thread view without a full page reload.
9. WHILE the user is typing in the message input, THE Messaging_Module SHALL emit a `typing` event via the Socket_Hook no more than once per second.
10. WHEN the user clears the message input or submits a message, THE Messaging_Module SHALL emit a `stop_typing` event via the Socket_Hook.
11. WHEN a `user_typing` event is received via the Socket_Hook, THE Messaging_Module SHALL display a typing indicator for that sender; the indicator SHALL be hidden automatically after 3 seconds if no further `user_typing` events arrive.
12. WHEN a `user_stop_typing` event is received via the Socket_Hook, THE Messaging_Module SHALL immediately hide the typing indicator for that sender.
13. WHEN the message thread is opened or a new Message is received, THE Messaging_Module SHALL emit a `mark_read` event via the Socket_Hook and call the Messages API PATCH endpoint to update the read cursor.

---

### Requirement 13: Messaging UI — New Conversation

**User Story:** As a user, I want to search for a colleague and start a new direct conversation, so that I can message anyone in the organisation.

#### Acceptance Criteria

1. WHEN the user activates the new conversation action, THE Messaging_Module SHALL display a search input that calls `/api/users/search` as the user types at least 2 characters, with a debounce of at least 300 milliseconds.
2. WHEN the search input contains fewer than 2 characters, THE Messaging_Module SHALL not call the API and SHALL display no search results.
3. WHEN the search returns no results for a given keyword, THE Messaging_Module SHALL display an empty state indicating no matching users were found.
4. WHEN the user selects a search result, THE Messaging_Module SHALL call the Conversations API POST endpoint to get or create a direct Conversation and then open that Conversation's message thread.
5. IF the Conversations API POST endpoint returns an error, THEN THE Messaging_Module SHALL display an error message and allow the user to retry.
6. THE Messaging_Module SHALL exclude the currently logged-in user from search results by passing the `excludeRefId` parameter to `/api/users/search`.

---

### Requirement 14: Video Call UI

**User Story:** As a user, I want to initiate and receive video calls from within the messaging interface, so that I can communicate face-to-face with colleagues.

#### Acceptance Criteria

1. WHEN a direct Conversation is open, THE Messaging_Module SHALL display a video call button.
2. WHEN the video call button is clicked, THE Messaging_Module SHALL invoke `startCall` on the WebRTC_Hook with the other participant's ReferenceID and emit `initiate_call` via the Socket_Hook.
3. WHEN a `call_incoming` event is received via the Socket_Hook, THE Messaging_Module SHALL display an incoming call notification overlay showing the caller's display name with Accept and Decline action buttons.
4. WHEN the user accepts an incoming call, THE Messaging_Module SHALL invoke `handleOffer` on the WebRTC_Hook with the received SDP offer.
5. WHEN the user declines an incoming call, THE Messaging_Module SHALL emit `end_call` via the Socket_Hook with the caller's ID and dismiss the notification overlay.
6. WHILE `isCallActive` is `true` on the WebRTC_Hook, THE Messaging_Module SHALL display the local video stream in a picture-in-picture overlay (bottom corner) and the remote video stream as the primary full-screen view.
7. WHEN an end call button is clicked while a call is active, THE Messaging_Module SHALL invoke `endCall` on the WebRTC_Hook, which hides the video call UI and restores the message thread view.
8. WHEN a `call_ended` event is received via the Socket_Hook, THE Messaging_Module SHALL invoke `endCall` on the WebRTC_Hook and dismiss the video call UI.
9. IF the WebRTC_Hook exposes a non-null `error` string, THEN THE Messaging_Module SHALL display the error message in the call UI and provide a dismiss action.
10. IF an outgoing call is not answered within 60 seconds, THEN THE Messaging_Module SHALL invoke `endCall` on the WebRTC_Hook, display a "Call not answered" message, and reset to the message thread view.

---

### Requirement 15: Round-Trip Message Serialisation

**User Story:** As a developer, I want to verify that message content survives serialisation to the database and back, so that no data is silently corrupted in transit.

#### Acceptance Criteria

1. FOR ALL `content` string values with length between 1 and 2000 characters, WHEN a Message is sent via the Messages API POST endpoint and then fetched via the Messages API GET endpoint, THEN the returned Message's `content` field SHALL equal the original value byte-for-byte.
2. FOR ALL `meta` values that are valid JSON objects (non-null, non-array objects with string keys and JSON-serialisable values), WHEN a Message is inserted with that `meta` value and then fetched, THEN the returned Message's `meta` field SHALL be deeply equal to the original object.
3. WHEN `getUserFullName` is called twice with the same `User` object, THEN both calls SHALL return identical string values (determinism property).
4. WHEN `getUserInitials` is called twice with the same `User` object, THEN both calls SHALL return identical string values (determinism property).
