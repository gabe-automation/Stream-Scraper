import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Search, Loader2, PlayCircle, Info } from "lucide-react";
import { 
  useGetTrending, 
  useGetPopular, 
  useSearchContent,
  ContentItem 
} from "@workspace/api-client-react";
import { withAuthGuard } from "../components/layout/withAuthGuard";
import { ContentCard, ContentRow } from "../components/ContentCard";
import { useDebounce } from "../hooks/use-debounce";

function HeroCarousel({ items, isLoading }: { items?: ContentItem[]; isLoading?: boolean }) {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!items || items.length === 0) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % Math.min(items.length, 5));
    }, 8000);
    return () => clearInterval(interval);
  }, [items]);

  if (isLoading) {
    return <div className="w-full aspect-video md:aspect-[21/9] bg-secondary/30 animate-pulse" />;
  }

  if (!items || items.length === 0) return null;

  const item = items[currentIndex];
  const backdropUrl = item.backdropPath ? `https://image.tmdb.org/t/p/w1280${item.backdropPath}` : '';

  return (
    <div className="relative w-full aspect-[4/3] md:aspect-[21/9] bg-black overflow-hidden group">
      {backdropUrl && (
        <img 
          key={item.id}
          src={backdropUrl} 
          alt={item.title} 
          className="w-full h-full object-cover opacity-60 transition-transform duration-10000 ease-linear scale-105 group-hover:scale-110" 
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/60 to-transparent" />
      
      <div className="absolute bottom-0 left-0 p-6 md:p-12 lg:px-16 w-full md:w-2/3 flex flex-col justify-end">
        <div className="flex items-center gap-2 mb-3">
          <span className="px-2 py-0.5 text-xs font-bold bg-primary text-primary-foreground rounded uppercase tracking-wider">
            Trending {item.type === 'tv' ? 'TV' : 'Movie'}
          </span>
          <span className="text-primary font-bold">★ {item.rating.toFixed(1)}</span>
        </div>
        <h2 className="text-3xl md:text-5xl font-bold tracking-tighter text-foreground mb-4 text-shadow-lg leading-tight">
          {item.title}
        </h2>
        <p className="text-muted-foreground text-sm md:text-base line-clamp-3 mb-6 max-w-xl text-shadow">
          {item.overview}
        </p>
        <div className="flex gap-3">
          <Link href={`/${item.type}/${item.id}`} className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-foreground text-background font-bold rounded-lg hover:bg-foreground/90 transition-colors">
            <PlayCircle className="w-5 h-5" />
            Watch Now
          </Link>
          <Link href={`/${item.type}/${item.id}`} className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-secondary/80 backdrop-blur-md text-foreground font-bold rounded-lg hover:bg-secondary transition-colors border border-border/50">
            <Info className="w-5 h-5" />
            More Info
          </Link>
        </div>
      </div>
      
      {/* Dots */}
      <div className="absolute bottom-6 right-6 md:right-12 flex gap-2">
        {items.slice(0, 5).map((_, idx) => (
          <button 
            key={idx} 
            onClick={() => setCurrentIndex(idx)}
            className={`w-2 h-2 rounded-full transition-all ${idx === currentIndex ? 'bg-primary w-6' : 'bg-white/30 hover:bg-white/50'}`}
          />
        ))}
      </div>
    </div>
  );
}

function BrowsePageContent() {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 500);

  // Queries
  const { data: trendingAll, isLoading: loadingTrendingAll } = useGetTrending({ type: 'all' });
  const { data: trendingMovies, isLoading: loadingTrendingMovies } = useGetTrending({ type: 'movie' });
  const { data: trendingTv, isLoading: loadingTrendingTv } = useGetTrending({ type: 'tv' });
  const { data: popularMovies, isLoading: loadingPopularMovies } = useGetPopular({ type: 'movie' });
  const { data: popularTv, isLoading: loadingPopularTv } = useGetPopular({ type: 'tv' });

  const { data: searchResults, isLoading: loadingSearch, isFetching: isFetchingSearch } = useSearchContent({ q: debouncedQuery, type: 'all' }, {
    query: { enabled: debouncedQuery.length > 2 }
  });

  const isSearching = debouncedQuery.length > 2;

  return (
    <div className="flex flex-col w-full pb-20">
      {/* Search Header */}
      <div className="sticky top-16 z-40 bg-background/95 backdrop-blur-md border-b border-border/50 p-4 lg:px-8">
        <div className="relative max-w-2xl mx-auto">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <input 
            type="text" 
            placeholder="Search movies, TV shows..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-input/50 border border-border rounded-full py-3 pl-12 pr-4 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
          />
          {isFetchingSearch && (
            <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-primary animate-spin" />
          )}
        </div>
      </div>

      {isSearching ? (
        <div className="container mx-auto px-4 lg:px-8 py-8">
          <h2 className="text-2xl font-bold mb-6">Search Results for "{debouncedQuery}"</h2>
          {loadingSearch ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
          ) : searchResults?.results && searchResults.results.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 lg:gap-6">
              {searchResults.results.map((item) => (
                <ContentCard key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <div className="text-center py-20 text-muted-foreground">
              No results found. Try a different term.
            </div>
          )}
        </div>
      ) : (
        <>
          <HeroCarousel items={trendingAll} isLoading={loadingTrendingAll} />
          
          <div className="mt-8 space-y-4">
            <ContentRow title="Trending Movies" items={trendingMovies} isLoading={loadingTrendingMovies} />
            <ContentRow title="Trending TV Shows" items={trendingTv} isLoading={loadingTrendingTv} />
            <ContentRow title="Popular Movies" items={popularMovies} isLoading={loadingPopularMovies} />
            <ContentRow title="Popular TV Shows" items={popularTv} isLoading={loadingPopularTv} />
          </div>
        </>
      )}
    </div>
  );
}

export default withAuthGuard(BrowsePageContent);