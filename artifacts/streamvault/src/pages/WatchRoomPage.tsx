import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { io, Socket } from "socket.io-client";
import {
  useGetRoom,
  useGetRoomMessages,
  useDeleteRoom,
  useGetMe,
  ChatMessage,
} from "@workspace/api-client-react";
import { withAuthGuard } from "../components/layout/withAuthGuard";
import { SERVERS, proxyEmbedUrl } from "../lib/servers";
import {
  playJoinSound,
  playLeaveSound,
  playMessageSound,
  playReactionSound,
  playTickSound,
  playGoSound,
  playSyncSound,
} from "../lib/sounds";
import {
  Loader2, Send, Users, MessageSquare, LogOut,
  Copy, Check, RefreshCw, ChevronLeft, ChevronRight,
  AlertTriangle, Timer, Play, Pause, Zap, Crown,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Participant {
  userId: string;
  userName: string;
  userAvatar: string | null;
  socketId?: string;
}

interface FloatingReaction {
  id: number;
  emoji: string;
  x: number;
  userName: string;
}

const EMOJIS = ["😂", "😱", "❤️", "👏", "🔥", "🎉", "💀", "🤯", "👀", "🍿"];

function formatTime(sec: number): string {
  if (!isFinite(sec) || isNaN(sec)) return "0:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ─── Main Component ───────────────────────────────────────────────────────────

function WatchRoomPageContent({ params }: { params: { id: string } }) {
  const roomId = params.id;
  const [, setLocation] = useLocation();
  const { user } = useUser();
  const { data: me } = useGetMe();

  const { data: room, isLoading: loadingRoom } = useGetRoom(roomId, {
    query: { enabled: !!roomId },
  });
  const { data: initialMessages } = useGetRoomMessages(roomId, {
    query: { enabled: !!roomId },
  });
  const deleteRoomMutation = useDeleteRoom();

  // ── Video state ──────────────────────────────────────────────────────────
  const [serverIdx, setServerIdx] = useState(0);
  const [iframeKey, setIframeKey] = useState(0);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // ── Socket & room state ───────────────────────────────────────────────────
  const [socket, setSocket] = useState<Socket | null>(null);
  const [activeTab, setActiveTab] = useState<"chat" | "participants">("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingClearTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // ── Sync / host controls state ────────────────────────────────────────────
  const [isPlaying, setIsPlaying] = useState(false);
  const [syncTime, setSyncTime] = useState(0); // host's reference time in seconds
  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [syncBanner, setSyncBanner] = useState<{ time: number; label?: string } | null>(null);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [linkCopied, setLinkCopied] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const controlHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isHost = !!me && !!room && room.hostId === me.id;
  const currentServer = SERVERS[serverIdx];
  const embedUrl = room
    ? proxyEmbedUrl(
        currentServer.getRawUrl(
          room.contentType as "movie" | "tv",
          room.contentId,
          room.season ?? undefined,
          room.episode ?? undefined,
        ),
      )
    : "";

  // ── Seed initial messages ────────────────────────────────────────────────
  useEffect(() => {
    if (initialMessages) setMessages(initialMessages);
  }, [initialMessages]);

  // ── Auto-scroll chat ─────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Auto-advance when proxy reports server-unavailable ────────────────────
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.__sv_error && e.data?.event === "server-unavailable") {
        setIframeLoaded(false);
        setServerIdx((idx) => (idx + 1) % SERVERS.length);
        setIframeKey((k) => k + 1);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // ── Host sync timer ───────────────────────────────────────────────────────
  useEffect(() => {
    if (isHost && isPlaying) {
      syncTimerRef.current = setInterval(() => {
        setSyncTime((t) => t + 1);
      }, 1000);
    } else {
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    }
    return () => { if (syncTimerRef.current) clearInterval(syncTimerRef.current); };
  }, [isHost, isPlaying]);

  // ── Socket setup ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user || !roomId) return;

    const s = io({
      path: "/ws/socket.io",
      query: {
        roomId,
        userId: user.id,
        userName: user.fullName || user.firstName || "Anonymous",
      },
    });

    s.on("connect", () => {
      s.emit("join-room", {
        roomId,
        userId: user.id,
        userName: user.fullName || user.firstName || "Anonymous",
        userAvatar: user.imageUrl || null,
      });
    });

    s.on("room-state", ({ members, playState }: { members: Participant[]; playState?: { isPlaying: boolean; currentTime: number } }) => {
      setParticipants((members ?? []).filter((m) => m.userId !== user.id));
      if (playState) {
        setIsPlaying(playState.isPlaying ?? false);
        setSyncTime(playState.currentTime ?? 0);
      }
    });

    s.on("user-joined", ({ userId, userName, userAvatar }: { userId: string; userName: string; userAvatar: string | null }) => {
      if (userId === user.id) return;
      setParticipants((prev) =>
        prev.find((p) => p.userId === userId)
          ? prev
          : [...prev, { userId, userName, userAvatar }],
      );
      addSystemMessage(`${userName} joined the room 👋`);
      playJoinSound();
    });

    s.on("user-left", ({ userId, userName }: { userId: string; userName: string }) => {
      setParticipants((prev) => prev.filter((p) => p.userId !== userId));
      addSystemMessage(`${userName} left the room`);
      playLeaveSound();
    });

    s.on("chat-message", (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg]);
      if (msg.userId !== user.id) playMessageSound();
      // Clear typing for this user
      setTypingUsers((prev) => prev.filter((n) => n !== msg.userName));
    });

    s.on("typing", ({ userId: tid, userName: tname }: { userId: string; userName: string }) => {
      if (tid === user.id) return;
      setTypingUsers((prev) => (prev.includes(tname) ? prev : [...prev, tname]));
      const existing = typingClearTimers.current.get(tid);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => {
        setTypingUsers((prev) => prev.filter((n) => n !== tname));
        typingClearTimers.current.delete(tid);
      }, 3000);
      typingClearTimers.current.set(tid, t);
    });

    s.on("reaction", ({ userId: rid, userName: rname, emoji }: { userId: string; userName: string; emoji: string }) => {
      const id = Date.now() + Math.random();
      setFloatingReactions((prev) => [...prev, { id, emoji, x: Math.random() * 75 + 10, userName: rname }]);
      setTimeout(() => setFloatingReactions((prev) => prev.filter((r) => r.id !== id)), 3500);
      playReactionSound();
    });

    s.on("sync-state", ({ isPlaying: sp, currentTime }: { isPlaying: boolean; currentTime: number }) => {
      if (!isHost) {
        setIsPlaying(sp);
        setSyncTime(currentTime);
        playSyncSound();
      }
    });

    s.on("sync-point", ({ currentTime, label }: { currentTime: number; label?: string }) => {
      setSyncTime(currentTime);
      setIsPlaying(false);
      setSyncBanner({ time: currentTime, label });
      playSyncSound();
      setTimeout(() => setSyncBanner(null), 8000);
    });

    s.on("start-countdown", ({ atTime, seconds }: { atTime: number; seconds: number }) => {
      setSyncTime(atTime);
      setIsPlaying(false);
      let count = seconds;
      setCountdown(count);
      playTickSound();
      const interval = setInterval(() => {
        count -= 1;
        if (count > 0) {
          setCountdown(count);
          playTickSound();
        } else {
          setCountdown(null);
          setIsPlaying(true);
          playGoSound();
          clearInterval(interval);
        }
      }, 1000);
    });

    s.on("room-closed", () => {
      addSystemMessage("The host ended the watch party.");
      setTimeout(() => setLocation("/rooms"), 2000);
    });

    setSocket(s);
    return () => { s.disconnect(); };
  }, [user, roomId]);

  const addSystemMessage = useCallback((content: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `sys-${Date.now()}`,
        roomId,
        userId: "system",
        userName: "System",
        userAvatar: null,
        content,
        type: "system",
        createdAt: new Date().toISOString(),
      } as ChatMessage,
    ]);
  }, [roomId]);

  // ── Host controls ─────────────────────────────────────────────────────────
  const broadcastSync = useCallback((playing: boolean, time: number) => {
    socket?.emit("sync-state", {
      roomId,
      isPlaying: playing,
      currentTime: time,
      hostUserId: user?.id,
    });
  }, [socket, roomId, user]);

  const handleTogglePlay = () => {
    if (!isHost || !socket) return;
    const next = !isPlaying;
    setIsPlaying(next);
    broadcastSync(next, syncTime);
  };

  const handleSyncAll = () => {
    if (!isHost || !socket) return;
    socket.emit("sync-point", { roomId, currentTime: syncTime, label: formatTime(syncTime) });
    playSyncSound();
  };

  const handleStartCountdown = () => {
    if (!isHost || !socket) return;
    socket.emit("start-countdown", { roomId, atTime: syncTime, seconds: 5 });
  };

  const handleSwitchServer = (idx: number) => {
    setIframeLoaded(false);
    setServerIdx(idx);
    setIframeKey((k) => k + 1);
  };

  // ── Chat ──────────────────────────────────────────────────────────────────
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !socket || !user) return;
    socket.emit("chat-message", {
      roomId,
      userId: user.id,
      userName: user.fullName || user.firstName || "Anonymous",
      userAvatar: user.imageUrl || null,
      content: chatInput,
      type: "text",
    });
    setChatInput("");
  };

  const handleChatInput = (val: string) => {
    setChatInput(val);
    if (!socket || !user) return;
    socket.emit("typing", { roomId, userId: user.id, userName: user.fullName || user.firstName || "Anonymous" });
    if (typingTimer.current) clearTimeout(typingTimer.current);
  };

  const sendReaction = (emoji: string) => {
    if (!socket || !user) return;
    socket.emit("reaction", {
      roomId,
      emoji,
      userId: user.id,
      userName: user.fullName || user.firstName || "Anonymous",
    });
  };

  // ── Room actions ──────────────────────────────────────────────────────────
  const handleLeaveRoom = () => {
    socket?.emit("room-closed", { roomId });
    setLocation("/rooms");
  };

  const handleEndRoom = () => {
    if (!confirm("End the watch party for everyone?")) return;
    socket?.emit("room-closed", { roomId });
    deleteRoomMutation.mutate({ id: roomId }, { onSuccess: () => setLocation("/rooms") });
  };

  const copyInviteLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2500);
  };

  const resetControlTimer = useCallback(() => {
    setShowControls(true);
    if (controlHideTimer.current) clearTimeout(controlHideTimer.current);
    controlHideTimer.current = setTimeout(() => setShowControls(false), 4000);
  }, []);

  useEffect(() => {
    resetControlTimer();
    return () => { if (controlHideTimer.current) clearTimeout(controlHideTimer.current); };
  }, []);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loadingRoom) {
    return (
      <div className="flex-1 flex justify-center items-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!room) {
    return (
      <div className="flex-1 flex flex-col justify-center items-center h-screen gap-4">
        <p className="text-lg font-semibold">Room not found</p>
        <button onClick={() => setLocation("/rooms")} className="text-primary underline text-sm">Back to Rooms</button>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-64px)] w-full overflow-hidden bg-black">

      {/* ── Floating Reactions ────────────────────────────────────────────── */}
      <div className="pointer-events-none fixed inset-0 z-[200] overflow-hidden">
        {floatingReactions.map((r) => (
          <div
            key={r.id}
            className="absolute bottom-24 flex flex-col items-center gap-1 animate-float-up"
            style={{ left: `${r.x}%` }}
          >
            <span className="text-4xl drop-shadow-lg">{r.emoji}</span>
            <span className="text-[10px] text-white/70 bg-black/50 px-1.5 py-0.5 rounded-full whitespace-nowrap">{r.userName}</span>
          </div>
        ))}
      </div>

      {/* ── Countdown overlay ─────────────────────────────────────────────── */}
      {countdown !== null && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4">
            <p className="text-white/60 text-lg font-medium">Starting at {formatTime(syncTime)}…</p>
            <div className="text-9xl font-black text-yellow-400 tabular-nums drop-shadow-2xl" style={{ textShadow: '0 0 40px rgba(250,204,21,0.8)' }}>
              {countdown}
            </div>
            <p className="text-white/50 text-sm">Get ready!</p>
          </div>
        </div>
      )}

      {/* ── Sync banner ───────────────────────────────────────────────────── */}
      {syncBanner && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[250] bg-yellow-400 text-black font-bold px-6 py-3 rounded-full shadow-2xl flex items-center gap-2 animate-bounce-in">
          <Timer className="w-4 h-4" />
          Seek to {formatTime(syncBanner.time)} to sync with the room
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* VIDEO AREA                                                          */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      <div
        className="flex-1 relative bg-black overflow-hidden"
        onMouseMove={resetControlTimer}
      >
        {/* Loading spinner */}
        {!iframeLoaded && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black">
            <Loader2 className="w-10 h-10 text-yellow-400 animate-spin" />
            <p className="text-white/50 text-sm">Loading {currentServer.name}…</p>
          </div>
        )}

        {/* iframe */}
        <iframe
          ref={iframeRef}
          key={iframeKey}
          src={embedUrl}
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          allowFullScreen
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-forms allow-presentation allow-pointer-lock allow-downloads"
          className="w-full h-full border-0"
          title="Watch Party Player"
          onLoad={() => setIframeLoaded(true)}
        />

        {/* ── Top overlay: room title + leave ─────────────────────────────── */}
        <div className={`absolute top-0 inset-x-0 z-20 transition-opacity duration-300 ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
          <div className="bg-gradient-to-b from-black/90 to-transparent px-4 pt-3 pb-8 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <h2 className="text-white font-bold text-sm truncate">{room.name}</h2>
              <p className="text-white/60 text-xs truncate">
                {room.contentTitle}
                {room.season != null && ` · S${room.season}E${room.episode}`}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                LIVE
              </span>
              {isHost ? (
                <button onClick={handleEndRoom} className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-lg transition-all">
                  End Room
                </button>
              ) : (
                <button onClick={handleLeaveRoom} className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold rounded-lg transition-all">
                  <LogOut className="w-3.5 h-3.5" /> Leave
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Bottom overlay: server switcher + host controls ──────────────── */}
        <div className={`absolute bottom-0 inset-x-0 z-20 transition-opacity duration-300 ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
          <div className="bg-gradient-to-t from-black/95 via-black/70 to-transparent px-4 pb-3 pt-12">

            {/* Host controls */}
            {isHost && (
              <div className="flex items-center gap-3 mb-3 justify-center">
                <button
                  onClick={handleTogglePlay}
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-yellow-400 text-black font-bold text-sm hover:bg-yellow-300 transition-all shadow-lg"
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  {isPlaying ? "Pause" : "Play"}
                </button>

                <div className="flex items-center gap-1 px-3 py-2 rounded-full bg-white/10 border border-white/10 text-white text-sm font-mono">
                  <Timer className="w-3.5 h-3.5 text-yellow-400" />
                  {formatTime(syncTime)}
                </div>

                <button
                  onClick={handleSyncAll}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-blue-500/20 border border-blue-500/30 text-blue-400 text-xs font-semibold hover:bg-blue-500/30 transition-all"
                  title="Tell everyone to seek to this time"
                >
                  <Zap className="w-3.5 h-3.5" /> Sync All
                </button>

                <button
                  onClick={handleStartCountdown}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-green-500/20 border border-green-500/30 text-green-400 text-xs font-semibold hover:bg-green-500/30 transition-all"
                  title="5-second countdown for synchronized start"
                >
                  <Timer className="w-3.5 h-3.5" /> 5…4…3
                </button>

                <button onClick={() => { setIframeLoaded(false); setIframeKey((k) => k + 1); }} className="p-2 rounded-full bg-white/10 text-white/60 hover:bg-white/20 hover:text-white transition-all" title="Reload player">
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Server switcher */}
            <div className="flex flex-col items-center gap-1.5">
              <div className="flex items-center gap-1.5 text-yellow-400/70 text-xs">
                <AlertTriangle className="w-3 h-3" />
                Not working? Try another server
              </div>
              <div className="flex items-center gap-1.5 flex-wrap justify-center">
                <button onClick={() => handleSwitchServer((serverIdx - 1 + SERVERS.length) % SERVERS.length)} className="p-1.5 rounded-full bg-white/10 text-white/60 hover:bg-white/20 hover:text-white transition-all">
                  <ChevronLeft className="w-3 h-3" />
                </button>
                {SERVERS.map((s, idx) => (
                  <button
                    key={s.id}
                    onClick={() => handleSwitchServer(idx)}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${
                      idx === serverIdx
                        ? "bg-yellow-400 text-black border-yellow-400"
                        : "bg-white/5 text-white/60 border-white/10 hover:bg-white/15 hover:text-white"
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
                <button onClick={() => handleSwitchServer((serverIdx + 1) % SERVERS.length)} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-white/10 text-white/60 border border-white/10 hover:bg-white/20 hover:text-white transition-all">
                  Next <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* SIDEBAR                                                             */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      <div className="w-full lg:w-[340px] flex flex-col bg-[#0f0f0f] border-l border-white/5 h-full">

        {/* Room header */}
        <div className="px-4 py-3 border-b border-white/5 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-white/50 text-xs font-medium uppercase tracking-wider">Watch Party</p>
            <p className="text-white text-sm font-semibold truncate">{room.contentTitle}</p>
          </div>
          <button
            onClick={copyInviteLink}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
              linkCopied
                ? "bg-green-500/20 border-green-500/30 text-green-400"
                : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white"
            }`}
            title="Copy invite link"
          >
            {linkCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {linkCopied ? "Copied!" : "Invite"}
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/5">
          {(["chat", "participants"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2.5 flex justify-center items-center gap-2 text-xs font-semibold uppercase tracking-wider transition-colors border-b-2 ${
                activeTab === tab
                  ? "border-yellow-400 text-yellow-400"
                  : "border-transparent text-white/40 hover:text-white/70"
              }`}
            >
              {tab === "chat" ? <MessageSquare className="w-3.5 h-3.5" /> : <Users className="w-3.5 h-3.5" />}
              {tab}
              {tab === "participants" && (
                <span className="bg-white/10 text-white/60 px-1.5 py-0.5 rounded-full text-[10px]">
                  {participants.length + 1}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Chat tab ──────────────────────────────────────────────────────── */}
        {activeTab === "chat" && (
          <>
            <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
              {messages.map((msg, i) => {
                if (msg.type === "system") {
                  return (
                    <div key={i} className="flex justify-center">
                      <span className="text-[11px] text-white/30 bg-white/5 px-3 py-1 rounded-full">
                        {msg.content}
                      </span>
                    </div>
                  );
                }
                const isMe = msg.userId === user?.id;
                return (
                  <div key={msg.id} className={`flex gap-2 ${isMe ? "flex-row-reverse" : "flex-row"}`}>
                    <div className="w-7 h-7 rounded-full overflow-hidden flex-shrink-0 bg-white/10 border border-white/10">
                      {msg.userAvatar ? (
                        <img src={msg.userAvatar} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] font-bold text-yellow-400">
                          {msg.userName.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className={`flex flex-col max-w-[200px] ${isMe ? "items-end" : "items-start"}`}>
                      <span className="text-[10px] text-white/30 mb-0.5 px-1">{isMe ? "You" : msg.userName}</span>
                      <div className={`px-3 py-2 rounded-2xl text-sm break-words ${
                        isMe
                          ? "bg-yellow-400 text-black rounded-tr-sm"
                          : "bg-white/10 text-white/90 rounded-tl-sm"
                      }`}>
                        {msg.content}
                      </div>
                    </div>
                  </div>
                );
              })}
              {typingUsers.length > 0 && (
                <div className="flex items-center gap-2">
                  <div className="flex gap-1 px-3 py-2 rounded-2xl rounded-tl-sm bg-white/10">
                    <span className="w-1.5 h-1.5 rounded-full bg-white/50 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-white/50 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-white/50 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                  <span className="text-[10px] text-white/30">{typingUsers.join(", ")} typing…</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Reaction picker */}
            <div className="px-3 py-2 border-t border-white/5 flex items-center gap-1 overflow-x-auto scrollbar-none">
              {EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => sendReaction(emoji)}
                  className="text-xl p-1.5 rounded-full hover:bg-white/10 active:scale-90 transition-all flex-shrink-0"
                >
                  {emoji}
                </button>
              ))}
            </div>

            {/* Chat input */}
            <form onSubmit={handleSendMessage} className="p-3 border-t border-white/5">
              <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-full pl-4 pr-2 py-1.5 focus-within:border-yellow-400/50 focus-within:bg-white/8 transition-all">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => handleChatInput(e.target.value)}
                  placeholder="Say something…"
                  className="flex-1 bg-transparent text-sm text-white/90 placeholder-white/30 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim()}
                  className="w-7 h-7 flex items-center justify-center rounded-full bg-yellow-400 text-black hover:bg-yellow-300 disabled:opacity-30 disabled:hover:bg-yellow-400 transition-all flex-shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>
          </>
        )}

        {/* ── Participants tab ───────────────────────────────────────────────── */}
        {activeTab === "participants" && (
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {/* Self */}
            <div className="flex items-center gap-3 p-3 rounded-xl bg-yellow-400/5 border border-yellow-400/20">
              <div className="relative flex-shrink-0">
                {user?.imageUrl ? (
                  <img src={user.imageUrl} className="w-9 h-9 rounded-full border-2 border-yellow-400" alt="You" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-yellow-400/20 border-2 border-yellow-400 flex items-center justify-center text-yellow-400 font-bold text-sm">
                    {(user?.firstName || "Y").charAt(0)}
                  </div>
                )}
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-400 rounded-full border-2 border-[#0f0f0f]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-semibold truncate">
                  {user?.fullName || user?.firstName || "You"}
                  <span className="text-white/40 font-normal"> (You)</span>
                </p>
                <p className="text-white/40 text-xs flex items-center gap-1">
                  {isHost ? <><Crown className="w-3 h-3 text-yellow-400" /> Host</> : "Viewer"}
                </p>
              </div>
            </div>

            {/* Others */}
            {participants.map((p) => (
              <div key={p.userId} className="flex items-center gap-3 p-3 rounded-xl bg-white/3 border border-white/5">
                <div className="relative flex-shrink-0">
                  {p.userAvatar ? (
                    <img src={p.userAvatar} className="w-9 h-9 rounded-full border border-white/20" alt={p.userName} />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-white/70 font-bold text-sm">
                      {p.userName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-400 rounded-full border-2 border-[#0f0f0f]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white/90 text-sm font-medium truncate">{p.userName}</p>
                  <p className="text-white/30 text-xs flex items-center gap-1">
                    {p.userId === room.hostId
                      ? <><Crown className="w-3 h-3 text-yellow-400" /> Host</>
                      : "Viewer"}
                  </p>
                </div>
              </div>
            ))}

            {participants.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Users className="w-8 h-8 text-white/20 mb-3" />
                <p className="text-white/30 text-sm">Just you so far</p>
                <button onClick={copyInviteLink} className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-full bg-yellow-400/10 border border-yellow-400/20 text-yellow-400 text-sm font-semibold hover:bg-yellow-400/20 transition-all">
                  <Copy className="w-3.5 h-3.5" />
                  Copy invite link
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default withAuthGuard(WatchRoomPageContent);
