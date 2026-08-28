"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { ArrowLeft, PencilLine } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useUser } from "@/contexts/UserContext";
import { useSocket } from "@/hooks/useSocket";
import { useWebRTC } from "@/hooks/useWebRTC";
import ConversationItem, {
  type ConversationWithParticipants,
} from "@/components/messaging/ConversationItem";
import MessageThread from "@/components/messaging/MessageThread";
import IncomingCallAlert from "@/components/messaging/IncomingCallAlert";
import VideoCallOverlay from "@/components/messaging/VideoCallOverlay";
import { NewConversationModal } from "@/components/messaging/NewConversationModal";
import { getUserFullName } from "@/lib/types";
import type { Conversation, Message } from "@/lib/types";

export default function MessagingPage() {
  const { userId } = useUser();
  const { socket } = useSocket(userId);
  const {
    localStream,
    remoteStream,
    isCallActive,
    isCalling,
    error: callError,
    startCall,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    endCall,
  } = useWebRTC(socket, userId ?? "");

  const [view, setView] = useState<"list" | "thread">("list");
  const [conversations, setConversations] = useState<ConversationWithParticipants[]>([]);
  const [selected, setSelected] = useState<ConversationWithParticipants | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [incomingCall, setIncomingCall] = useState<{
    callerId: string;
    callerName: string;
  } | null>(null);

  const fetchConversations = useCallback(() => {
    if (!userId) return;
    setLoading(true);
    setFetchError(null);
    fetch(`/api/conversations?referenceId=${encodeURIComponent(userId)}`)
      .then((res) =>
        res.ok
          ? res.json()
          : res.json().then((b: Record<string, string>) =>
              Promise.reject(b?.error ?? `HTTP ${res.status}`)
            )
      )
      .then((data: ConversationWithParticipants[]) => setConversations(data))
      .catch((err: unknown) => setFetchError(String(err)))
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    if (!socket) return;
    const onMsg = (msg: Message) => {
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === msg.conversation_id);
        if (idx === -1) return prev;
        const updated = {
          ...prev[idx],
          last_message_at: new Date().toISOString(),
        } as ConversationWithParticipants;
        return [updated, ...prev.filter((_, i) => i !== idx)];
      });
    };
    const onCallIn = (d: { callerId: string; callerName: string }) =>
      setIncomingCall(d);
    const onOffer = (d: { from: string; offer: RTCSessionDescriptionInit }) =>
      handleOffer(d);
    const onAnswer = (d: { answer: RTCSessionDescriptionInit }) =>
      handleAnswer(d);
    const onIce = (d: { candidate: RTCIceCandidateInit }) =>
      handleIceCandidate(d);
    socket.on("new_message", onMsg);
    socket.on("call_incoming", onCallIn);
    socket.on("webrtc_offer", onOffer);
    socket.on("webrtc_answer", onAnswer);
    socket.on("webrtc_ice_candidate", onIce);
    socket.on("call_ended", endCall);
    return () => {
      socket.off("new_message", onMsg);
      socket.off("call_incoming", onCallIn);
      socket.off("webrtc_offer", onOffer);
      socket.off("webrtc_answer", onAnswer);
      socket.off("webrtc_ice_candidate", onIce);
      socket.off("call_ended", endCall);
    };
  }, [socket, handleOffer, handleAnswer, handleIceCandidate, endCall]);

  useEffect(() => {
    if (isCalling && !isCallActive) {
      const t = setTimeout(() => {
        endCall();
        toast("Call not answered");
      }, 60_000);
      return () => clearTimeout(t);
    }
  }, [isCalling, isCallActive, endCall]);

  const handleConversationCreated = useCallback((conv: Conversation) => {
    const e = conv as ConversationWithParticipants;
    setConversations((prev) => [e, ...prev.filter((c) => c.id !== e.id)]);
    setSelected(e);
    setView("thread");
    setShowNewModal(false);
  }, []);

  const filtered = filterQuery.trim()
    ? conversations.filter((c) => {
        const other = c.participants?.find((p) => p.user_id !== userId);
        const name =
          c.conversation_type === "direct" && other?.user
            ? getUserFullName(other.user)
            : c.name ?? "Group Chat";
        return name.toLowerCase().includes(filterQuery.toLowerCase());
      })
    : conversations;

  return (
    <div className="relative h-full overflow-hidden bg-[#F9F6F4]">
      {/* ── LIST ─────────────────────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {view === "list" && (
          <motion.div
            key="list"
            className="absolute inset-0 flex flex-col bg-[#F9F6F4]"
            initial={{ x: 0 }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "tween", duration: 0.22 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-5 pb-2">
              <h1 className="text-xl font-bold text-gray-900">Messages</h1>
              <button
                onClick={() => setShowNewModal(true)}
                className="w-9 h-9 rounded-full bg-[#CC1318] flex items-center justify-center active:scale-95 transition-all"
                aria-label="New conversation"
              >
                <PencilLine size={15} className="text-white" />
              </button>
            </div>

            {/* Search */}
            <div className="px-4 pb-3">
              <div className="flex items-center gap-2 bg-white rounded-2xl px-3 py-2.5 border border-gray-100 shadow-sm">
                <svg
                  width="14"
                  height="14"
                  fill="none"
                  stroke="#9ca3af"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  viewBox="0 0 24 24"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                <input
                  type="search"
                  placeholder="Search..."
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  className="flex-1 bg-transparent text-[13px] text-gray-700 placeholder:text-gray-400 outline-none"
                />
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-0.5">
              {loading &&
                [1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-2 py-3 animate-pulse"
                  >
                    <div className="w-12 h-12 rounded-full bg-gray-200 shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 w-28 bg-gray-200 rounded-full" />
                      <div className="h-3 w-40 bg-gray-200 rounded-full" />
                    </div>
                  </div>
                ))}

              {!loading && fetchError && (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <p className="text-sm text-red-500">{fetchError}</p>
                  <button
                    onClick={fetchConversations}
                    className="px-5 py-2.5 rounded-2xl bg-[#CC1318] text-white text-sm font-semibold active:scale-95 transition-all"
                  >
                    Retry
                  </button>
                </div>
              )}

              {!loading && !fetchError && conversations.length === 0 && (
                <div className="flex flex-col items-center gap-4 py-16 text-center">
                  <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center shadow-sm">
                    <svg
                      width="26"
                      height="26"
                      fill="none"
                      stroke="#d1d5db"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      viewBox="0 0 24 24"
                    >
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </div>
                  <p className="text-sm font-semibold text-gray-500">
                    No conversations yet
                  </p>
                  <button
                    onClick={() => setShowNewModal(true)}
                    className="px-5 py-2.5 rounded-2xl bg-[#CC1318] text-white text-sm font-semibold active:scale-95 transition-all"
                  >
                    Start one
                  </button>
                </div>
              )}

              {!loading &&
                !fetchError &&
                conversations.length > 0 &&
                filtered.length === 0 && (
                  <p className="text-center text-sm text-gray-400 py-8">
                    No results for &ldquo;{filterQuery}&rdquo;
                  </p>
                )}

              {!loading &&
                !fetchError &&
                filtered.map((conv) => (
                  <ConversationItem
                    key={conv.id}
                    conversation={conv}
                    currentUserId={userId ?? ""}
                    isSelected={selected?.id === conv.id}
                    onClick={() => {
                      setSelected(conv);
                      setView("thread");
                    }}
                  />
                ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── THREAD ───────────────────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {view === "thread" && selected && (
          <motion.div
            key="thread"
            className="absolute inset-0 flex flex-col bg-white"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.22 }}
          >
            {/* Back bar */}
            <div className="flex items-center px-2 pt-4 pb-1 border-b border-gray-100 shrink-0 bg-white">
              <button
                onClick={() => setView("list")}
                className="w-9 h-9 flex items-center justify-center rounded-full active:bg-gray-100 transition-all"
                aria-label="Back"
              >
                <ArrowLeft size={20} className="text-gray-700" />
              </button>
            </div>

            {/* Thread */}
            <div className="flex-1 min-h-0 overflow-hidden">
              <MessageThread
                conversation={selected}
                currentUserId={userId ?? ""}
                socket={socket}
                onStartCall={startCall}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Overlays ─────────────────────────────────────────────────────── */}
      {incomingCall && (
        <IncomingCallAlert
          callerId={incomingCall.callerId}
          callerName={incomingCall.callerName}
          onAccept={() => setIncomingCall(null)}
          onDecline={() => {
            socket?.emit("end_call", { targetId: incomingCall.callerId });
            setIncomingCall(null);
          }}
        />
      )}
      {(isCalling || isCallActive) && (
        <VideoCallOverlay
          localStream={localStream}
          remoteStream={remoteStream}
          isCallActive={isCallActive}
          isCalling={isCalling}
          error={callError}
          onEndCall={endCall}
        />
      )}
      {showNewModal && (
        <NewConversationModal
          currentUserId={userId ?? ""}
          onClose={() => setShowNewModal(false)}
          onConversationCreated={handleConversationCreated}
        />
      )}
    </div>
  );
}
