import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Users, MonitorPlay, Plus, Film, Tv, Clock, Loader2, Search } from "lucide-react";
import { useListRooms, useGetMe, Room } from "@workspace/api-client-react";
import { withAuthGuard } from "../components/layout/withAuthGuard";

function RoomCard({ room }: { room: Room }) {
  const posterUrl = room.contentPoster ? `https://image.tmdb.org/t/p/w500${room.contentPoster}` : null;
  const timeStr = new Date(room.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <Link href={`/rooms/${room.id}`} className="group relative rounded-xl overflow-hidden bg-card border border-border/50 flex flex-col hover:border-primary/50 transition-all hover:-translate-y-1 shadow-lg">
      <div className="aspect-video bg-secondary relative overflow-hidden">
        {posterUrl ? (
          <img src={posterUrl} alt={room.contentTitle} className="w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-opacity" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {room.contentType === 'movie' ? <Film className="w-8 h-8 text-muted-foreground/50" /> : <Tv className="w-8 h-8 text-muted-foreground/50" />}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
        <div className="absolute bottom-3 left-3 right-3">
          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-primary/20 text-primary border border-primary/20 mb-2 inline-block">
            {room.contentType}
          </span>
          <h3 className="font-bold text-white line-clamp-1 leading-tight text-lg shadow-black text-shadow">{room.contentTitle}</h3>
        </div>
      </div>
      
      <div className="p-4 flex-1 flex flex-col justify-between gap-4">
        <div>
          <h4 className="font-medium text-foreground line-clamp-1">{room.name}</h4>
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
            <Clock className="w-3 h-3" /> Hosted by {room.hostName}
          </p>
        </div>
        
        <div className="flex items-center justify-between mt-auto">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground bg-secondary px-2 py-1 rounded-md">
            <Users className="w-4 h-4" />
            <span className="font-medium">{room.memberCount}</span>
          </div>
          <span className="text-primary font-bold text-sm group-hover:underline underline-offset-4">
            Join Room →
          </span>
        </div>
      </div>
    </Link>
  );
}

function RoomsPageContent() {
  const [, setLocation] = useLocation();
  const { data: rooms, isLoading } = useListRooms({ query: { refetchInterval: 10000 } });

  return (
    <div className="container mx-auto px-4 lg:px-8 py-8 md:py-12 pb-24">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Watch Rooms</h1>
          <p className="text-muted-foreground">Join an active watch party or start your own.</p>
        </div>
        <Link href="/browse" className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground font-bold rounded-lg hover:bg-primary/90 transition-colors shadow-lg">
          <Plus className="w-5 h-5" />
          Create Room
        </Link>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {[1,2,3,4].map(i => (
            <div key={i} className="rounded-xl overflow-hidden bg-card border border-border/50 h-72 animate-pulse">
              <div className="h-36 bg-secondary" />
              <div className="p-4 space-y-3">
                <div className="h-5 bg-secondary rounded w-3/4" />
                <div className="h-4 bg-secondary rounded w-1/2" />
                <div className="pt-4 flex justify-between">
                  <div className="h-6 bg-secondary rounded w-12" />
                  <div className="h-6 bg-secondary rounded w-20" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : rooms && rooms.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {rooms.map(room => (
            <RoomCard key={room.id} room={room} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-32 text-center bg-card rounded-2xl border border-border/50 border-dashed">
          <div className="w-20 h-20 rounded-full bg-secondary flex items-center justify-center mb-4">
            <MonitorPlay className="w-10 h-10 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-bold mb-2">No active rooms</h2>
          <p className="text-muted-foreground max-w-sm mb-6">
            There are no watch parties happening right now. Be the first to start one!
          </p>
          <Link href="/browse" className="inline-flex items-center gap-2 px-6 py-3 bg-foreground text-background font-bold rounded-lg hover:bg-foreground/90 transition-colors">
            Browse Content
          </Link>
        </div>
      )}
    </div>
  );
}

export default withAuthGuard(RoomsPageContent);