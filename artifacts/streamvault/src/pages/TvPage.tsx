import { useState } from "react";
import { useLocation } from "wouter";
import { Loader2, PlayCircle, Users, Clock, Calendar, Star, X, ChevronDown } from "lucide-react";
import { 
  useGetTvShow, 
  useGetEmbedUrl,
  useCreateRoom
} from "@workspace/api-client-react";
import { withAuthGuard } from "../components/layout/withAuthGuard";

function TvPageContent({ params }: { params: { id: string } }) {
  const tvId = params.id;
  const [, setLocation] = useLocation();
  const [showPlayer, setShowPlayer] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [selectedEpisode, setSelectedEpisode] = useState<number>(1);
  
  const { data: tvShow, isLoading } = useGetTvShow(tvId, {
    query: { enabled: !!tvId }
  });

  const { data: embedData } = useGetEmbedUrl({ type: 'tv', id: tvId, season: selectedSeason, episode: selectedEpisode }, {
    query: { enabled: showPlayer && !!tvId }
  });

  const createRoomMutation = useCreateRoom();

  const handleCreateRoom = () => {
    if (!tvShow) return;
    
    createRoomMutation.mutate({
      data: {
        name: `${tvShow.title} S${selectedSeason}E${selectedEpisode}`,
        contentType: 'tv',
        contentId: tvId,
        contentTitle: tvShow.title,
        contentPoster: tvShow.posterPath || undefined,
        season: selectedSeason,
        episode: selectedEpisode,
      }
    }, {
      onSuccess: (room) => {
        setLocation(`/rooms/${room.id}`);
      }
    });
  };

  const handlePlayEpisode = (seasonNum: number, epNum: number) => {
    setSelectedSeason(seasonNum);
    setSelectedEpisode(epNum);
    setShowPlayer(true);
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!tvShow) {
    return <div className="p-8 text-center text-muted-foreground">TV Show not found</div>;
  }

  const backdropUrl = tvShow.backdropPath ? `https://image.tmdb.org/t/p/w1280${tvShow.backdropPath}` : null;
  const posterUrl = tvShow.posterPath ? `https://image.tmdb.org/t/p/w500${tvShow.posterPath}` : null;
  const year = tvShow.releaseDate ? new Date(tvShow.releaseDate).getFullYear() : null;

  const currentSeasonInfo = tvShow.seasons?.find(s => s.seasonNumber === selectedSeason);
  const epCount = currentSeasonInfo?.episodeCount || 0;

  return (
    <div className="relative min-h-screen pb-20">
      {/* Player Modal */}
      {showPlayer && (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col">
          <div className="absolute top-4 right-4 z-10 flex gap-2">
             <div className="bg-black/80 px-4 py-2 rounded-full text-foreground/80 font-medium text-sm backdrop-blur-md border border-border/30">
               S{selectedSeason} E{selectedEpisode}
             </div>
            <button onClick={() => setShowPlayer(false)} className="p-2 bg-black/50 text-white rounded-full hover:bg-black/80 transition-colors border border-border/30 backdrop-blur-md">
              <X className="w-6 h-6" />
            </button>
          </div>
          {embedData ? (
            <iframe 
              src={embedData.embedUrl} 
              allowFullScreen 
              className="w-full h-full border-0"
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
          )}
        </div>
      )}

      {/* Hero Section */}
      <div className="relative w-full h-[60vh] md:h-[80vh] bg-black">
        {backdropUrl && (
          <img src={backdropUrl} alt={tvShow.title} className="w-full h-full object-cover opacity-40" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
        
        <div className="absolute bottom-0 left-0 w-full container mx-auto px-4 lg:px-8 translate-y-20 z-10">
          <div className="flex flex-col md:flex-row gap-8 items-end md:items-start">
            {/* Poster */}
            {posterUrl && (
              <div className="hidden md:block w-64 flex-shrink-0 rounded-xl overflow-hidden border border-border/50 shadow-2xl shadow-black/50">
                <img src={posterUrl} alt={tvShow.title} className="w-full h-auto object-cover" />
              </div>
            )}
            
            {/* Details */}
            <div className="flex-1 pb-4">
              <h1 className="text-4xl md:text-6xl font-bold text-foreground tracking-tighter mb-2 text-shadow-lg">
                {tvShow.title}
              </h1>
              {tvShow.tagline && (
                <p className="text-lg md:text-xl text-muted-foreground italic mb-4 font-serif">
                  "{tvShow.tagline}"
                </p>
              )}
              
              <div className="flex flex-wrap items-center gap-4 text-sm md:text-base text-foreground/80 mb-6">
                {tvShow.rating > 0 && (
                  <span className="flex items-center gap-1 text-primary font-bold">
                    <Star className="w-4 h-4 fill-current" />
                    {tvShow.rating.toFixed(1)}
                  </span>
                )}
                {year && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-4 h-4" /> {year}
                  </span>
                )}
                {tvShow.seasons && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-4 h-4" /> {tvShow.seasons.length} Seasons
                  </span>
                )}
                <div className="flex gap-2">
                  {tvShow.genres.map(g => (
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
                  Play S{selectedSeason} E{selectedEpisode}
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          
          <div className="lg:col-span-2 space-y-12">
            <section>
              <h2 className="text-2xl font-bold mb-4">Overview</h2>
              <p className="text-lg text-muted-foreground leading-relaxed">
                {tvShow.overview}
              </p>
            </section>

            {/* Episodes List */}
            <section>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold">Episodes</h2>
                
                {/* Season Selector */}
                {tvShow.seasons && (
                  <div className="relative">
                    <select 
                      value={selectedSeason}
                      onChange={(e) => {
                        setSelectedSeason(Number(e.target.value));
                        setSelectedEpisode(1);
                      }}
                      className="appearance-none bg-secondary border border-border rounded-lg px-4 py-2 pr-10 text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {tvShow.seasons.map(s => (
                        <option key={s.seasonNumber} value={s.seasonNumber}>
                          {s.name} ({s.episodeCount} eps)
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                {Array.from({ length: epCount }).map((_, idx) => {
                  const epNum = idx + 1;
                  const isSelected = selectedSeason === selectedSeason && selectedEpisode === epNum;
                  return (
                    <div 
                      key={epNum}
                      className={`flex items-center justify-between p-4 rounded-lg border transition-colors ${
                        isSelected 
                          ? 'bg-primary/10 border-primary/30' 
                          : 'bg-secondary/50 border-border/50 hover:bg-secondary'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <span className="text-2xl font-bold text-muted-foreground/30 w-8 text-center">{epNum}</span>
                        <div>
                          <p className="font-bold text-foreground">Episode {epNum}</p>
                          <p className="text-sm text-muted-foreground">Season {selectedSeason}</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => handlePlayEpisode(selectedSeason, epNum)}
                          className="p-2 rounded-full bg-foreground text-background hover:scale-110 transition-transform"
                          title="Play solo"
                        >
                          <PlayCircle className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          <div className="space-y-12">
            {tvShow.cast && tvShow.cast.length > 0 && (
              <section>
                <h2 className="text-2xl font-bold mb-6">Cast</h2>
                <div className="flex flex-col gap-4">
                  {tvShow.cast.slice(0, 10).map(person => (
                    <div key={person.id} className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full overflow-hidden bg-secondary border border-border/50 flex-shrink-0">
                        {person.profilePath ? (
                          <img 
                            src={`https://image.tmdb.org/t/p/w185${person.profilePath}`} 
                            alt={person.name} 
                            className="w-full h-full object-cover" 
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                            <Users className="w-5 h-5 opacity-50" />
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="font-bold text-sm leading-tight text-foreground">{person.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{person.character}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {tvShow.trailerKey && (
              <section>
                <h2 className="text-2xl font-bold mb-6">Trailer</h2>
                <div className="aspect-video rounded-xl overflow-hidden bg-black border border-border/50 shadow-xl">
                  <iframe 
                    src={`https://www.youtube.com/embed/${tvShow.trailerKey}?autoplay=0&rel=0`}
                    title="Trailer"
                    allowFullScreen
                    className="w-full h-full border-0"
                  />
                </div>
              </section>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

export default withAuthGuard(TvPageContent);