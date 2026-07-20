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
  Video, VideoOff, Mic, MicOff, PhoneCall, PhoneOff, Settings, Timer,
  Maximize, Minimize, PanelRightClose, PanelRightOpen, Cast, MonitorOff,
  Radio
} from "lucide-react";

// ─── Server definitions ───────────────────────────────────────────────────────
export type ContentType = "movie" | "tv";
interface ServerDef {
  id: string;
  name: string;
  getUrl: (type: ContentType, id: string, season?: number, episode?: number) => string;
}

const SERVERS: ServerDef[] = [
  { id: "vidsrc",      name: "VidSrc",     getUrl: (t, id, s, e) => t === "movie" ? `https://vidsrc.to/embed/movie/${id}` : `https://vidsrc.to/embed/tv/${id}/${s}/${e}` },
  { id: "vidsrcme",    name: "VidSrc.me",  getUrl: (t, id, s, e) => t === "movie" ? `https://vidsrc.me/embed/movie?tmdb=${id}` : `https://vidsrc.me/embed/tv?tmdb=${id}&season=${s}&episode=${e}` },
  { id: "vidsrcxyz",   name: "VidSrc.xyz", getUrl: (t, id, s, e) => t === "movie" ? `https://vidsrc.xyz/embed/movie?tmdb=${id}` : `https://vidsrc.xyz/embed/tv?tmdb=${id}&season=${s}&episode=${e}` },
  { id: "autoembed",   name: "AutoEmbed",  getUrl: (t, id, s, e) => t === "movie" ? `https://autoembed.cc/movie/tmdb/${id}` : `https://autoembed.cc/tv/tmdb/${id}-${s}-${e}` },
  { id: "2embed",      name: "2Embed",     getUrl: (t, id, s, e) => t === "movie" ? `https://www.2embed.cc/embed/${id}` : `https://www.2embed.cc/embedtv/${id}&s=${s}&e=${e}` },
  { id: "multiembed",  name: "MultiEmbed", getUrl: (t, id, s, e) => t === "movie" ? `https://multiembed.mov/?video_id=${id}&tmdb=1` : `https://multiembed.mov/?video_id=${id}&tmdb=1&s=${s}&e=${e}` },
  { id: "embedsu",     name: "Embed.su",   getUrl: (t, id, s, e) => t === "movie" ? `https://embed.su/embed/movie/${id}` : `https://embed.su/embed/tv/${id}/${s}/${e}` },
  { id: "smashystream",name: "Smashy",     getUrl: (t, id, s, e) => t === "movie" ? `https://embed.smashystream.com/playere.php?tmdb=${id}` : `https://embed.smashystream.com/playere.php?tmdb=${id}&season=${s}&episode=${e}` },
  { id: "rive",        name: "Rive",       getUrl: (t, id, s, e) => t === "movie" ? `https://rivestream.live/embed?type=movie&id=${id}` : `https://rivestream.live/embed?type=tv&id=${id}&season=${s}&episode=${e}` },
  { id: "vidlink",     name: "VidLink",    getUrl: (t, id, s, e) => t === "movie" ? `https://vidlink.pro/movie/${id}` : `https://vidlink.pro/tv/${id}/${s}/${e}` },
];

const EMOJIS = ["😂", "😱", "❤️", "👏", "🔥", "🎬"];

interface PeerConnection {
  peerId: string;
  userName: string;
  peer: any;
  stream?: MediaStream;
  connected?: boolean;
  connectionTimer?: ReturnType<typeof setTimeout>;
}

function WatchRoomPageContent({ params }: { params: { id: string } }) {
  const roomId = params.id;
  const [, setLocation] = useLocation();
  const { user } = useUser();
  const [socket, setSocket] = useState<Socket | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [activeTab, setActiveTab] = useState<"chat" | "participants">("chat");

  const { data: room, isLoading: loadingRoom } = useGetRoom(roomId, { query: { enabled: !!roomId } });
  const deleteRoomMutation = useDeleteRoom();
  const { data: initialMessages } = useGetRoomMessages(roomId, { query: { enabled: !!roomId } });
  // isHost is computed server-side (room.hostId is an internal DB UUID, not a Clerk ID)
  const isHost = room?.isHost === true;
  const isHostRef = useRef(false);
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);

  // ----- Video Player State -----
  const [serverIdx, setServerIdx] = useState(0);
  const [iframeKey, setIframeKey] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [showBar, setShowBar] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ----- Layout Settings State -----
  const [selectorVisible, setSelectorVisible] = useState(true);
  const [selectorPosition, setSelectorPosition] = useState<'bottom' | 'top' | 'right'>('bottom');
  const [showLayoutMenu, setShowLayoutMenu] = useState(false);

  // Sync Countdown State
  const [syncCountdown, setSyncCountdown] = useState<number | null>(null);
  const [syncPhase, setSyncPhase] = useState<'counting' | 'play' | null>(null);

  // Sidebar + Fullscreen
  const [showSidebar, setShowSidebar] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const playerAreaRef = useRef<HTMLDivElement>(null);

  const server = SERVERS[serverIdx];
  const embedUrl = room ? server.getUrl(room.contentType as ContentType, room.contentId, room.season ?? undefined, room.episode ?? undefined) : "";

  // Switch server locally (no side effects — used by host-action handler too)
  const switchTo = useCallback((idx: number) => {
    setLoaded(false);
    setServerIdx(idx);
    setIframeKey((k) => k + 1);
    setShowBar(true);
  }, []);

  // Host switches server and broadcasts to all members
  const handleServerSwitch = useCallback((idx: number) => {
    switchTo(idx);
    if (isHostRef.current) {
      socketRef.current?.emit("host-action", {
        roomId,
        action: { type: "server-change", serverIdx: idx },
      });
    }
  }, [roomId, switchTo]);

  const nextServer = () => handleServerSwitch((serverIdx + 1) % SERVERS.length);

  const resetHideTimer = useCallback(() => {
    setShowBar(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowBar(false), 4000);
  }, []);

  useEffect(() => {
    resetHideTimer();
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [serverIdx, resetHideTimer]);

  // Fullscreen API
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      playerAreaRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  useEffect(() => {
    const onFSChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFSChange);
    return () => document.removeEventListener('fullscreenchange', onFSChange);
  }, []);

  // ----- Chat & Reactions State -----
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [participants, setParticipants] = useState<{ id: string; name: string }[]>([]);
  const [floatingReactions, setFloatingReactions] = useState<{ id: number; emoji: string; x: number }[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  // Safe dedup message adder
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

  // ----- Watch Stream State (host → guests live screen share) -----
  const [isSharing, setIsSharing] = useState(false);
  const isSharingRef = useRef(false);
  useEffect(() => { isSharingRef.current = isSharing; }, [isSharing]);
  const [hostIsSharing, setHostIsSharing] = useState(false);
  const [hostStream, setHostStream] = useState<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const watchPeersRef = useRef<Map<string, any>>(new Map());
  const hostStreamVideoRef = useRef<HTMLVideoElement>(null);

  // Who is currently on a call — visible to everyone in the room, not just callers
  const [activeCallers, setActiveCallers] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => { if (initialMessages) setMessages(initialMessages); }, [initialMessages]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (hostStreamVideoRef.current && hostStream) {
      hostStreamVideoRef.current.srcObject = hostStream;
      hostStreamVideoRef.current.play().catch(() => {});
    }
  }, [hostStream]);

  // Stop media + watch peers on unmount
  useEffect(() => {
    return () => {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      displayStreamRef.current?.getTracks().forEach((t) => t.stop());
      watchPeersRef.current.forEach((p) => { try { p.destroy(); } catch {} });
    };
  }, []);

  // ---------------------------------------------------------------------
  // WebRTC Helper Functions
  // ---------------------------------------------------------------------
  const createPeerConnection = useCallback((peerId: string, peerName: string, initiator: boolean): PeerConnection => {
    const peer = new SimplePeer({
      initiator,
      trickle: true,
      stream: localStreamRef.current || undefined,
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:global.stun.twilio.com:3478" },
          { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
          { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
          { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
        ],
      },
    });

    peer.on("signal", (signal: any) => {
      const uid = user?.id;
      if (!uid) return;
      socketRef.current?.emit("webrtc-signal", {
        roomId,
        to: peerId,
        from: uid,
        fromName: user?.fullName || user?.firstName || "Anonymous",
        signal,
      });
    });

    peer.on("stream", (remoteStream: MediaStream) => {
      const conn = peersRef.current.get(peerId);
      if (conn) {
        conn.stream = remoteStream;
        forcePeerRerender((n) => n + 1);
      }
    });

    // Fallback for modern browsers that emit 'track' instead of 'stream'
    peer.on("track", (_track: any, stream: MediaStream) => {
      const conn = peersRef.current.get(peerId);
      if (conn && stream) {
        conn.stream = stream;
        forcePeerRerender((n) => n + 1);
      }
    });

    peer.on("connect", () => {
      const c = peersRef.current.get(peerId);
      if (c) {
        c.connected = true;
        clearTimeout(c.connectionTimer);
      }
    });

    peer.on("close", () => destroyPeerConnection(peerId));
    peer.on("error", () => destroyPeerConnection(peerId));

    // 20-second ICE timeout — if the peer never fires "connect", tear it down
    const connectionTimer = setTimeout(() => {
      const c = peersRef.current.get(peerId);
      if (c && !c.connected) destroyPeerConnection(peerId);
    }, 20_000);

    const conn: PeerConnection = { peerId, userName: peerName, peer, connectionTimer };
    peersRef.current.set(peerId, conn);
    forcePeerRerender((n) => n + 1);
    return conn;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, user]);

  const destroyPeerConnection = useCallback((peerId: string) => {
    const conn = peersRef.current.get(peerId);
    if (conn) {
      // Delete from map FIRST — prevents the peer's own "close" event from
      // re-entering destroyPeerConnection and triggering a destroy loop.
      clearTimeout(conn.connectionTimer);
      peersRef.current.delete(peerId);
      forcePeerRerender((n) => n + 1);
      conn.peer.destroy();
    }
  }, []);

  // ----- Watch Stream Peers (host captures screen → guests receive WebRTC stream) -----
  const ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" },
    { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
  ];

  const createWatchPeer = useCallback((peerId: string, initiator: boolean) => {
    if (watchPeersRef.current.has(peerId)) return watchPeersRef.current.get(peerId);
    const peer = new SimplePeer({
      initiator,
      trickle: true,
      stream: initiator ? (displayStreamRef.current || undefined) : undefined,
      config: { iceServers: ICE_SERVERS },
    });
    peer.on("signal", (signal: any) => {
      const uid = user?.id;
      if (!uid) return;
      socketRef.current?.emit("watch-signal", { roomId, to: peerId, from: uid, signal });
    });
    peer.on("stream", (stream: MediaStream) => { setHostStream(stream); });
    peer.on("track", (_t: any, stream: MediaStream) => { if (stream) setHostStream(stream); });
    peer.on("close", () => { watchPeersRef.current.delete(peerId); if (!initiator) setHostStream(null); });
    peer.on("error", () => { watchPeersRef.current.delete(peerId); if (!initiator) setHostStream(null); });
    watchPeersRef.current.set(peerId, peer);
    return peer;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, user]);

  const stopWatchShare = useCallback(() => {
    isSharingRef.current = false;
    setIsSharing(false);
    displayStreamRef.current?.getTracks().forEach((t) => t.stop());
    displayStreamRef.current = null;
    watchPeersRef.current.forEach((p) => { try { p.destroy(); } catch {} });
    watchPeersRef.current.clear();
    socketRef.current?.emit("watch-stop", { roomId, userId: user?.id });
  }, [roomId, user]);

  const startWatchShare = useCallback(async () => {
    try {
      // preferCurrentTab skips the full picker and auto-selects this tab in Chrome
      const stream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 30 }, preferCurrentTab: true },
        audio: { echoCancellation: false, noiseSuppression: false },
        preferCurrentTab: true,
        selfBrowserSurface: "include",
      });

      // Region Capture API — crop the captured tab stream to just the iframe element
      // so guests only see the player, not the rest of the page.
      // Supported in Chrome 104+; silently skipped on other browsers.
      const iframe = iframeRef.current;
      if (iframe && typeof (window as any).CropTarget !== "undefined") {
        try {
          const cropTarget = await (window as any).CropTarget.fromElement(iframe);
          const [videoTrack] = stream.getVideoTracks();
          if (videoTrack && typeof videoTrack.cropTo === "function") {
            await videoTrack.cropTo(cropTarget);
          }
        } catch {
          // Region Capture not available or failed — stream whole tab as fallback
        }
      }

      displayStreamRef.current = stream;
      isSharingRef.current = true;
      setIsSharing(true);
      // If user stops via browser's built-in "Stop sharing" bar
      stream.getVideoTracks()[0].addEventListener("ended", () => stopWatchShare());
      socketRef.current?.emit("watch-start", { roomId, userId: user?.id });
    } catch {
      // User cancelled or denied permission — silent
    }
  }, [roomId, stopWatchShare, user]);

  // Stable callback refs — keep the socket effect deps to [userId, roomId] only.
  // Without this, Clerk refreshing the user object creates a new `createPeerConnection`
  // identity, which tears down the socket mid-call.
  const addMessageRef = useRef(addMessage);
  const createPeerRef = useRef(createPeerConnection);
  const destroyPeerRef = useRef(destroyPeerConnection);
  const switchToRef = useRef(switchTo);
  const createWatchPeerRef = useRef(createWatchPeer);
  const stopWatchShareRef = useRef(stopWatchShare);
  useEffect(() => { addMessageRef.current = addMessage; }, [addMessage]);
  useEffect(() => { createPeerRef.current = createPeerConnection; }, [createPeerConnection]);
  useEffect(() => { destroyPeerRef.current = destroyPeerConnection; }, [destroyPeerConnection]);
  useEffect(() => { switchToRef.current = switchTo; }, [switchTo]);
  useEffect(() => { createWatchPeerRef.current = createWatchPeer; }, [createWatchPeer]);
  useEffect(() => { stopWatchShareRef.current = stopWatchShare; }, [stopWatchShare]);

  const joinCall = async (type: 'audio' | 'video') => {
    setMediaError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: type === 'video' ? { width: 640, height: 480, facingMode: 'user' } : false,
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      setCamOn(type === 'video');
      setMicOn(true);
      setInCall(true);
      setCallType(type);

      // Tell server we joined — it will reply with call-state (existing callers)
      // and broadcast call-joined to everyone else so they open peer connections to us.
      const uid = user?.id;
      if (!uid) return;
      socketRef.current?.emit("call-joined", {
        roomId,
        userId: uid,
        userName: user?.fullName || user?.firstName || "Anonymous",
      });
    } catch (err) {
      const isDenied =
        err instanceof DOMException &&
        (err.name === "NotAllowedError" || err.name === "PermissionDeniedError");
      setMediaError(
        isDenied
          ? "Camera/microphone access was denied. Allow permissions in your browser and try again."
          : "Could not access camera or microphone. Make sure your device is connected.",
      );
    }
  };

  const leaveCall = useCallback(() => {
    // Synchronously mark as not in call BEFORE any cleanup so reconnect logic
    // in the socket "connect" handler doesn't try to re-announce the call.
    inCallRef.current = false;
    setInCall(false);
    const uid = user?.id;
    if (uid) socketRef.current?.emit("call-left", { roomId, userId: uid });
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setCamOn(false);
    setMicOn(false);
    peersRef.current.forEach((conn) => {
      clearTimeout(conn.connectionTimer);
      conn.peer.destroy();
    });
    peersRef.current.clear();
    forcePeerRerender((n) => n + 1);
  }, [roomId, user]);

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

  // Host triggers a sync countdown for everyone
  const startSyncCountdown = () => {
    socketRef.current?.emit("sync-countdown", { roomId, seconds: 5 });
  };

  // ---------------------------------------------------------------------
  // Socket connection + event handlers
  // Socket only tears down when the user ID or room changes — NOT when
  // callback identities change (Clerk refreshes cause those constantly).
  // All callbacks are accessed via stable refs.
  // ---------------------------------------------------------------------
  const userId = user?.id;
  useEffect(() => {
    if (!userId || !roomId) return;

    const s = io({ path: "/ws/socket.io" });
    socketRef.current = s;
    setSocket(s);

    s.on("connect", () => {
      // Put this socket in a personal room so webrtc-signal routing is
      // always current even after a Clerk auth-refresh reconnect.
      s.emit("identify", userId);
      s.emit("join-room", {
        roomId,
        userId,
        userName: user?.fullName || user?.firstName || "Anonymous",
        userAvatar: user?.imageUrl ?? null,
      });

      // If we were mid-call when the socket disconnected (e.g. Clerk JWT
      // refresh), clean up stale peer objects (their ICE sessions are dead)
      // and re-announce to get a fresh call-state from the server.
      if (inCallRef.current) {
        peersRef.current.forEach((conn) => {
          clearTimeout(conn.connectionTimer);
          conn.peer.destroy();
        });
        peersRef.current.clear();
        forcePeerRerender((n) => n + 1);
        s.emit("call-joined", {
          roomId,
          userId,
          userName: user?.fullName || user?.firstName || "Anonymous",
        });
      }
    });

    // Full member list on join — also includes who's on a call right now
    s.on("room-state", ({ members, callers = [], hostSharing = false }: {
      members: { id: string; name: string; userAvatar: string | null }[];
      callers: { id: string; name: string }[];
      hostSharing?: boolean;
    }) => {
      setParticipants(members.filter((m) => m.id !== userId));
      setActiveCallers(callers.filter((c) => c.id !== userId));
      setHostIsSharing(hostSharing);
    });

    // Host deleted the room — kick everyone back to the rooms list
    s.on("room-closed", () => setLocation("/rooms"));

    s.on("chat-message", (msg: ChatMessage) => addMessageRef.current(msg));

    s.on("reaction", ({ emoji }: { emoji: string }) => {
      const id = Date.now() + Math.random();
      setFloatingReactions((prev) => [...prev, { id, emoji, x: Math.random() * 80 + 10 }]);
      setTimeout(() => setFloatingReactions((prev) => prev.filter((r) => r.id !== id)), 3000);
    });

    // Server relays countdown to all (including host) — show overlay
    s.on("sync-countdown", ({ seconds }: { seconds: number }) => {
      let count = seconds;
      setSyncPhase('counting');
      setSyncCountdown(count);
      const interval = setInterval(() => {
        count -= 1;
        if (count > 0) {
          setSyncCountdown(count);
        } else {
          clearInterval(interval);
          setSyncCountdown(null);
          setSyncPhase('play');
          setTimeout(() => setSyncPhase(null), 2500);
        }
      }, 1000);
    });

    s.on("user-joined", ({ userId: uid, userName, silent }: { userId: string; userName: string; silent?: boolean }) => {
      setParticipants((prev) =>
        prev.find((p) => p.id === uid) ? prev : [...prev, { id: uid, name: userName }]
      );
      // Show chat notification only for genuine new joins — not silent reconnects
      // (Clerk auth refreshes reconnect silently and should not spam the chat).
      if (uid !== userId && !silent) {
        addMessageRef.current({
          id: `presence-join-${uid}-${Date.now()}`,
          roomId,
          userId: "system",
          userName: "System",
          userAvatar: null,
          content: `${userName} joined the room`,
          type: "system",
          createdAt: new Date().toISOString(),
        });
      }
    });

    s.on("user-left", ({ userId: uid, userName: leftName }: { userId: string; userName?: string }) => {
      setParticipants((prev) => prev.filter((p) => p.id !== uid));
      // Show transient presence notification in chat
      addMessageRef.current({
        id: `presence-left-${uid}-${Date.now()}`,
        roomId,
        userId: "system",
        userName: "System",
        userAvatar: null,
        content: `${leftName ?? "Someone"} left the room`,
        type: "system",
        createdAt: new Date().toISOString(),
      });
    });

    // Someone joined the call — update the visible callers list for everyone.
    // If WE are already in the call, also open a peer connection to them.
    s.on("call-joined", ({ userId: uid, userName }: { userId: string; userName: string }) => {
      // Always update the "who's on a call" banner so non-callers can see it
      setActiveCallers((prev) =>
        prev.find((c) => c.id === uid) ? prev : [...prev, { id: uid, name: userName }]
      );
      if (!localStreamRef.current) return; // we're not in the call ourselves
      if (peersRef.current.has(uid)) return;
      createPeerRef.current(uid, userName, userId < uid);
    });

    // Someone left the call — remove from callers list and tear down peer
    s.on("call-left", ({ userId: uid }: { userId: string }) => {
      setActiveCallers((prev) => prev.filter((c) => c.id !== uid));
      destroyPeerRef.current(uid);
    });

    // Server replies with everyone already in the call when WE join.
    // Update the callers banner AND open peer connections.
    s.on("call-state", ({ callers }: { callers: { id: string; name: string }[] }) => {
      setActiveCallers(callers.filter((c) => c.id !== userId));
      if (!localStreamRef.current) return;
      callers.forEach(({ id: callerId, name: callerName }) => {
        if (callerId === userId) return;
        if (peersRef.current.has(callerId)) return;
        createPeerRef.current(callerId, callerName, userId < callerId);
      });
    });

    // Host changed the video server — mirror it on our end
    s.on("host-action", (action: { type: string; serverIdx?: number }) => {
      if (action.type === "server-change" && action.serverIdx !== undefined) {
        switchToRef.current(action.serverIdx);
      }
    });

    // ── Watch Stream events ──────────────────────────────────────────────────
    // Host started sharing — guests create a non-initiator peer to receive
    s.on("watch-started", ({ hostId }: { hostId: string }) => {
      setHostIsSharing(true);
      if (userId === hostId) return;
      createWatchPeerRef.current(hostId, false);
    });

    // Host stopped sharing
    s.on("watch-stopped", () => {
      setHostIsSharing(false);
      setHostStream(null);
      watchPeersRef.current.forEach((p) => { try { p.destroy(); } catch {} });
      watchPeersRef.current.clear();
    });

    // Server replies with current guests list after host emits watch-start
    s.on("watch-guests", ({ guests }: { guests: { id: string }[] }) => {
      guests.forEach(({ id: guestId }) => {
        if (guestId === userId) return;
        createWatchPeerRef.current(guestId, true);
      });
    });

    // A new guest joined while the host is already sharing — host connects to them
    s.on("watch-guest-joined", ({ userId: guestId }: { userId: string }) => {
      if (!displayStreamRef.current) return;
      createWatchPeerRef.current(guestId, true);
    });

    // WebRTC signal for watch stream
    s.on("watch-signal", ({ from, signal }: { from: string; signal: any }) => {
      let peer = watchPeersRef.current.get(from);
      if (!peer) peer = createWatchPeerRef.current(from, false);
      try { peer.signal(signal); } catch { /* stale signal */ }
    });
    // ────────────────────────────────────────────────────────────────────────

    // WebRTC signaling relay
    s.on("webrtc-signal", ({ from, fromName, signal }: { from: string; fromName: string; signal: any }) => {
      if (!localStreamRef.current) return;
      let conn = peersRef.current.get(from);
      if (!conn) conn = createPeerRef.current(from, fromName, false);
      try { conn.peer.signal(signal); } catch { /* ignore stale signals */ }
    });

    // Connection error — log to console so it's visible in DevTools
    s.on("connect_error", (err) => {
      console.error("[StreamVault] Socket connection error:", err.message);
    });

    return () => {
      s.disconnect();
      socketRef.current = null;
      peersRef.current.forEach((conn) => conn.peer.destroy());
      peersRef.current.clear();
      watchPeersRef.current.forEach((p) => { try { p.destroy(); } catch {} });
      watchPeersRef.current.clear();
      stopWatchShareRef.current();
    };
  // Only re-run when the actual user identity or room changes — not on every callback re-creation
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, roomId, setLocation]);

  // ---------------------------------------------------------------------
  // Chat / Room Actions
  // ---------------------------------------------------------------------
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !socket || !user) return;
    socket.emit("chat-message", {
      roomId,
      userId: user.id,
      userName: user.fullName || user.firstName || "Anonymous",
      userAvatar: user.imageUrl,
      content: chatInput,
      type: "text",
    });
    setChatInput("");
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

  const handleEndRoom = () => {
    if (confirm("End watch party for everyone?")) {
      deleteRoomMutation.mutate({ id: roomId }, { onSuccess: () => setLocation("/rooms") });
    }
  };

  if (loadingRoom) return (
    <div className="flex-1 flex justify-center items-center h-screen">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
  if (!room) return (
    <div className="flex-1 flex justify-center items-center h-screen">Room not found</div>
  );

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-64px)] w-full overflow-hidden bg-background">

      {/* Sync Countdown Overlay */}
      {syncPhase !== null && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-6 select-none">
            {syncPhase === 'counting' ? (
              <>
                <p className="text-white/60 text-xl font-semibold tracking-widest uppercase">Get ready…</p>
                <div
                  key={syncCountdown}
                  className="text-[180px] font-black text-yellow-400 tabular-nums leading-none"
                  style={{ textShadow: "0 0 60px rgba(250,204,21,0.9), 0 0 120px rgba(250,204,21,0.4)", animation: "countdown-pop 0.25s ease-out" }}
                >
                  {syncCountdown}
                </div>
                <p className="text-white/40 text-base uppercase tracking-[0.25em] font-medium">Prepare to press play</p>
              </>
            ) : (
              <>
                <div
                  className="text-8xl font-black text-green-400 uppercase tracking-tight animate-bounce"
                  style={{ textShadow: "0 0 50px rgba(74,222,128,0.9), 0 0 100px rgba(74,222,128,0.4)" }}
                >
                  ▶ PLAY NOW!
                </div>
                <p className="text-white/60 text-lg tracking-wide">Press play on your player</p>
              </>
            )}
          </div>
        </div>
      )}

      <div className="pointer-events-none fixed inset-0 z-[100] overflow-hidden">
        {floatingReactions.map((r) => (
          <div key={r.id} className="absolute bottom-20 text-4xl animate-float-up" style={{ left: `${r.x}%` }}>{r.emoji}</div>
        ))}
      </div>

      {/* Main Video Area */}
      <div ref={playerAreaRef} className="flex-1 flex flex-col relative bg-black border-r border-border/50" onMouseMove={resetHideTimer}>
        <div className="flex-1 relative w-full h-full">
          {/* ── Host: real iframe player ── */}
          {isHost && (
            <>
              {!loaded && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black pointer-events-none">
                  <Loader2 className="w-10 h-10 text-yellow-400 animate-spin" />
                  <p className="text-white/50 text-sm">Loading {server.name}…</p>
                </div>
              )}
              <iframe
                ref={iframeRef}
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
            </>
          )}

          {/* ── Guest: host's live WebRTC stream ── */}
          {!isHost && (
            <div className="absolute inset-0 z-0 flex items-center justify-center bg-black">
              {/* Stream received — show video */}
              <video
                ref={hostStreamVideoRef}
                autoPlay
                playsInline
                className={`w-full h-full object-contain${!hostStream ? ' hidden' : ''}`}
              />
              {/* No stream yet */}
              {!hostStream && (
                <div className="flex flex-col items-center gap-4 text-center px-6">
                  {hostIsSharing ? (
                    <>
                      <Loader2 className="w-8 h-8 text-yellow-400 animate-spin" />
                      <p className="text-white/60 text-sm">Connecting to host's stream…</p>
                    </>
                  ) : (
                    <>
                      <div className="w-20 h-20 rounded-full bg-yellow-400/10 flex items-center justify-center mb-1">
                        <Cast className="w-9 h-9 text-yellow-400/50" />
                      </div>
                      <p className="text-white/80 font-bold text-xl">Waiting for host</p>
                      <p className="text-white/40 text-sm max-w-xs leading-relaxed">
                        {room.hostName} needs to press <span className="text-yellow-400 font-semibold">Go Live</span> to start streaming the video to everyone
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

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

                {/* Host-only controls */}
                {isHost && (
                  <>
                    {!isSharing ? (
                      <button
                        onClick={startWatchShare}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-all pointer-events-auto shadow-lg"
                        title="Share your screen with all guests"
                      >
                        <Cast className="w-3.5 h-3.5" /> Go Live
                      </button>
                    ) : (
                      <button
                        onClick={stopWatchShare}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-700 hover:bg-red-600 text-white text-xs font-bold transition-all pointer-events-auto shadow-lg animate-pulse"
                        title="Stop sharing your screen"
                      >
                        <MonitorOff className="w-3.5 h-3.5" /> Stop Live
                      </button>
                    )}
                    <button
                      onClick={startSyncCountdown}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all pointer-events-auto shadow-lg"
                      title="Start 5s countdown for everyone to press play"
                    >
                      <Timer className="w-3.5 h-3.5" /> Sync Play
                    </button>
                    <button
                      onClick={handleEndRoom}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-bold transition-all pointer-events-auto shadow-lg"
                      title="End the watch party for everyone"
                    >
                      End Room
                    </button>
                  </>
                )}

                {/* Guest: live indicator */}
                {!isHost && hostIsSharing && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-600/30 border border-red-500/40 text-red-300 text-xs font-bold pointer-events-none">
                    <Radio className="w-3 h-3 animate-pulse" /> LIVE
                  </div>
                )}

                <button onClick={() => setShowInfo(true)} className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all flex-shrink-0 pointer-events-auto" title="Player Info">
                  <Info className="w-4 h-4" />
                </button>

                {/* Layout Settings Menu */}
                <div className="relative pointer-events-auto">
                  <button
                    onClick={() => setShowLayoutMenu(!showLayoutMenu)}
                    className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all flex-shrink-0"
                    title="Layout Settings"
                  >
                    <Settings className="w-4 h-4" />
                  </button>

                  {showLayoutMenu && (
                    <div
                      className="absolute top-full right-0 mt-2 w-56 bg-card border border-border rounded-lg shadow-xl p-3 z-50"
                      onClick={(e) => e.stopPropagation()}
                    >
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
                          {(['bottom', 'top', 'right'] as const).map((pos) => (
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

                <button
                  onClick={copyInviteLink}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all pointer-events-auto ${linkCopied ? 'bg-green-500/20 border-green-500/30 text-green-400' : 'bg-white/10 border-white/20 text-white hover:bg-white/20'}`}
                >
                  {linkCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {linkCopied ? "Copied!" : "Invite"}
                </button>

                <button
                  onClick={() => { setLoaded(false); setIframeKey((k) => k + 1); }}
                  className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all flex-shrink-0 pointer-events-auto"
                  title="Reload"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>

                {/* Fullscreen toggle */}
                <button
                  onClick={toggleFullscreen}
                  className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all flex-shrink-0 pointer-events-auto"
                  title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                >
                  {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                </button>

                {/* Sidebar toggle */}
                <button
                  onClick={() => setShowSidebar((v) => !v)}
                  className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all flex-shrink-0 pointer-events-auto"
                  title={showSidebar ? "Hide chat" : "Show chat"}
                >
                  {showSidebar ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          {/* Dynamic Server Selector — host only; guests watch the host's stream */}
          {isHost && selectorVisible && (
            <>
              {selectorPosition === 'bottom' && (
                <div className={`absolute bottom-0 inset-x-0 z-20 transition-opacity duration-300 pointer-events-none ${showBar ? "opacity-100" : "opacity-0"}`}>
                  <div className="bg-gradient-to-t from-black/95 via-black/70 to-transparent px-4 pb-6 pt-10 flex justify-center">
                    <div className="flex flex-col items-center gap-2 pointer-events-auto bg-black/70 p-3 rounded-xl backdrop-blur-md border border-white/10 max-w-2xl w-full shadow-2xl">
                      <div className="flex items-center gap-1.5 text-yellow-400/80 text-xs">
                        <AlertTriangle className="w-3 h-3" />
                        <span>Video not loading? Try a different server</span>
                        {isHost && <span className="text-white/40 ml-1">(synced to all members)</span>}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap justify-center">
                        {SERVERS.map((s, idx) => (
                          <button
                            key={s.id}
                            onClick={() => handleServerSwitch(idx)}
                            className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${idx === serverIdx ? 'bg-yellow-400 text-black border-yellow-400' : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/15'}`}
                          >
                            {s.name}
                          </button>
                        ))}
                        <button
                          onClick={nextServer}
                          className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-white/70 border border-white/10 hover:bg-white/20"
                        >
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
                      {isHost && <span className="text-white/40 ml-1">(synced to all members)</span>}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-center">
                      {SERVERS.map((s, idx) => (
                        <button
                          key={s.id}
                          onClick={() => handleServerSwitch(idx)}
                          className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${idx === serverIdx ? 'bg-yellow-400 text-black border-yellow-400' : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/15'}`}
                        >
                          {s.name}
                        </button>
                      ))}
                      <button
                        onClick={nextServer}
                        className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-white/70 border border-white/10 hover:bg-white/20"
                      >
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
                        <button
                          key={s.id}
                          onClick={() => handleServerSwitch(idx)}
                          className={`w-full px-2 py-1.5 rounded-md text-[11px] font-semibold border transition-all text-center truncate ${idx === serverIdx ? 'bg-yellow-400 text-black border-yellow-400' : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/15'}`}
                        >
                          {s.name}
                        </button>
                      ))}
                      <button
                        onClick={nextServer}
                        className="w-full flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-semibold bg-white/10 text-white/70 border border-white/10 hover:bg-white/20"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Floating Call Panel (Picture-in-Picture) */}
          {inCall && (
            <div className="absolute bottom-24 right-4 z-30 w-[180px] bg-zinc-950/95 backdrop-blur-md rounded-2xl shadow-2xl border border-white/10 flex flex-col overflow-hidden pointer-events-auto">
              {/* Header */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-black/40">
                <span className="text-white text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                  {callType === 'video' ? 'Video' : 'Voice'}
                </span>
                <button
                  onClick={leaveCall}
                  className="p-1 rounded-full hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-colors"
                  title="Leave call"
                >
                  <PhoneOff className="w-3 h-3" />
                </button>
              </div>

              {/* Video tiles — stacked vertically */}
              <div className="flex flex-col divide-y divide-white/5">
                {/* Local tile — always keep <video> mounted when in call so srcObject
                    stays assigned across cam toggle cycles; only hide it with CSS */}
                <div className="relative w-full h-[112px] bg-zinc-900">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    muted
                    playsInline
                    className={`w-full h-full object-cover${callType !== 'video' || !camOn ? ' hidden' : ''}`}
                    style={{ transform: 'scaleX(-1)' }}
                  />
                  {(callType !== 'video' || !camOn) && (
                    <div className="absolute inset-0 flex items-center justify-center bg-primary/10">
                      <div className="w-10 h-10 rounded-full bg-primary/30 flex items-center justify-center text-white text-base font-bold">
                        {user?.firstName?.charAt(0) || 'Y'}
                      </div>
                    </div>
                  )}
                  {/* Name + mic status */}
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5 flex items-center justify-between">
                    <span className="text-white text-[10px] font-semibold">You</span>
                    {!micOn && <MicOff className="w-3 h-3 text-red-400 flex-shrink-0" />}
                  </div>
                </div>

                {/* Remote tiles */}
                {Array.from(peersRef.current.values()).map((conn) => (
                  <div key={conn.peerId} className="relative w-full h-[112px] bg-zinc-900">
                    {conn.stream ? (
                      <RemoteVideoTile stream={conn.stream} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-primary/10">
                        <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-white text-base font-bold border border-white/10">
                          {conn.userName.charAt(0)}
                        </div>
                      </div>
                    )}
                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
                      <span className="text-white text-[10px] font-semibold truncate block">{conn.userName}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Controls */}
              <div className="flex justify-center gap-2 p-2 border-t border-white/10 bg-black/40">
                <button
                  onClick={toggleMic}
                  className={`p-2 rounded-full transition-colors ${micOn ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-red-500 hover:bg-red-600 text-white'}`}
                  title={micOn ? "Mute mic" : "Unmute mic"}
                >
                  {micOn ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
                </button>
                {callType === 'video' && (
                  <button
                    onClick={toggleCam}
                    className={`p-2 rounded-full transition-colors ${camOn ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-red-500 hover:bg-red-600 text-white'}`}
                    title={camOn ? "Turn off camera" : "Turn on camera"}
                  >
                    {camOn ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Info Modal */}
          {showInfo && (
            <div
              className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 pointer-events-auto"
              onClick={() => setShowInfo(false)}
            >
              <div className="bg-card border border-border rounded-xl p-6 max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-lg font-bold text-foreground">About Video Controls</h3>
                  <button onClick={() => setShowInfo(false)} className="text-muted-foreground hover:text-foreground">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {isHost ? (
                  <>
                    <p className="text-sm text-muted-foreground mb-4">
                      You're the host. Only you can see and control the video player. Guests see a blank screen until you start sharing.
                    </p>
                    <p className="text-sm text-muted-foreground mb-4">
                      <strong className="text-foreground">Go Live:</strong> Press the red <strong className="text-foreground">Go Live</strong> button to share your screen with everyone in the room. Pick your current browser tab when the picker appears. Guests will see exactly what you see, in real-time.
                    </p>
                    <p className="text-sm text-muted-foreground mb-4">
                      <strong className="text-foreground">Server switching:</strong> If the video doesn't load, switch servers — your view updates immediately and guests see the new stream automatically.
                    </p>
                    <p className="text-sm text-muted-foreground mb-4">
                      <strong className="text-foreground">Sync Play:</strong> Use this to send a 5-second countdown so everyone presses play at the same time.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground mb-4">
                      You're watching as a guest. The host controls the player — you'll see their stream live once they press <strong className="text-foreground">Go Live</strong>.
                    </p>
                    <p className="text-sm text-muted-foreground mb-4">
                      The stream is sent directly from the host to you via WebRTC — no delay, no buffering. It plays as fast as your connection allows.
                    </p>
                  </>
                )}
                <button
                  onClick={() => setShowInfo(false)}
                  className="w-full py-2 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors"
                >
                  Got it
                </button>
              </div>
            </div>
          )}
          {/* Floating sidebar reopen button — only when sidebar is hidden */}
          {!showSidebar && (
            <button
              onClick={() => setShowSidebar(true)}
              className="absolute bottom-6 right-4 z-30 p-3 rounded-full bg-black/70 hover:bg-black/90 text-white border border-white/20 shadow-2xl backdrop-blur-sm transition-all pointer-events-auto"
              title="Show chat"
            >
              <PanelRightOpen className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Sidebar */}
      {showSidebar && <div className="w-full lg:w-96 flex flex-col bg-card border-l border-border/50 h-full">
        {/* Active call banner — shown when others are on a call and you haven't joined */}
        {activeCallers.length > 0 && !inCall && (
          <div className="mx-3 mt-3 p-3 rounded-xl bg-green-950/60 border border-green-600/40 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse flex-shrink-0" />
              <p className="text-green-300 text-xs font-semibold leading-tight">
                {activeCallers.length === 1
                  ? `${activeCallers[0].name} is on a call`
                  : `${activeCallers.map((c) => c.name).join(", ")} are on a call`}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => joinCall('audio')}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg transition-all"
              >
                <PhoneCall className="w-3 h-3" /> Voice
              </button>
              <button
                onClick={() => joinCall('video')}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-green-600 hover:bg-green-500 text-white text-xs font-bold rounded-lg transition-all"
              >
                <Video className="w-3 h-3" /> Video
              </button>
            </div>
          </div>
        )}

        {/* Call Controls */}
        <div className="px-3 pt-3 pb-2 border-b border-border/50 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            {!inCall ? (
              <>
                <button
                  onClick={() => joinCall('audio')}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-all"
                >
                  <PhoneCall className="w-3.5 h-3.5" /> Voice
                </button>
                <button
                  onClick={() => joinCall('video')}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-green-600 hover:bg-green-500 active:bg-green-700 text-white text-xs font-bold rounded-lg transition-all"
                >
                  <Video className="w-3.5 h-3.5" /> Video
                </button>
              </>
            ) : (
              <div className="flex w-full gap-2">
                <button
                  onClick={toggleMic}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-white text-xs font-bold rounded-lg transition-all ${micOn ? 'bg-white/10 hover:bg-white/20' : 'bg-red-600 hover:bg-red-500'}`}
                  title={micOn ? "Mute mic" : "Unmute mic"}
                >
                  {micOn ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
                </button>
                {callType === 'video' && (
                  <button
                    onClick={toggleCam}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-white text-xs font-bold rounded-lg transition-all ${camOn ? 'bg-white/10 hover:bg-white/20' : 'bg-red-600 hover:bg-red-500'}`}
                    title={camOn ? "Camera off" : "Camera on"}
                  >
                    {camOn ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5" />}
                  </button>
                )}
                <button
                  onClick={leaveCall}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-red-600 hover:bg-red-500 active:bg-red-700 text-white text-xs font-bold rounded-lg transition-all"
                >
                  <PhoneOff className="w-3.5 h-3.5" /> Leave
                </button>
              </div>
            )}
          </div>
          {/* Media access error */}
          {mediaError && (
            <div className="flex items-start gap-2 p-2 rounded-lg bg-red-950/60 border border-red-500/30">
              <MicOff className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-red-300 text-[11px] leading-snug">{mediaError}</p>
              <button
                onClick={() => setMediaError(null)}
                className="ml-auto flex-shrink-0 text-red-400 hover:text-red-200"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
          {/* Sync Play — always visible in sidebar so host can reach it without hovering the video */}
          <div className="flex items-center gap-2">
            {isHost ? (
              <button
                onClick={startSyncCountdown}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-blue-700 hover:bg-blue-600 active:bg-blue-800 text-white text-xs font-bold rounded-lg transition-all"
                title="Sends a 5-second countdown to every participant — everyone presses play at 0"
              >
                <Timer className="w-3.5 h-3.5" /> Sync Play
              </button>
            ) : (
              <div className="flex-1 flex items-center justify-center gap-1.5 py-2 text-muted-foreground/50 text-xs rounded-lg border border-border/20 bg-secondary/10 select-none" title="The host can start a sync countdown">
                <Timer className="w-3.5 h-3.5" /> Sync (host controls)
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border/50">
          <button
            onClick={() => setActiveTab("chat")}
            className={`flex-1 py-3 flex justify-center items-center gap-2 font-medium text-sm transition-colors border-b-2 ${activeTab === "chat" ? "border-primary text-primary bg-secondary/20" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <MessageSquare className="w-4 h-4" /> Chat
          </button>
          <button
            onClick={() => setActiveTab("participants")}
            className={`flex-1 py-3 flex justify-center items-center gap-2 font-medium text-sm transition-colors border-b-2 ${activeTab === "participants" ? "border-primary text-primary bg-secondary/20" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
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
                      {msg.userAvatar
                        ? <img src={msg.userAvatar} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-xs font-bold bg-primary/20 text-primary">{msg.userName.charAt(0)}</div>}
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

            {/* Emoji Reactions */}
            <div className="p-2 border-t border-border/50 bg-secondary/30 flex justify-around">
              {EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => sendReaction(emoji)}
                  className="w-10 h-10 flex items-center justify-center text-xl hover:bg-secondary rounded-full transition-colors active:scale-90"
                >
                  {emoji}
                </button>
              ))}
            </div>

            {/* Message Input */}
            <form onSubmit={handleSendMessage} className="p-4 border-t border-border/50 bg-card">
              <div className="relative">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Type a message…"
                  className="w-full bg-input border border-border rounded-full py-2.5 pl-4 pr-12 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim()}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {/* Current user */}
            <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 flex items-center gap-3">
              <div className="relative w-10 h-10 rounded-full overflow-hidden bg-secondary flex-shrink-0">
                <img src={user?.imageUrl} className="w-full h-full object-cover" alt="You" />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-sm leading-none truncate">{user?.fullName} (You)</p>
                <p className="text-xs text-muted-foreground mt-1">{isHost ? "Host" : "Participant"}</p>
              </div>
            </div>

            {/* Other participants */}
            {participants.map((p) => (
              <div key={p.id} className="p-4 rounded-xl border border-border/50 bg-secondary/30 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-secondary border border-border flex items-center justify-center text-muted-foreground font-bold flex-shrink-0">
                  {p.name.charAt(0)}
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-sm leading-none truncate">{p.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {p.id === room.hostId ? "Host" : "Participant"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>}
    </div>
  );
}

// Handles browser autoplay blocks for remote audio/video
function RemoteVideoTile({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);

  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream;
      const playPromise = ref.current.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          setAudioBlocked(true);
          if (ref.current) {
            ref.current.muted = true;
            ref.current.play().catch(() => {});
          }
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
