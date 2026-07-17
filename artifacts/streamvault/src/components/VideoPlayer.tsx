import { useState, useCallback, useRef, useEffect } from "react";
import { X, RefreshCw, ChevronRight, Loader2, AlertTriangle } from "lucide-react";

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

interface VideoPlayerProps {
  type: ContentType;
  id: string;
  season?: number;
  episode?: number;
  label?: string;
  onClose: () => void;
}

export function VideoPlayer({ type, id, season, episode, label, onClose }: VideoPlayerProps) {
  const [serverIdx, setServerIdx] = useState(0);
  const [iframeKey, setIframeKey] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [showBar, setShowBar] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const server = SERVERS[serverIdx];
  const embedUrl = server.getUrl(type, id, season, episode);

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
  }, [serverIdx]);

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col" onMouseMove={resetHideTimer}>
      <div className={`absolute top-0 left-0 right-0 z-20 transition-opacity duration-300 ${showBar ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        <div className="bg-gradient-to-b from-black/95 via-black/60 to-transparent px-4 pt-3 pb-8">
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all flex-shrink-0"><X className="w-4 h-4" /></button>
            {label && <span className="text-white/80 text-sm font-medium truncate flex-1 min-w-0">{label}</span>}
            <button onClick={() => { setLoaded(false); setIframeKey((k) => k + 1); }} className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all flex-shrink-0" title="Reload"><RefreshCw className="w-4 h-4" /></button>
          </div>
        </div>
      </div>

      {!loaded && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black pointer-events-none">
          <Loader2 className="w-10 h-10 text-yellow-400 animate-spin" />
          <p className="text-white/50 text-sm">Loading {server.name}…</p>
        </div>
      )}

      {/* 🛡️ Strict sandbox traps ads inside the iframe, blocking popups and redirects */}
      <iframe
        key={iframeKey}
        src={embedUrl}
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
        allowFullScreen
        referrerPolicy="no-referrer"
        className="w-full h-full border-0"
        title="Player"
        onLoad={() => setLoaded(true)}
      />

      <div className={`absolute bottom-0 left-0 right-0 z-20 transition-opacity duration-300 ${showBar ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        <div className="bg-gradient-to-t from-black/95 via-black/70 to-transparent px-4 pb-4 pt-10">
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-1.5 text-yellow-400/80 text-xs">
              <AlertTriangle className="w-3 h-3" />
              <span>Video not loading? Try a different server</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-center">
              {SERVERS.map((s, idx) => (
                <button key={s.id} onClick={() => switchTo(idx)} className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition-all ${idx === serverIdx ? "bg-yellow-400 text-black border-yellow-400 shadow-lg shadow-yellow-400/20" : "bg-white/5 text-white/70 border-white/10 hover:bg-white/15 hover:text-white hover:border-white/30"}`}>
                  {s.name}
                </button>
              ))}
              <button onClick={nextServer} className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-white/10 text-white/70 border border-white/10 hover:bg-white/20 hover:text-white transition-all">
                Next <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}