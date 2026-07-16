import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Search, Loader2, Play, Info, X, TrendingUp, Tv, Film } from "lucide-react";
import {
  useGetTrending,
  useGetPopular,
  useSearchContent,
  ContentItem,
} from "@workspace/api-client-react";
import { withAuthGuard } from "../components/layout/withAuthGuard";
import { ContentCard, ContentRow } from "../components/ContentCard";
import { useDebounce } from "../hooks/use-debounce";

// ─── Hero Carousel ────────────────────────────────────────────────────────────

function HeroCarousel({ items, isLoading }: { items?: ContentItem[]; isLoading?: boolean }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    if (!items || items.length === 0) return;
    const interval = setInterval(() => {
      setTransitioning(true);
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % Math.min(items.length, 6));
        setTransitioning(false);
      }, 400);
    }, 9000);
    return () => clearInterval(interval);
  }, [items]);

  if (isLoading) {
    return (
      <div className="relative w-full h-[70vh] bg-black overflow-hidden">
        <div className="w-full h-full bg-white/5 animate-pulse" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent" />
      </div>
    );
  }

  if (!items || items.length === 0) return null;

  const item = items[currentIndex];
  const backdropUrl = item.backdropPath
    ? `https://image.tmdb.org/t/p/original${item.backdropPath}`
    : null;
  const posterUrl = item.posterPath
    ? `https://image.tmdb.org/t/p/w500${item.posterPath}`
    : null;

  return (
    <div className="relative w-full h-[70vh] bg-black overflow-hidden select-none">
      {/* Backdrop */}
      {backdropUrl && (
        <img
          key={item.id}
          src={backdropUrl}
          alt={item.title}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${
            transitioning ? "opacity-0" : "opacity-50"
          }`}
        />
      )}

      {/* Gradient overlays */}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/40 to-transparent" />

      {/* Content */}
      <div
        className={`absolute bottom-0 left-0 px-6 md:px-12 lg:px-16 pb-16 w-full md:w-3/5 lg:w-1/2 transition-all duration-500 ${
          transitioning ? "opacity-0 translate-y-2" : "opacity-100 translate-y-0"
        }`}
      >
        {/* Meta row */}
        <div className="flex items-center gap-3 mb-4">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/20 border border-primary/40 text-primary text-xs font-bold uppercase tracking-widest">
            <TrendingUp className="w-3 h-3" />
            Trending
          </span>
          <span className="text-white/50 text-sm font-medium">
            {item.type === "tv" ? "Series" : "Film"}
          </span>
          {item.rating > 0 && (
            <span className="text-primary font-bold text-sm">
              ★ {item.rating.toFixed(1)}
            </span>
          )}
        </div>

        {/* Title */}
        <h2 className="text-4xl md:text-6xl font-black tracking-tight text-white mb-3 leading-[1.05]">
          {item.title}
        </h2>

        {/* Overview */}
        <p className="text-white/60 text-sm md:text-base leading-relaxed line-clamp-3 mb-7 max-w-lg">
          {item.overview}
        </p>

        {/* Actions */}
        <div className="flex gap-3">
          <Link
            href={`/${item.type}/${item.id}`}
            className="inline-flex items-center gap-2 px-7 py-3 bg-white text-black font-bold rounded-lg hover:bg-white/90 transition-all shadow-lg hover:shadow-white/20 hover:scale-105 active:scale-95 text-sm"
          >
            <Play className="w-4 h-4 fill-black" />
            Watch Now
          </Link>
          <Link
            href={`/${item.type}/${item.id}`}
            className="inline-flex items-center gap-2 px-7 py-3 bg-white/10 backdrop-blur-md text-white font-bold rounded-lg hover:bg-white/20 transition-all border border-white/20 text-sm"
          >
            <Info className="w-4 h-4" />
            More Info
          </Link>
        </div>
      </div>

      {/* Poster (desktop) */}
      {posterUrl && (
        <div
          className={`hidden lg:block absolute right-16 bottom-12 w-48 rounded-xl overflow-hidden shadow-2xl shadow-black/60 border border-white/10 transition-all duration-500 ${
            transitioning ? "opacity-0 translate-y-4" : "opacity-100 translate-y-0"
          }`}
        >
          <img src={posterUrl} alt={item.title} className="w-full h-auto" />
        </div>
      )}

      {/* Dot indicators */}
      <div className="absolute bottom-6 left-6 md:left-12 lg:left-16 flex gap-2">
        {items.slice(0, 6).map((_, idx) => (
          <button
            key={idx}
            onClick={() => {
              setTransitioning(true);
              setTimeout(() => {
                setCurrentIndex(idx);
                setTransitioning(false);
              }, 200);
            }}
            className={`h-1 rounded-full transition-all duration-300 ${
              idx === currentIndex ? "w-8 bg-primary" : "w-2 bg-white/25 hover:bg-white/50"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Category Filter ──────────────────────────────────────────────────────────

type FilterTab = "all" | "movie" | "tv";

const filterTabs: { id: FilterTab; label: string; icon: React.ReactNode }[] = [
  { id: "all", label: "All", icon: <TrendingUp className="w-3.5 h-3.5" /> },
  { id: "movie", label: "Movies", icon: <Film className="w-3.5 h-3.5" /> },
  { id: "tv", label: "TV Shows", icon: <Tv className="w-3.5 h-3.5" /> },
];

// ─── Main Page ────────────────────────────────────────────────────────────────

function BrowsePageContent() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterTab>("all");
  const debouncedQuery = useDebounce(query, 400);

  const { data: trendingAll, isLoading: loadingTrendingAll } = useGetTrending({ type: "all" });
  const { data: trendingMovies, isLoading: loadingTrendingMovies } = useGetTrending({ type: "movie" });
  const { data: trendingTv, isLoading: loadingTrendingTv } = useGetTrending({ type: "tv" });
  const { data: popularMovies, isLoading: loadingPopularMovies } = useGetPopular({ type: "movie" });
  const { data: popularTv, isLoading: loadingPopularTv } = useGetPopular({ type: "tv" });

  const { data: searchResults, isLoading: loadingSearch, isFetching: isFetchingSearch } =
    useSearchContent(
      { q: debouncedQuery, type: filter === "all" ? "all" : filter },
      { query: { enabled: debouncedQuery.length > 1 } },
    );

  const isSearching = debouncedQuery.length > 1;

  // Filter helper for the content rows
  const showMovies = filter === "all" || filter === "movie";
  const showTv = filter === "all" || filter === "tv";

  return (
    <div className="flex flex-col w-full pb-24">
      {/* Sticky header: search + filter */}
      <div className="sticky top-16 z-40 bg-background/95 backdrop-blur-md border-b border-white/5">
        {/* Search bar */}
        <div className="px-4 lg:px-8 pt-4 pb-3">
          <div className="relative max-w-xl mx-auto lg:mx-0">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
            <input
              type="text"
              placeholder="Search movies, series..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-full py-2.5 pl-11 pr-10 text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-primary/60 focus:border-primary/40 transition-all text-sm"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-white/30 hover:text-white/60 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            {isFetchingSearch && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary animate-spin" />
            )}
          </div>
        </div>

        {/* Filter tabs */}
        {!isSearching && (
          <div className="flex gap-1 px-4 lg:px-8 pb-3">
            {filterTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id)}
                className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  filter === tab.id
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/30"
                    : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80 border border-white/10"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Search results ── */}
      {isSearching ? (
        <div className="px-4 lg:px-8 py-8">
          <h2 className="text-xl font-bold text-white/80 mb-6">
            Results for <span className="text-white">"{debouncedQuery}"</span>
          </h2>
          {loadingSearch ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
          ) : searchResults?.results && searchResults.results.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 lg:gap-4">
              {searchResults.results.map((item) => (
                <ContentCard key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-24 text-white/30">
              <Search className="w-12 h-12 mb-4 opacity-30" />
              <p className="text-lg font-medium">No results found</p>
              <p className="text-sm mt-1">Try a different title</p>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Hero only on "all" tab */}
          {filter === "all" && (
            <HeroCarousel items={trendingAll} isLoading={loadingTrendingAll} />
          )}

          <div className={`mt-6 space-y-2 ${filter !== "all" ? "pt-4" : ""}`}>
            {showMovies && (
              <>
                <ContentRow
                  title="🔥 Top 10 Movies This Week"
                  items={trendingMovies?.slice(0, 10)}
                  isLoading={loadingTrendingMovies}
                  showRank
                />
                <ContentRow
                  title="Popular Movies"
                  items={popularMovies}
                  isLoading={loadingPopularMovies}
                />
              </>
            )}
            {showTv && (
              <>
                <ContentRow
                  title="🔥 Top 10 TV Shows This Week"
                  items={trendingTv?.slice(0, 10)}
                  isLoading={loadingTrendingTv}
                  showRank
                />
                <ContentRow
                  title="Popular Series"
                  items={popularTv}
                  isLoading={loadingPopularTv}
                />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default withAuthGuard(BrowsePageContent);
