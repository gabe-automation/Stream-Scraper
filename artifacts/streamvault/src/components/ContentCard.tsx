import { Link } from "wouter";
import { Star, PlayCircle } from "lucide-react";
import { ContentItem } from "@workspace/api-client-react";

export function ContentCard({ item }: { item: ContentItem }) {
  const posterUrl = item.posterPath ? `https://image.tmdb.org/t/p/w500${item.posterPath}` : null;
  const rating = item.rating > 0 ? item.rating.toFixed(1) : null;
  const year = item.releaseDate ? new Date(item.releaseDate).getFullYear() : null;

  return (
    <Link href={`/${item.type}/${item.id}`} className="group relative flex-shrink-0 w-40 sm:w-48 aspect-[2/3] rounded-lg overflow-hidden bg-secondary border border-border/50 transition-all hover:scale-105 hover:z-10 focus:outline-none focus:ring-2 focus:ring-primary shadow-lg">
      {posterUrl ? (
        <img src={posterUrl} alt={item.title} className="w-full h-full object-cover transition-opacity group-hover:opacity-40" loading="lazy" />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-secondary text-muted-foreground p-4 text-center">
          {item.title}
        </div>
      )}
      
      <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
        <h4 className="text-foreground font-bold text-sm line-clamp-2 leading-tight mb-1">{item.title}</h4>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          {year && <span>{year}</span>}
          {rating && (
            <span className="flex items-center gap-1 text-primary font-medium">
              <Star className="w-3 h-3 fill-current" />
              {rating}
            </span>
          )}
        </div>
      </div>
      
      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity scale-75 group-hover:scale-100 duration-300">
        <PlayCircle className="w-12 h-12 text-primary" strokeWidth={1.5} />
      </div>
    </Link>
  );
}

export function ContentRow({ title, items, isLoading }: { title: string; items?: ContentItem[]; isLoading?: boolean }) {
  if (isLoading) {
    return (
      <div className="py-6">
        <h3 className="text-xl font-bold mb-4 px-4 lg:px-8 text-foreground/80">{title}</h3>
        <div className="flex gap-4 overflow-x-hidden px-4 lg:px-8">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="flex-shrink-0 w-40 sm:w-48 aspect-[2/3] rounded-lg bg-secondary/50 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!items || items.length === 0) return null;

  return (
    <div className="py-6 relative group/row">
      <h3 className="text-xl font-bold mb-4 px-4 lg:px-8 text-foreground/90 tracking-tight">{title}</h3>
      <div className="flex gap-4 overflow-x-auto px-4 lg:px-8 pb-4 scrollbar-hide snap-x snap-mandatory mask-linear-fade">
        {items.map(item => (
          <div key={item.id} className="snap-start scroll-ml-4 lg:scroll-ml-8">
            <ContentCard item={item} />
          </div>
        ))}
      </div>
    </div>
  );
}