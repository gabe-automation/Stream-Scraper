import { Link } from "wouter";
import { Star, Play, Tv, Film } from "lucide-react";
import { ContentItem } from "@workspace/api-client-react";

export function ContentCard({ item, rank }: { item: ContentItem; rank?: number }) {
  const posterUrl = item.posterPath
    ? `https://image.tmdb.org/t/p/w342${item.posterPath}`
    : null;
  const rating = item.rating > 0 ? item.rating.toFixed(1) : null;
  const year = item.releaseDate ? new Date(item.releaseDate).getFullYear() : null;

  return (
    <Link
      href={`/${item.type}/${item.id}`}
      className="group relative flex-shrink-0 w-36 sm:w-44 md:w-48 aspect-[2/3] rounded-xl overflow-hidden bg-secondary border border-white/5 transition-all duration-300 hover:scale-105 hover:z-10 hover:shadow-2xl hover:shadow-black/60 hover:border-white/20 focus:outline-none focus:ring-2 focus:ring-primary"
    >
      {/* Poster */}
      {posterUrl ? (
        <img
          src={posterUrl}
          alt={item.title}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center bg-secondary/80 text-muted-foreground p-4 text-center gap-2">
          {item.type === "tv" ? <Tv className="w-8 h-8 opacity-40" /> : <Film className="w-8 h-8 opacity-40" />}
          <span className="text-xs font-medium line-clamp-3">{item.title}</span>
        </div>
      )}

      {/* Rank badge */}
      {rank !== undefined && (
        <div className="absolute top-0 left-0 w-10 h-14 flex items-end justify-center pb-1">
          <span className="text-4xl font-black text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] leading-none" style={{ WebkitTextStroke: "1px rgba(0,0,0,0.5)" }}>
            {rank}
          </span>
        </div>
      )}

      {/* Type pill */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <span className="px-1.5 py-0.5 text-[10px] font-bold bg-black/70 backdrop-blur-sm text-white/80 rounded uppercase tracking-wider border border-white/10">
          {item.type === "tv" ? "Series" : "Film"}
        </span>
      </div>

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3">
        <h4 className="text-white font-bold text-sm leading-tight mb-1 line-clamp-2">{item.title}</h4>
        <div className="flex items-center justify-between text-xs text-white/60">
          {year && <span>{year}</span>}
          {rating && (
            <span className="flex items-center gap-0.5 text-primary font-semibold">
              <Star className="w-3 h-3 fill-current" />
              {rating}
            </span>
          )}
        </div>
      </div>

      {/* Play button */}
      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 scale-50 group-hover:scale-100">
        <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm border border-white/30 flex items-center justify-center shadow-xl">
          <Play className="w-5 h-5 text-white fill-white ml-0.5" />
        </div>
      </div>
    </Link>
  );
}

export function ContentRow({
  title,
  items,
  isLoading,
  showRank,
}: {
  title: string;
  items?: ContentItem[];
  isLoading?: boolean;
  showRank?: boolean;
}) {
  if (isLoading) {
    return (
      <div className="py-4">
        <div className="flex items-center justify-between px-4 lg:px-8 mb-4">
          <h3 className="text-lg font-bold text-white/90 tracking-tight">{title}</h3>
        </div>
        <div className="flex gap-3 overflow-x-hidden px-4 lg:px-8">
          {[1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="flex-shrink-0 w-36 sm:w-44 md:w-48 aspect-[2/3] rounded-xl bg-white/5 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!items || items.length === 0) return null;

  return (
    <div className="py-4">
      <div className="flex items-center justify-between px-4 lg:px-8 mb-4">
        <h3 className="text-lg font-bold text-white/90 tracking-tight">{title}</h3>
        <span className="text-xs text-white/30 font-medium">{items.length} titles</span>
      </div>
      <div
        className="flex gap-3 overflow-x-auto px-4 lg:px-8 pb-3 scrollbar-hide snap-x snap-mandatory"
        style={{ maskImage: "linear-gradient(to right, transparent 0%, black 2%, black 95%, transparent 100%)" }}
      >
        {items.map((item, idx) => (
          <div key={item.id} className="snap-start scroll-ml-4 lg:scroll-ml-8">
            <ContentCard item={item} rank={showRank ? idx + 1 : undefined} />
          </div>
        ))}
      </div>
    </div>
  );
}
