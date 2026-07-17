import { useState, useCallback, useRef, useEffect } from "react";
import { X, RefreshCw, ChevronRight, Loader2, AlertTriangle, ChevronLeft } from "lucide-react";
import { SERVERS, proxyEmbedUrl, type ContentType } from "../lib/servers";

export type { ContentType };

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
  const embedUrl = proxyEmbedUrl(server.getRawUrl(type, id, season, episode));

  const switchTo = useCallback((idx: number) => {
    setLoaded(false);
    setServerIdx(idx);
    setIframeKey((k) => k + 1);
    setShowBar(true);
  }, []);

  // Auto-advance when the proxy reports server-unavailable
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.__sv_error && e.data?.event === "server-unavailable") {
        switchTo((serverIdx + 1) % SERVERS.length);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [serverIdx, switchTo]);

  const resetHideTimer = useCallback(() => {
    setShowBar(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowBar(false), 4000);
  }, []);

  useEffect(() => {
    resetHideTimer();
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [serverIdx, resetHideTimer]);

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col" onMouseMove={resetHideTimer}>
      {/* Top bar */}
      <div className={`absolute top-0 left-0 right-0 z-20 transition-opacity duration-300 ${showBar ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        <div className="bg-gradient-to-b from-black/95 via-black/60 to-transparent px-4 pt-3 pb-8 flex items-center gap-3">
          <button onClick={onClose} className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
          {label && <span className="text-white/80 text-sm font-medium truncate flex-1 min-w-0">{label}</span>}
          <button onClick={() => { setLoaded(false); setIframeKey((k) => k + 1); }} className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all flex-shrink-0" title="Reload">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Loading overlay */}
      {!loaded && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black pointer-events-none">
          <Loader2 className="w-10 h-10 text-yellow-400 animate-spin" />
          <p className="text-white/50 text-sm">Loading {server.name}…</p>
        </div>
      )}

      {/* iframe */}
      <iframe
        key={iframeKey}
        src={embedUrl}
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
        referrerPolicy="no-referrer"
        className="w-full h-full border-0"
        title="Player"
        onLoad={() => setLoaded(true)}
      />

      {/* Bottom server bar */}
      <div className={`absolute bottom-0 left-0 right-0 z-20 transition-opacity duration-300 ${showBar ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        <div className="bg-gradient-to-t from-black/95 via-black/70 to-transparent px-4 pb-4 pt-10">
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-1.5 text-yellow-400/80 text-xs">
              <AlertTriangle className="w-3 h-3" />
              <span>Video not loading? Try a different server</span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap justify-center">
              <button onClick={() => switchTo((serverIdx - 1 + SERVERS.length) % SERVERS.length)} className="p-1.5 rounded-full bg-white/10 text-white/60 hover:bg-white/20 hover:text-white transition-all">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              {SERVERS.map((s, idx) => (
                <button
                  key={s.id}
                  onClick={() => switchTo(idx)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                    idx === serverIdx
                      ? "bg-yellow-400 text-black border-yellow-400 shadow-lg"
                      : "bg-white/5 text-white/70 border-white/10 hover:bg-white/15 hover:text-white"
                  }`}
                >
                  {s.name}
                </button>
              ))}
              <button onClick={() => switchTo((serverIdx + 1) % SERVERS.length)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-semibold bg-white/10 text-white/70 border border-white/10 hover:bg-white/20 hover:text-white transition-all">
                Next <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
