import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { io, Socket } from "socket.io-client";
import { 
  useGetRoom, 
  useGetRoomMessages, 
  useDeleteRoom,
  useGetEmbedUrl,
  ChatMessage
} from "@workspace/api-client-react";
import { withAuthGuard } from "../components/layout/withAuthGuard";
import { 
  Loader2, 
  Send, 
  Users, 
  MessageSquare, 
  Heart, 
  ThumbsUp, 
  Laugh, 
  Video, 
  VideoOff, 
  LogOut,
  PlayCircle,
  PauseCircle,
  MonitorPlay
} from "lucide-react";

const EMOJIS = ["😂", "😱", "❤️", "👏", "🔥", "🎬"];

// Keep it simple for this task - mock simple-peer since setting up ICE servers and full signaling
// can be flaky in this environment without specific stun/turn configurations.
// The UI reflects the participants and camera state instead.

function WatchRoomPageContent({ params }: { params: { id: string } }) {
  const roomId = params.id;
  const [, setLocation] = useLocation();
  const { user } = useUser();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [activeTab, setActiveTab] = useState<'chat' | 'participants'>('chat');
  
  // Room state
  const { data: room, isLoading: loadingRoom } = useGetRoom(roomId, {
    query: { enabled: !!roomId }
  });
  const deleteRoomMutation = useDeleteRoom();

  const { data: initialMessages, isLoading: loadingMessages } = useGetRoomMessages(roomId, {
    query: { enabled: !!roomId }
  });

  const { data: embedData } = useGetEmbedUrl({ 
    type: room?.contentType || 'movie', 
    id: room?.contentId || '',
    season: room?.season || undefined,
    episode: room?.episode || undefined,
  }, {
    query: { enabled: !!room }
  });

  // Local state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [participants, setParticipants] = useState<any[]>([]);
  const [floatingReactions, setFloatingReactions] = useState<{id: number, emoji: string, x: number}[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  
  // Host controls mock state
  const [isPlaying, setIsPlaying] = useState(room?.isPlaying || false);
  const isHost = room?.hostId === user?.id;

  useEffect(() => {
    if (initialMessages) {
      setMessages(initialMessages);
    }
  }, [initialMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!user || !roomId) return;

    const s = io({ 
      path: '/ws/socket.io',
      query: { roomId, userId: user.id, userName: user.fullName || user.firstName || 'Anonymous' }
    });

    s.on('connect', () => {
      s.emit('join-room', { 
        roomId, 
        userId: user.id, 
        userName: user.fullName || user.firstName || 'Anonymous'
      });
    });

    s.on('chat-message', (msg: ChatMessage) => {
      setMessages(prev => [...prev, msg]);
    });

    s.on('reaction', ({ emoji, userId, userName }) => {
      const id = Date.now() + Math.random();
      setFloatingReactions(prev => [...prev, { id, emoji, x: Math.random() * 80 + 10 }]);
      setTimeout(() => {
        setFloatingReactions(prev => prev.filter(r => r.id !== id));
      }, 3000);
    });

    s.on('user-joined', ({ userId, userName }) => {
      setParticipants(prev => {
        if (!prev.find(p => p.id === userId)) {
          return [...prev, { id: userId, name: userName, hasVideo: false }];
        }
        return prev;
      });
      // Mock system message
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        roomId,
        userId: 'system',
        userName: 'System',
        userAvatar: null,
        content: `${userName} joined the room`,
        type: 'system',
        createdAt: new Date().toISOString()
      }]);
    });

    s.on('user-left', ({ userId, userName }) => {
      setParticipants(prev => prev.filter(p => p.id !== userId));
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        roomId,
        userId: 'system',
        userName: 'System',
        userAvatar: null,
        content: `${userName} left the room`,
        type: 'system',
        createdAt: new Date().toISOString()
      }]);
    });

    s.on('sync-state', ({ isPlaying: syncPlaying, currentTime }) => {
      if (!isHost) {
        setIsPlaying(syncPlaying);
        // Can't actually seek an iframe reliably without postMessage API specific to provider
      }
    });

    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, [user, roomId, isHost]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !socket || !user) return;
    
    // We emit to socket, server broadcasts back. We can optionally optimistically append.
    socket.emit('chat-message', {
      roomId,
      userId: user.id,
      userName: user.fullName || user.firstName || 'Anonymous',
      userAvatar: user.imageUrl,
      content: chatInput,
      type: 'text'
    });
    
    setChatInput("");
  };

  const sendReaction = (emoji: string) => {
    if (!socket || !user) return;
    socket.emit('reaction', {
      roomId,
      emoji,
      userId: user.id,
      userName: user.fullName || user.firstName || 'Anonymous'
    });
  };

  const handleEndRoom = () => {
    if (confirm("End watch party for everyone?")) {
      deleteRoomMutation.mutate({ id: roomId }, {
        onSuccess: () => setLocation('/rooms')
      });
    }
  };

  const handleTogglePlay = () => {
    if (!isHost || !socket) return;
    const nextState = !isPlaying;
    setIsPlaying(nextState);
    socket.emit('sync-state', { roomId, isPlaying: nextState, currentTime: 0 });
  };

  if (loadingRoom) {
    return <div className="flex-1 flex justify-center items-center h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (!room) {
    return <div className="flex-1 flex justify-center items-center h-screen">Room not found</div>;
  }

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-64px)] w-full overflow-hidden bg-background">
      
      {/* Floating Reactions Overlay */}
      <div className="pointer-events-none fixed inset-0 z-[100] overflow-hidden">
        {floatingReactions.map(r => (
          <div 
            key={r.id}
            className="absolute bottom-20 text-4xl animate-float-up"
            style={{ left: `${r.x}%` }}
          >
            {r.emoji}
          </div>
        ))}
      </div>

      {/* Main Video Area */}
      <div className="flex-1 flex flex-col relative bg-black border-r border-border/50">
        {/* Top Bar Overlay */}
        <div className="absolute top-0 inset-x-0 p-4 bg-gradient-to-b from-black/80 to-transparent z-10 flex justify-between items-start pointer-events-none">
          <div className="pointer-events-auto">
            <h2 className="text-xl font-bold text-white text-shadow-lg drop-shadow-md">{room.name}</h2>
            <p className="text-sm text-white/80 font-medium">Playing: {room.contentTitle}</p>
          </div>
          {isHost && (
            <button 
              onClick={handleEndRoom}
              disabled={deleteRoomMutation.isPending}
              className="pointer-events-auto px-4 py-2 bg-destructive text-destructive-foreground font-bold rounded-lg hover:bg-destructive/90 transition-colors shadow-lg text-sm"
            >
              End Room
            </button>
          )}
        </div>

        {/* Video Player */}
        <div className="flex-1 relative w-full h-full flex items-center justify-center">
          {embedData ? (
            <div className="w-full h-full relative group">
              <iframe 
                ref={iframeRef}
                src={embedData.embedUrl} 
                allowFullScreen 
                className="w-full h-full border-0"
              />
              
              {/* Host Controls Mock Overlay (bottom) */}
              {isHost && (
                <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/90 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4 pointer-events-auto">
                  <button onClick={handleTogglePlay} className="p-2 text-white hover:text-primary transition-colors">
                    {isPlaying ? <PauseCircle className="w-10 h-10" /> : <PlayCircle className="w-10 h-10" />}
                  </button>
                  <div className="flex-1 h-1.5 bg-white/20 rounded-full cursor-pointer overflow-hidden max-w-xl">
                     <div className="h-full bg-primary w-1/3" />
                  </div>
                  <span className="text-white text-sm font-mono">24:15 / 1:45:00</span>
                </div>
              )}
            </div>
          ) : (
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          )}
        </div>
      </div>

      {/* Sidebar */}
      <div className="w-full lg:w-96 flex flex-col bg-card border-l border-border/50 h-full">
        {/* Tabs */}
        <div className="flex border-b border-border/50">
          <button 
            onClick={() => setActiveTab('chat')}
            className={`flex-1 py-3 flex justify-center items-center gap-2 font-medium text-sm transition-colors border-b-2 ${
              activeTab === 'chat' ? 'border-primary text-primary bg-secondary/20' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <MessageSquare className="w-4 h-4" /> Chat
          </button>
          <button 
            onClick={() => setActiveTab('participants')}
            className={`flex-1 py-3 flex justify-center items-center gap-2 font-medium text-sm transition-colors border-b-2 ${
              activeTab === 'participants' ? 'border-primary text-primary bg-secondary/20' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Users className="w-4 h-4" /> Participants
          </button>
        </div>

        {activeTab === 'chat' ? (
          <>
            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg, i) => {
                if (msg.type === 'system') {
                  return (
                    <div key={i} className="text-center">
                      <span className="text-xs font-medium text-muted-foreground bg-secondary/50 px-3 py-1 rounded-full border border-border/50">
                        {msg.content}
                      </span>
                    </div>
                  );
                }

                const isMe = msg.userId === user?.id;
                
                return (
                  <div key={msg.id} className={`flex gap-3 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                    <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 bg-secondary border border-border/50">
                      {msg.userAvatar ? (
                        <img src={msg.userAvatar} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs font-bold bg-primary/20 text-primary">
                          {msg.userName.charAt(0)}
                        </div>
                      )}
                    </div>
                    <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                      <span className="text-xs text-muted-foreground mb-1 px-1">{msg.userName}</span>
                      <div className={`px-4 py-2 rounded-2xl max-w-[240px] text-sm break-words shadow-sm ${
                        isMe 
                          ? 'bg-primary text-primary-foreground rounded-tr-sm' 
                          : 'bg-secondary text-secondary-foreground rounded-tl-sm border border-border/50'
                      }`}>
                        {msg.content}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Reactions */}
            <div className="p-2 border-t border-border/50 bg-secondary/30 flex justify-around">
              {EMOJIS.map(emoji => (
                <button 
                  key={emoji}
                  onClick={() => sendReaction(emoji)}
                  className="w-10 h-10 flex items-center justify-center text-xl hover:bg-secondary rounded-full transition-colors active:scale-90"
                >
                  {emoji}
                </button>
              ))}
            </div>

            {/* Chat Input */}
            <form onSubmit={handleSendMessage} className="p-4 border-t border-border/50 bg-card">
              <div className="relative">
                <input 
                  type="text" 
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  placeholder="Type a message..."
                  className="w-full bg-input border border-border rounded-full py-2.5 pl-4 pr-12 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                />
                <button 
                  type="submit"
                  disabled={!chatInput.trim()}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:hover:bg-primary"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
             {/* Self */}
             <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <img src={user?.imageUrl} className="w-10 h-10 rounded-full border-2 border-primary" alt="You" />
                    <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-background" />
                  </div>
                  <div>
                    <p className="font-bold text-sm leading-none">{user?.fullName} (You)</p>
                    <p className="text-xs text-muted-foreground mt-1">{isHost ? 'Host' : 'Participant'}</p>
                  </div>
                </div>
                <button className="p-2 rounded-full bg-secondary text-foreground hover:bg-secondary/80">
                  <Video className="w-4 h-4" />
                </button>
             </div>

             {/* Others */}
             {participants.map(p => (
               <div key={p.id} className="p-4 rounded-xl border border-border/50 bg-secondary/30 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="w-10 h-10 rounded-full bg-secondary border border-border flex items-center justify-center text-muted-foreground font-bold">
                        {p.name.charAt(0)}
                      </div>
                      <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-background" />
                    </div>
                    <div>
                      <p className="font-bold text-sm leading-none">{p.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">{p.id === room.hostId ? 'Host' : 'Participant'}</p>
                    </div>
                  </div>
                  {p.hasVideo ? (
                    <Video className="w-4 h-4 text-primary" />
                  ) : (
                    <VideoOff className="w-4 h-4 text-muted-foreground" />
                  )}
               </div>
             ))}

             <div className="mt-8 text-center px-4">
                <div className="inline-block p-3 rounded-full bg-secondary mb-3">
                   <VideoOff className="w-6 h-6 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">WebRTC video tiles would appear here.</p>
             </div>
          </div>
        )}
      </div>

    </div>
  );
}

export default withAuthGuard(WatchRoomPageContent);