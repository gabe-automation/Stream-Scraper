import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { io, Socket } from "socket.io-client";
import SimplePeer from "simple-peer";
import {
  useGetRoom,
  useGetRoomMessages,
  useDeleteRoom,
  ChatMessage
} from "@workspace/api-client-react";
import { withAuthGuard } from "../components/layout/withAuthGuard";
import {
  Loader2, Send, Users, MessageSquare, LogOut,
  RefreshCw, ChevronRight, AlertTriangle, Info, Copy, Check, X,
  Video, VideoOff, Mic, MicOff, PhoneCall, PhoneOff, Settings, Timer
} from "lucide-react";

// ─── Server definitions ───────────────────────────────────────────────────────
export type ContentType = "movie" | "tv";
interface ServerDef {
  id: string;
  name: string;
  getUrl: (type: ContentType, id: string, season?: number, episode?: number) => string;
}

const SERVERS: ServerDef[] = [
  { id: "vidsrc", name: "VidSrc", getUrl: (t, id, s, e) => t === "movie" ? `https://vidsrc.to/embed/movie/${id}` : `https://vidsrc.to/embed/tv/${id}/${s}/${e}` },
  { id: "vidsrcme", name: "VidSrc.me", getUrl: (t, id, s, e) => t === "movie" ? `https://vidsrc.me/embed/movie?tmdb=${id}` : `https://vidsrc.me/embed/tv?tmdb=${id}&season=${s}&episode=${e}` },
  { id: "autoembed", name: "AutoEmbed", getUrl: (t, id, s, e) => t === "movie" ? `https://autoembed.cc/movie/tmdb/${id}` : `https://autoembed.cc/tv/tmdb/${id}-${s}-${e}` },
  { id: "multiembed", name: "MultiEmbed", getUrl: (t, id, s, e) => t === "movie" ? `https://multiembed.mov/?video_id=${id}&tmdb=1` : `https://multiembed.mov/?video_id=${id}&tmdb=1&s=${s}&e=${e}` },
  { id: "embedsu", name: "Embed.su", getUrl: (t, id, s, e) => t === "movie" ? `https://embed.su/embed/movie/${id}` : `https://embed.su/embed/tv/${id}/${s}/${e}` },
  { id: "smashystream", name: "Smashy", getUrl: (t, id, s, e) => t === "movie" ? `https://embed.smashystream.com/playere.php?tmdb=${id}` : `https://embed.smashystream.com/playere.php?tmdb=${id}&season=${s}&episode=${e}` },
];

const EMOJIS = ["😂", "😱", "❤️", "👏", "🔥", "🎬"];

interface PeerConnection {
  peerId: string;
  userName: string;
  peer: any;
  stream?: MediaStream;
}

function WatchRoomPageContent({ params }: { params: { id: string } }) {
  const roomId = params.id;
  const [, setLocation] = useLocation();
  const { user } = useUser();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [activeTab, setActiveTab] = useState<"chat" | "participants">("chat");

  const { data: room, isLoading: loadingRoom } = useGetRoom(roomId, { query: { enabled: !!roomId } });
  const deleteRoomMutation = useDeleteRoom();
  const { data: initialMessages } = useGetRoomMessages(roomId, { query: { enabled: !!roomId } });
  const isHost = room?.hostId === user?.id;

  // ----- Video Player State -----
  const [serverIdx, setServerIdx] = useState(0);
  const [iframeKey, setIframeKey] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [showBar, setShowBar] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ----- Layout Settings State -----
  const [selectorVisible, setSelectorVisible] = useState(true);
  const [selectorPosition, setSelectorPosition] = useState<'bottom' | 'top' | 'right'>('bottom');
  const [showLayoutMenu, setShowLayoutMenu] = useState(false);

  // 🌟 Sync Countdown State
  const [syncCountdown, setSyncCountdown] = useState<number | null>(null);

  const server = SERVERS[serverIdx];
  const embedUrl = room ? server.getUrl(room.contentType as ContentType, room.contentId, room.season ?? undefined, room.episode ?? undefined) : "";

  const switchTo = useCallback((idx: number) => {
    setLoaded(false);
    setServerIdx(idx);
    setIframeKey((k) => k + 1);
    setShowBar(true);
  }, []);
  const nextServer = () => switchTo((serverIdx + 1) % SERVERS.length);

  const resetHideTimer = useCallback(() => {
    setShowBar(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowBar(false), 4000);
  }, []);

  useEffect(() => {
    resetHideTimer();
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [serverIdx, resetHideTimer]);

  // ----- Chat & Reactions State -----
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [participants, setParticipants] = useState<{ id: string; name: string }[]>([]);
  const [floatingReactions, setFloatingReactions] = useState<{ id: number; emoji: string; x: number }[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  // 🌟 Safe Message Adder (Prevents duplicate join/leave spam without removing your logic)
  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => {
      if (msg.type === 'system') {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.type === 'system' && lastMsg.content === msg.content) return prev;
      }
      return [...prev, msg];
    });
  }, []);

  // ----- WebRTC Call State -----
  const [inCall, setInCall] = useState(false);
  const inCallRef = useRef(false);
  useEffect(() => { inCallRef.current = inCall; }, [inCall]);

  const [callType, setCallType] = useState<'audio' | 'video'>('video');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const peersRef = useRef<Map<string, PeerConnection>>(new Map());
  const [, forcePeerRerender] = useState(0);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => { if (initialMessages) setMessages(initialMessages); }, [initialMessages]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // ---------------------------------------------------------------------
  // WebRTC Helper Functions
  // ---------------------------------------------------------------------
  const createPeerConnection = (peerId: string, peerName: string, initiator: boolean): PeerConnection => {
    const peer = new SimplePeer({
      initiator,
      trickle: true,
      stream: localStreamRef.current || undefined,
      config: {
        // 🌟 Robust ICE servers for strict networks
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
          { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
          { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
          { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
        ]
      }
    });

    peer.on("signal", (signal: any) => {
      socket?.emit("webrtc-signal", { roomId, to: peerId, from: user!.id, fromName: user!.fullName || user!.firstName || "Anonymous", signal });
    });

    peer.on("stream", (remoteStream: MediaStream) => {
      const conn = peersRef.current.get(peerId);
      if (conn) {
        conn.stream = remoteStream;
        forcePeerRerender((n) => n + 1);
      }
    });

    // 🌟 Fallback for modern browsers that emit 'track' instead of 'stream'
    peer.on("track", (track: any, stream: MediaStream) => {
      const conn = peersRef.current.get(peerId);
      if (conn && stream) {
        conn.stream = stream;
        forcePeerRerender((n) => n + 1);
      }
    });

    peer.on("close", () => destroyPeerConnection(peerId));
    peer.on("error", () => destroyPeerConnection(peerId));

    const conn: PeerConnection = { peerId, userName: peerName, peer };
    peersRef.current.set(peerId, conn);
    forcePeerRerender((n) => n + 1);
    return conn;
  };

  const destroyPeerConnection = (peerId: string) => {
    const conn = peersRef.current.get(peerId);
    if (conn) {
      conn.peer.destroy();
      peersRef.current.delete(peerId);
      forcePeerRerender((n) => n + 1);
    }
  };

  const joinCall = async (type: 'audio' | 'video') => {
    try {
      const constraints = {
        audio: true,
        video: type === 'video' ? { width: 640, height: 480, facingMode: 'user' } : false
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      setLocalStream(stream);
      setCamOn(type === 'video');
      setMicOn(true);
      setInCall(true);
      setCallType(type);

      participants.forEach((p) => {
        if (p.id === user?.id) return;
        // 🌟 FIXED: Only initiate if our ID is "less than" theirs to prevent double-dialing glare
        createPeerConnection(p.id, p.name, user!.id < p.id);
      });
    } catch (err) {
      alert("Could not access camera/microphone. Please check browser permissions.");
    }
  };

  const leaveCall = () => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setCamOn(false);
    setMicOn(false);
    setInCall(false);
    peersRef.current.forEach((conn) => conn.peer.destroy());
    peersRef.current.clear();
    forcePeerRerender((n) => n + 1);
  };

  const toggleMic = () => {
    if (!localStreamRef.current) return;
    const next = !micOn;
    localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = next));
    setMicOn(next);
  };

  const toggleCam = () => {
    if (!localStreamRef.current) return;
    const videoTrack = localStreamRef.current.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setCamOn(videoTrack.enabled);
    }
  };

  const copyInviteLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  // 🌟 Host Sync Countdown Trigger
  const startSyncCountdown = () => {
    socket?.emit("sync-countdown", { roomId, seconds: 5 });
  };

  useEffect(() => {
    return () => { localStreamRef.current?.getTracks().forEach((t) => t.stop()); };
  }, []);

  // ---------------------------------------------------------------------
  // Socket connection + signaling
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!user || !roomId) return;

    const s = io({ path: "/ws/socket.io", query: { roomId, userId: user.id, userName: user.fullName || user.firstName || "Anonymous" } });

    s.on("connect", () => s.emit("join-room", { roomId, userId: user.id, userName: user.fullName || user.firstName || "Anonymous" }));

    s.on("chat-message", (msg: ChatMessage) => addMessage(msg));

    s.on("reaction", ({ emoji }: { emoji: string }) => {
      const id = Date.now() + Math.random();
      setFloatingReactions((prev) => [...prev, { id, emoji, x: Math.random() * 80 + 10 }]);
      setTimeout(() => setFloatingReactions((prev) => prev.filter((r) => r.id !== id)), 3000);
    });

    // 🌟 Listen for Sync Countdown
    s.on("sync-countdown", ({ seconds }: { seconds: number }) => {
      let count = seconds;
      setSyncCountdown(count);
      const interval = setInterval(() => {
        count -= 1;
        if (count > 0) setSyncCountdown(count);
        else { setSyncCountdown(null); clearInterval(interval); }
      }, 1000);
    });

    s.on("user-joined", ({ userId, userName }: { userId: string; userName: string }) => {
      setParticipants((prev) => (prev.find((p) => p.id === userId) ? prev : [...prev, { id: userId, name: userName }]));

      // Kept your manual system message append, but routed through addMessage to prevent duplicates
      addMessage({ id: Date.now().toString(), roomId, userId: "system", userName: "System", userAvatar: null, content: `${userName} joined the room`, type: "system", createdAt: new Date().toISOString() } as ChatMessage);

      if (inCallRef.current && localStreamRef.current && userId !== user.id) {
        // 🌟 FIXED: Only initiate if our ID is "less than" theirs
        createPeerConnection(userId, userName, user.id < userId);
      }
    });

    s.on("user-left", ({ userId, userName }: { userId: string; userName: string }) => {
      setParticipants((prev) => prev.filter((p) => p.id !== userId));
      destroyPeerConnection(userId);
      addMessage({ id: Date.now().toString(), roomId, userId: "system", userName: "System", userAvatar: null, content: `${userName} left the room`, type: "system", createdAt: new Date().toISOString() } as ChatMessage);
    });

    s.on("webrtc-signal", ({ from, fromName, signal }: { from: string; fromName: string; signal: any }) => {
      if (!inCallRef.current || !localStreamRef.current) return; 
      let conn = peersRef.current.get(from);
      if (!conn) conn = createPeerConnection(from, fromName, false);
      conn.peer.signal(signal);
    });

    setSocket(s);
    return () => {
      s.disconnect();
      peersRef.current.forEach((conn) => conn.peer.destroy());
      peersRef.current.clear();
    };
  }, [user, roomId, addMessage]);

  // ---------------------------------------------------------------------
  // Chat / Room Actions
  // ---------------------------------------------------------------------
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !socket || !user) return;
    socket.emit("chat-message", { roomId, userId: user.id, userName: user.fullName || user.firstName || "Anonymous", userAvatar: user.imageUrl, content: chatInput, type: "text" });
    setChatInput("");
  };

  const sendReaction = (emoji: string) => {
    if (!socket || !user) return;
    socket.emit("reaction", { roomId, emoji, userId: user.id, userName: user.fullName || user.firstName || "Anonymous" });
  };

  const handleEndRoom = () => {
    if (confirm("End watch party for everyone?")) deleteRoomMutation.mutate({ id: roomId }, { onSuccess: () => setLocation("/rooms") });
  };

  if (loadingRoom) return <div className="flex-1 flex justify-center items-center h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (!room) return <div className="flex-1 flex justify-center items-center h-screen">Room not found</div>;

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-64px)] w-full overflow-hidden bg-background">

      {/* 🌟 Giant Sync Countdown Overlay */}
      {syncCountdown !== null && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm pointer-events-none">
          <div className="flex flex-col items-center gap-4">
            <p className="text-white/60 text-xl font-medium">Get ready to press play...</p>
            <div className="text-[150px] font-black text-yellow-400 tabular-nums drop-shadow-2xl" style={{ textShadow: '0 0 40px rgba(250,204,21,0.8)' }}>
              {syncCountdown}
            </div>
            <p className="text-white/80 text-2xl font-bold uppercase tracking-widest">Press Play Now!</p>
          </div>
        </div>
      )}

      <div className="pointer-events-none fixed inset-0 z-[100] overflow-hidden">
        {floatingReactions.map((r) => (
          <div key={r.id} className="absolute bottom-20 text-4xl animate-float-up" style={{ left: `${r.x}%` }}>{r.emoji}</div>
        ))}
      </div>

      {/* Main Video Area */}
      <div className="flex-1 flex flex-col relative bg-black border-r border-border/50" onMouseMove={resetHideTimer}>
        <div className="flex-1 relative w-full h-full">
          {!loaded && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black pointer-events-none">
              <Loader2 className="w-10 h-10 text-yellow-400 animate-spin" />
              <p className="text-white/50 text-sm">Loading {server.name}…</p>
            </div>
          )}

          {/* 🌟 allow-popups added back so embed providers can verify the user */}
          <iframe
            key={iframeKey}
            src={embedUrl}
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            sandbox="allow-scripts allow-same-origin allow-forms allow-presentation allow-popups"
            allowFullScreen
            referrerPolicy="no-referrer"
            className="w-full h-full border-0 absolute inset-0 z-0"
            title="Watch Party Player"
            onLoad={() => setLoaded(true)}
          />

          {/* Top Bar Overlay */}
          <div className={`absolute top-0 inset-x-0 z-20 transition-opacity duration-300 pointer-events-none ${showBar ? "opacity-100" : "opacity-0"}`}>
            <div className="bg-gradient-to-b from-black/95 via-black/60 to-transparent px-4 pt-3 pb-8">
              <div className="flex items-center gap-3">
                <button onClick={() => setLocation('/rooms')} className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all flex-shrink-0 pointer-events-auto">
                  <LogOut className="w-4 h-4" />
                </button>
                <div className="flex-1 min-w-0 pointer-events-auto">
                  <h2 className="text-white font-bold text-sm truncate">{room.name}</h2>
                  <p className="text-white/60 text-xs truncate">{room.contentTitle}</p>
                </div>

                {/* 🌟 Host Sync Button */}
                {isHost && (
                  <button onClick={startSyncCountdown} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all pointer-events-auto shadow-lg" title="Start 5s Countdown for everyone to press play">
                    <Timer className="w-3.5 h-3.5" /> Sync Play
                  </button>
                )}

                <button onClick={() => setShowInfo(true)} className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all flex-shrink-0 pointer-events-auto" title="Player Info">
                  <Info className="w-4 h-4" />
                </button>

                {/* 🌟 Layout Settings Menu */}
                <div className="relative pointer-events-auto">
                  <button 
                    onClick={() => setShowLayoutMenu(!showLayoutMenu)} 
                    className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all flex-shrink-0" 
                    title="Layout Settings"
                  >
                    <Settings className="w-4 h-4" />
                  </button>

                  {showLayoutMenu && (
                    <div className="absolute top-full right-0 mt-2 w-56 bg-card border border-border rounded-lg shadow-xl p-3 z-50" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-medium text-foreground">Server Selector</span>
                        <button 
                          onClick={() => setSelectorVisible(!selectorVisible)}
                          className={`w-10 h-5 rounded-full transition-colors relative ${selectorVisible ? 'bg-primary' : 'bg-muted'}`}
                        >
                          <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${selectorVisible ? 'left-5' : 'left-0.5'}`} />
                        </button>
                      </div>
                      {selectorVisible && (
                        <div className="space-y-1.5 border-t border-border pt-3">
                          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Position</p>
                          {(['bottom', 'top', 'right'] as const).map(pos => (
                            <button
                              key={pos}
                              onClick={() => setSelectorPosition(pos)}
                              className={`w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors ${selectorPosition === pos ? 'bg-primary/20 text-primary font-semibold' : 'hover:bg-muted text-foreground'}`}
                            >
                              {pos.charAt(0).toUpperCase() + pos.slice(1)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <button onClick={copyInviteLink} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all pointer-events-auto ${linkCopied ? 'bg-green-500/20 border-green-500/30 text-green-400' : 'bg-white/10 border-white/20 text-white hover:bg-white/20'}`}>
                  {linkCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {linkCopied ? "Copied!" : "Invite"}
                </button>

                <button onClick={() => { setLoaded(false); setIframeKey((k) => k + 1); }} className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all flex-shrink-0 pointer-events-auto" title="Reload">
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* 🌟 Dynamic Server Selector */}
          {selectorVisible && (
            <>
              {selectorPosition === 'bottom' && (
                <div className={`absolute bottom-0 inset-x-0 z-20 transition-opacity duration-300 pointer-events-none ${showBar ? "opacity-100" : "opacity-0"}`}>
                  <div className="bg-gradient-to-t from-black/95 via-black/70 to-transparent px-4 pb-6 pt-10 flex justify-center">
                    <div className="flex flex-col items-center gap-2 pointer-events-auto bg-black/70 p-3 rounded-xl backdrop-blur-md border border-white/10 max-w-2xl w-full shadow-2xl">
                      <div className="flex items-center gap-1.5 text-yellow-400/80 text-xs">
                        <AlertTriangle className="w-3 h-3" />
                        <span>Video not loading? Try a different server</span>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap justify-center">
                        {SERVERS.map((s, idx) => (
                          <button key={s.id} onClick={() => switchTo(idx)} className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${idx === serverIdx ? 'bg-yellow-400 text-black border-yellow-400' : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/15'}`}>
                            {s.name}
                          </button>
                        ))}
                        <button onClick={nextServer} className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-white/70 border border-white/10 hover:bg-white/20">
                          Next <ChevronRight className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {selectorPosition === 'top' && (
                <div className={`absolute top-20 inset-x-0 z-20 transition-opacity duration-300 pointer-events-none ${showBar ? "opacity-100" : "opacity-0"} flex justify-center px-4`}>
                  <div className="flex flex-col items-center gap-2 pointer-events-auto bg-black/80 p-3 rounded-xl backdrop-blur-md border border-white/10 max-w-2xl w-full shadow-2xl">
                    <div className="flex items-center gap-1.5 text-yellow-400/80 text-xs">
                      <AlertTriangle className="w-3 h-3" />
                      <span>Video not loading? Try a different server</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-center">
                      {SERVERS.map((s, idx) => (
                        <button key={s.id} onClick={() => switchTo(idx)} className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${idx === serverIdx ? 'bg-yellow-400 text-black border-yellow-400' : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/15'}`}>
                          {s.name}
                        </button>
                      ))}
                      <button onClick={nextServer} className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-white/70 border border-white/10 hover:bg-white/20">
                        Next <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {selectorPosition === 'right' && (
                <div className={`absolute top-1/2 -translate-y-1/2 right-4 z-20 transition-opacity duration-300 pointer-events-none ${showBar ? "opacity-100" : "opacity-0"}`}>
                  <div className="flex flex-col items-center gap-2 pointer-events-auto bg-black/80 p-2 rounded-xl backdrop-blur-md border border-white/10 shadow-2xl max-h-[70vh] overflow-y-auto">
                     <div className="text-yellow-400/80 text-[10px] font-bold uppercase tracking-wider mb-1">
                       Servers
                     </div>
                     <div className="flex flex-col items-center gap-1.5 w-20">
                       {SERVERS.map((s, idx) => (
                         <button key={s.id} onClick={() => switchTo(idx)} className={`w-full px-2 py-1.5 rounded-md text-[11px] font-semibold border transition-all text-center truncate ${idx === serverIdx ? 'bg-yellow-400 text-black border-yellow-400' : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/15'}`}>
                           {s.name}
                         </button>
                       ))}
                       <button onClick={nextServer} className="w-full flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-semibold bg-white/10 text-white/70 border border-white/10 hover:bg-white/20">
                         Next
                       </button>
                     </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* 🎥 Floating Call Grid (Picture-in-Picture) */}
          {inCall && (
            <div className="absolute bottom-28 right-4 z-30 bg-black/80 backdrop-blur-md rounded-xl p-3 shadow-2xl border border-white/10 flex flex-col gap-2 max-w-xs pointer-events-auto">
              <div className="flex items-center justify-between mb-1">
                <span className="text-white text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  {callType === 'video' ? 'Video Call' : 'Voice Call'}
                </span>
                <button onClick={leaveCall} className="text-red-400 hover:text-red-300 text-xs font-semibold">Leave</button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="relative w-24 h-16 bg-secondary rounded-md overflow-hidden">
                  {callType === 'video' && camOn ? (
                    // 🌟 FIXED: scaleX(-1) mirrors the camera so it's not inverted
                    <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white text-xl font-bold bg-primary/20">
                      {user?.firstName?.charAt(0) || 'Y'}
                    </div>
                  )}
                  <span className="absolute bottom-0 left-0 bg-black/60 text-white text-[9px] px-1">You</span>
                </div>

                {Array.from(peersRef.current.values()).map((conn) => (
                  <div key={conn.peerId} className="relative w-24 h-16 bg-secondary rounded-md overflow-hidden">
                    {conn.stream ? (
                      <RemoteVideoTile stream={conn.stream} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-white text-xl font-bold bg-primary/20">
                        {conn.userName.charAt(0)}
                      </div>
                    )}
                    <span className="absolute bottom-0 left-0 bg-black/60 text-white text-[9px] px-1 truncate max-w-full">{conn.userName}</span>
                  </div>
                ))}
              </div>

              <div className="flex justify-center gap-3 mt-1">
                <button onClick={toggleMic} className={`p-1.5 rounded-full ${micOn ? 'bg-white/10 text-white' : 'bg-red-500 text-white'}`}>
                  {micOn ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
                </button>
                {callType === 'video' && (
                  <button onClick={toggleCam} className={`p-1.5 rounded-full ${camOn ? 'bg-white/10 text-white' : 'bg-red-500 text-white'}`}>
                    {camOn ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Info Modal */}
          {showInfo && (
            <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 pointer-events-auto" onClick={() => setShowInfo(false)}>
              <div className="bg-card border border-border rounded-xl p-6 max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-lg font-bold text-foreground">About Video Controls</h3>
                  <button onClick={() => setShowInfo(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  Because we use secure, third-party video servers (like VidSrc and Smashy), browser security policies physically prevent external websites from hiding their native controls or injecting custom Play/Pause buttons.
                </p>
                <p className="text-sm text-muted-foreground mb-4">
                  <strong className="text-foreground">How to watch:</strong> Simply click anywhere on the video to reveal the server's native Play, Pause, Quality, and Fullscreen controls.
                </p>
                <button onClick={() => setShowInfo(false)} className="w-full py-2 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors">Got it</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sidebar */}
      <div className="w-full lg:w-96 flex flex-col bg-card border-l border-border/50 h-full">
        <div className="p-3 border-b border-border/50 flex items-center gap-2">
          {!inCall ? (
            <>
              <button onClick={() => joinCall('audio')} className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg transition-all">
                <PhoneCall className="w-3.5 h-3.5" /> Voice
              </button>
              <button onClick={() => joinCall('video')} className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-green-600 hover:bg-green-500 text-white text-xs font-bold rounded-lg transition-all">
                <Video className="w-3.5 h-3.5" /> Video
              </button>
            </>
          ) : (
            <button onClick={leaveCall} className="w-full flex items-center justify-center gap-1.5 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-lg transition-all">
              <PhoneOff className="w-3.5 h-3.5" /> End Call
            </button>
          )}
        </div>

        <div className="flex border-b border-border/50">
          <button onClick={() => setActiveTab("chat")} className={`flex-1 py-3 flex justify-center items-center gap-2 font-medium text-sm transition-colors border-b-2 ${activeTab === "chat" ? "border-primary text-primary bg-secondary/20" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <MessageSquare className="w-4 h-4" /> Chat
          </button>
          <button onClick={() => setActiveTab("participants")} className={`flex-1 py-3 flex justify-center items-center gap-2 font-medium text-sm transition-colors border-b-2 ${activeTab === "participants" ? "border-primary text-primary bg-secondary/20" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <Users className="w-4 h-4" /> Participants ({participants.length + 1})
          </button>
        </div>

        {activeTab === "chat" ? (
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg, i) => {
                if (msg.type === "system") return (
                  <div key={i} className="text-center">
                    <span className="text-xs font-medium text-muted-foreground bg-secondary/50 px-3 py-1 rounded-full border border-border/50">{msg.content}</span>
                  </div>
                );
                const isMe = msg.userId === user?.id;
                return (
                  <div key={msg.id} className={`flex gap-3 ${isMe ? "flex-row-reverse" : "flex-row"}`}>
                    <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 bg-secondary border border-border/50">
                      {msg.userAvatar ? <img src={msg.userAvatar} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-xs font-bold bg-primary/20 text-primary">{msg.userName.charAt(0)}</div>}
                    </div>
                    <div className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                      <span className="text-xs text-muted-foreground mb-1 px-1">{isMe ? 'You' : msg.userName}</span>
                      <div className={`px-4 py-2 rounded-2xl max-w-[240px] text-sm break-words shadow-sm ${isMe ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-secondary text-secondary-foreground rounded-tl-sm border border-border/50"}`}>
                        {msg.content}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
            <div className="p-2 border-t border-border/50 bg-secondary/30 flex justify-around">
              {EMOJIS.map((emoji) => (
                <button key={emoji} onClick={() => sendReaction(emoji)} className="w-10 h-10 flex items-center justify-center text-xl hover:bg-secondary rounded-full transition-colors active:scale-90">{emoji}</button>
              ))}
            </div>
            <form onSubmit={handleSendMessage} className="p-4 border-t border-border/50 bg-card">
              <div className="relative">
                <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Type a message..." className="w-full bg-input border border-border rounded-full py-2.5 pl-4 pr-12 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary" />
                <button type="submit" disabled={!chatInput.trim()} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="relative w-10 h-10 rounded-full overflow-hidden bg-secondary flex-shrink-0">
                  <img src={user?.imageUrl} className="w-full h-full object-cover" alt="You" />
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-sm leading-none truncate">{user?.fullName} (You)</p>
                  <p className="text-xs text-muted-foreground mt-1">{isHost ? "Host" : "Participant"}</p>
                </div>
              </div>
            </div>

            {participants.map((p) => (
              <div key={p.id} className="p-4 rounded-xl border border-border/50 bg-secondary/30 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative w-10 h-10 rounded-full bg-secondary border border-border flex items-center justify-center text-muted-foreground font-bold flex-shrink-0">
                    {p.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-sm leading-none truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground mt-1">{p.id === room.hostId ? "Host" : "Participant"}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// 🌟 FIXED: Handles browser autoplay blocks for remote audio/video
function RemoteVideoTile({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);

  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream;
      const playPromise = ref.current.play();
      if (playPromise !== undefined) {
        playPromise.catch((e) => {
          console.log("Autoplay blocked, muting video to allow playback");
          setAudioBlocked(true);
          ref.current!.muted = true;
          ref.current!.play().catch(() => {});
        });
      }
    }
  }, [stream]);

  const handleUnmute = () => {
    if (ref.current) {
      ref.current.muted = false;
      ref.current.play().then(() => setAudioBlocked(false)).catch(() => {});
    }
  };

  return (
    <div className="relative w-full h-full group">
      <video ref={ref} autoPlay playsInline className="w-full h-full object-cover cursor-pointer" onClick={handleUnmute} />
      {audioBlocked && (
        <button 
          onClick={handleUnmute} 
          className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center text-white text-[10px] font-bold gap-1 hover:bg-black/40 transition-colors"
        >
          <MicOff className="w-4 h-4" />
          Tap for Audio
        </button>
      )}
    </div>
  );
}

export default withAuthGuard(WatchRoomPageContent);