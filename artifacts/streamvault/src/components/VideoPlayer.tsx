import { useState, useCallback } from "react";
import { X, ServerCrash, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";

// ─── Server definitions ───────────────────────────────────────────────────────

export type ContentType = "movie" | "tv";

interface ServerDef {
  id: string;
  name: string;
  getUrl: (
    type: ContentType,
    id: string,
    season?: number,
    episode?: number,
  ) => string;
}

const SERVERS: ServerDef[] = [
  {
    id: "vidsrc",
    name: "Server 1",
    getUrl: (type, id, season, episode) =>
      type === "movie"
        ? `https://vidsrc.to/embed/movie/${id}`
        : `https://vidsrc.to/embed/tv/${id}/${season}/${episode}`,
  },
  {
    id: "vidsrcme",
    name: "Server 2",
    getUrl: (type, id, season, episode) =>
      type === "movie"
        ? `https://vidsrc.me/embed/movie?tmdb=${id}`
        : `https://vidsrc.me/embed/tv?tmdb=${id}&season=${season}&episode=${episode}`,
  },
  {
    id: "2embed",
    name: "Server 3",
    getUrl: (type, id, season, episode) =>
      type === "movie"
        ? `https://www.2embed.cc/embed/${id}`
        : `https://www.2embed.cc/embedtv/${id}&s=${season}&e=${episode}`,
  },
  {
    id: "vidsrcpro",
    name: "Server 4",
    getUrl: (type, id, season, episode) =>
      type === "movie"
        ? `https://vidsrc.pro/embed/movie/${id}`
        : `https://vidsrc.pro/embed/tv/${id}/${season}/${episode}`,
  },
  {
    id: "embedsu",
    name: "Server 5",
    getUrl: (type, id, season, episode) =>
      type === "movie"
        ? `https://embed.su/embed/movie/${id}`
        : `https://embed.su/embed/tv/${id}/${season}/${episode}`,
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

interface VideoPlayerProps {
  type: ContentType;
  id: string;
  season?: number;
  episode?: number;
  label?: string;
  onClose: () => void;
}

export function VideoPlayer({
  type,
  id,
  season,
  episode,
  label,
  onClose,
}: VideoPlayerProps) {
  const [serverIdx, setServerIdx] = useState(0);
  const [iframeKey, setIframeKey] = useState(0); // force reload when server changes

  const currentServer = SERVERS[serverIdx];
  const embedUrl = currentServer.getUrl(type, id, season, episode);

  const switchServer = useCallback(
    (idx: number) => {
      if (idx === serverIdx) {
        // Same server — force reload
        setIframeKey((k) => k + 1);
      } else {
        setServerIdx(idx);
        setIframeKey((k) => k + 1);
      }
    },
    [serverIdx],
  );

  const prevServer = () =>
    switchServer((serverIdx - 1 + SERVERS.length) % SERVERS.length);
  const nextServer = () => switchServer((serverIdx + 1) % SERVERS.length);

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/80 to-transparent">
        {/* Left: label */}
        <div className="flex items-center gap-3">
          {label && (
            <span className="text-white/70 text-sm font-medium">{label}</span>
          )}
        </div>

        {/* Centre: server selector */}
        <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-md border border-white/10 rounded-full px-2 py-1">
          <button
            onClick={prevServer}
            className="p-1 text-white/50 hover:text-white transition-colors"
            title="Previous server"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          {SERVERS.map((s, idx) => (
            <button
              key={s.id}
              onClick={() => switchServer(idx)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                idx === serverIdx
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-white/50 hover:text-white hover:bg-white/10"
              }`}
            >
              {s.name}
            </button>
          ))}
          <button
            onClick={nextServer}
            className="p-1 text-white/50 hover:text-white transition-colors"
            title="Next server"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right: reload + close */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIframeKey((k) => k + 1)}
            className="p-2 text-white/60 hover:text-white bg-black/40 hover:bg-black/70 rounded-full transition-all border border-white/10"
            title="Reload"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-2 text-white/60 hover:text-white bg-black/40 hover:bg-black/70 rounded-full transition-all border border-white/10"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* iframe — sandbox blocks popup ads */}
      <iframe
        key={iframeKey}
        src={embedUrl}
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
        referrerPolicy="origin"
        // sandbox blocks window.open() ad popups while keeping scripts/playback
        sandbox="allow-scripts allow-same-origin allow-forms allow-presentation allow-pointer-lock allow-autoplay"
        className="w-full h-full border-0"
        title="Player"
      />

      {/* Bottom hint */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/30 text-xs flex items-center gap-1.5 pointer-events-none">
        <ServerCrash className="w-3 h-3" />
        If this server doesn't work, try another server above
      </div>
    </div>
  );
}
