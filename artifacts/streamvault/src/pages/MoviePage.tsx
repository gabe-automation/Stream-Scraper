import { useState } from "react";
import { useLocation } from "wouter";
import { Loader2, PlayCircle, Plus, Users, Clock, Calendar, Star } from "lucide-react";
import { 
  useGetMovie,
  useCreateRoom,
} from "@workspace/api-client-react";
import { withAuthGuard } from "../components/layout/withAuthGuard";
import { VideoPlayer } from "../components/VideoPlayer";

function MoviePageContent({ params }: { params: { id: string } }) {
  const movieId = params.id;
  const [, setLocation] = useLocation();
  const [showPlayer, setShowPlayer] = useState(false);
  
  const { data: movie, isLoading } = useGetMovie(movieId, {
    query: { enabled: !!movieId }
  });

  const createRoomMutation = useCreateRoom();

  const handleCreateRoom = () => {
    if (!movie) return;
    
    createRoomMutation.mutate({
      data: {
        name: `${movie.title} Watch Party`,
        contentType: 'movie',
        contentId: movieId,
        contentTitle: movie.title,
        contentPoster: movie.posterPath || undefined,
      }
    }, {
      onSuccess: (room) => {
        setLocation(`/rooms/${room.id}`);
      }
    });
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!movie) {
    return <div className="p-8 text-center text-muted-foreground">Movie not found</div>;
  }

  const backdropUrl = movie.backdropPath ? `https://image.tmdb.org/t/p/w1280${movie.backdropPath}` : null;
  const posterUrl = movie.posterPath ? `https://image.tmdb.org/t/p/w500${movie.posterPath}` : null;
  const year = movie.releaseDate ? new Date(movie.releaseDate).getFullYear() : null;

  return (
    <div className="relative min-h-screen pb-20">
      {/* Player */}
      {showPlayer && (
        <VideoPlayer
          type="movie"
          id={movieId}
          label={movie.title}
          onClose={() => setShowPlayer(false)}
        />
      )}

      {/* Hero Section */}
      <div className="relative w-full h-[60vh] md:h-[80vh] bg-black">
        {backdropUrl && (
          <img src={backdropUrl} alt={movie.title} className="w-full h-full object-cover opacity-40" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
        
        <div className="absolute bottom-0 left-0 w-full container mx-auto px-4 lg:px-8 translate-y-20 z-10">
          <div className="flex flex-col md:flex-row gap-8 items-end md:items-start">
            {/* Poster */}
            {posterUrl && (
              <div className="hidden md:block w-64 flex-shrink-0 rounded-xl overflow-hidden border border-border/50 shadow-2xl shadow-black/50">
                <img src={posterUrl} alt={movie.title} className="w-full h-auto object-cover" />
              </div>
            )}
            
            {/* Details */}
            <div className="flex-1 pb-4">
              <h1 className="text-4xl md:text-6xl font-bold text-foreground tracking-tighter mb-2 text-shadow-lg">
                {movie.title}
              </h1>
              {movie.tagline && (
                <p className="text-lg md:text-xl text-muted-foreground italic mb-4 font-serif">
                  "{movie.tagline}"
                </p>
              )}
              
              <div className="flex flex-wrap items-center gap-4 text-sm md:text-base text-foreground/80 mb-6">
                {movie.rating > 0 && (
                  <span className="flex items-center gap-1 text-primary font-bold">
                    <Star className="w-4 h-4 fill-current" />
                    {movie.rating.toFixed(1)}
                  </span>
                )}
                {year && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-4 h-4" /> {year}
                  </span>
                )}
                {movie.runtime && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-4 h-4" /> {movie.runtime}m
                  </span>
                )}
                <div className="flex gap-2">
                  {movie.genres.map(g => (
                    <span key={g} className="px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground text-xs font-medium border border-border/50">
                      {g}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-4">
                <button 
                  onClick={() => setShowPlayer(true)}
                  className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-foreground text-background font-bold rounded-lg hover:bg-foreground/90 transition-all shadow-xl hover:scale-105 active:scale-95"
                >
                  <PlayCircle className="w-5 h-5" />
                  Play Solo
                </button>
                <button 
                  onClick={handleCreateRoom}
                  disabled={createRoomMutation.isPending}
                  className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-primary text-primary-foreground font-bold rounded-lg hover:bg-primary/90 transition-all shadow-xl hover:scale-105 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
                >
                  {createRoomMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Users className="w-5 h-5" />}
                  Watch Together
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 lg:px-8 mt-32">
        <div className="max-w-4xl">
          <h2 className="text-2xl font-bold mb-4">Overview</h2>
          <p className="text-lg text-muted-foreground leading-relaxed mb-12">
            {movie.overview}
          </p>

          {movie.cast && movie.cast.length > 0 && (
            <div>
              <h2 className="text-2xl font-bold mb-6">Cast</h2>
              <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide snap-x mask-linear-fade">
                {movie.cast.map(person => (
                  <div key={person.id} className="flex-shrink-0 w-32 snap-start">
                    <div className="w-32 h-32 rounded-full overflow-hidden bg-secondary border border-border/50 mb-3 shadow-md">
                      {person.profilePath ? (
                        <img 
                          src={`https://image.tmdb.org/t/p/w185${person.profilePath}`} 
                          alt={person.name} 
                          className="w-full h-full object-cover" 
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground bg-secondary">
                          <Users className="w-8 h-8 opacity-50" />
                        </div>
                      )}
                    </div>
                    <div className="text-center">
                      <p className="font-bold text-sm leading-tight text-foreground">{person.name}</p>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{person.character}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {movie.trailerKey && (
            <div className="mt-12">
              <h2 className="text-2xl font-bold mb-6">Trailer</h2>
              <div className="aspect-video rounded-xl overflow-hidden bg-black border border-border/50 shadow-xl">
                <iframe 
                  src={`https://www.youtube.com/embed/${movie.trailerKey}?autoplay=0&rel=0`}
                  title="Trailer"
                  allowFullScreen
                  className="w-full h-full border-0"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default withAuthGuard(MoviePageContent);