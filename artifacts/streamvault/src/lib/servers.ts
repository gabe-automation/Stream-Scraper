export type ContentType = "movie" | "tv";

export interface ServerDef {
  id: string;
  name: string;
  getRawUrl: (
    type: ContentType,
    id: string,
    season?: number,
    episode?: number,
  ) => string;
}

export const SERVERS: ServerDef[] = [
  {
    id: "vidsrc",
    name: "VidSrc",
    getRawUrl: (t, id, s, e) =>
      t === "movie"
        ? `https://vidsrc.to/embed/movie/${id}`
        : `https://vidsrc.to/embed/tv/${id}/${s}/${e}`,
  },
  {
    id: "vidsrcme",
    name: "VidSrc.me",
    getRawUrl: (t, id, s, e) =>
      t === "movie"
        ? `https://vidsrc.me/embed/movie?tmdb=${id}`
        : `https://vidsrc.me/embed/tv?tmdb=${id}&season=${s}&episode=${e}`,
  },
  {
    id: "autoembed",
    name: "AutoEmbed",
    getRawUrl: (t, id, s, e) =>
      t === "movie"
        ? `https://autoembed.cc/movie/tmdb/${id}`
        : `https://autoembed.cc/tv/tmdb/${id}-${s}-${e}`,
  },
  {
    id: "multiembed",
    name: "MultiEmbed",
    getRawUrl: (t, id, s, e) =>
      t === "movie"
        ? `https://multiembed.mov/?video_id=${id}&tmdb=1`
        : `https://multiembed.mov/?video_id=${id}&tmdb=1&s=${s}&e=${e}`,
  },
  {
    id: "embedsu",
    name: "Embed.su",
    getRawUrl: (t, id, s, e) =>
      t === "movie"
        ? `https://embed.su/embed/movie/${id}`
        : `https://embed.su/embed/tv/${id}/${s}/${e}`,
  },
  {
    id: "vidsrc-icu",
    name: "VidSrc.icu",
    getRawUrl: (t, id, s, e) =>
      t === "movie"
        ? `https://vidsrc.icu/embed/movie/${id}`
        : `https://vidsrc.icu/embed/tv/${id}/${s}/${e}`,
  },
  {
    id: "2embed",
    name: "2Embed",
    getRawUrl: (t, id, s, e) =>
      t === "movie"
        ? `https://www.2embed.cc/embed/${id}`
        : `https://www.2embed.cc/embedtv/${id}&s=${s}&e=${e}`,
  },
  {
    id: "rive",
    name: "Rive",
    getRawUrl: (t, id, s, e) =>
      t === "movie"
        ? `https://rive.stream/embed/movie/${id}`
        : `https://rive.stream/embed/tv/${id}/${s}/${e}`,
  },
  {
    id: "smashystream",
    name: "Smashy",
    getRawUrl: (t, id, s, e) =>
      t === "movie"
        ? `https://embed.smashystream.com/playere.php?tmdb=${id}`
        : `https://embed.smashystream.com/playere.php?tmdb=${id}&season=${s}&episode=${e}`,
  },
];

/** Wrap an embed URL through our server-side ad-stripping proxy */
export function proxyEmbedUrl(raw: string): string {
  return `/api/proxy/embed?url=${encodeURIComponent(raw)}`;
}
