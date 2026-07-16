import { Link } from "wouter";
import heroImg from "@assets/generated_images/streamvault_hero.jpg";

export default function LandingPage() {
  return (
    <div className="relative min-h-[calc(100dvh-64px)] w-full flex flex-col">
      {/* Hero Background */}
      <div className="absolute inset-0 z-0">
        <img src={heroImg} alt="Cinematic theater background" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/40 to-transparent" />
      </div>

      <div className="relative z-10 flex-1 flex flex-col items-start justify-center container mx-auto px-4 lg:px-8 py-20">
        <div className="max-w-2xl">
          <h1 className="text-5xl md:text-7xl font-bold tracking-tighter text-foreground mb-6 text-shadow-lg">
            Your <span className="text-primary italic">private</span> cinema.
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground mb-10 text-shadow max-w-lg">
            An exclusive, invite-only theater for you and your friends. Stream movies and TV shows in perfect sync, chat in real-time, and curate your ultimate watchlist.
          </p>

          <div className="flex flex-col sm:flex-row gap-4">
            <Link href="/sign-in" className="inline-flex items-center justify-center px-8 py-4 bg-primary text-primary-foreground font-bold rounded-lg hover:bg-primary/90 transition-all hover:scale-105 active:scale-95 shadow-xl shadow-primary/20">
              Sign In to Enter
            </Link>
            <div className="flex items-center gap-2 px-4 py-2 bg-secondary/50 backdrop-blur-md rounded-lg border border-border/50">
              <span className="text-sm text-muted-foreground">Have an invite code?</span>
              <Link href="/sign-up" className="text-sm font-bold text-foreground hover:text-primary transition-colors underline underline-offset-4">
                Redeem here
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="relative z-10 bg-background py-24 border-t border-border/10">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            <div className="flex flex-col gap-4">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
                <span className="text-2xl">🎬</span>
              </div>
              <h3 className="text-xl font-bold">Curated Content</h3>
              <p className="text-muted-foreground">Access a vast library of trending movies and TV shows in high definition.</p>
            </div>
            <div className="flex flex-col gap-4">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
                <span className="text-2xl">🍿</span>
              </div>
              <h3 className="text-xl font-bold">Watch Together</h3>
              <p className="text-muted-foreground">Create private screening rooms. Video sync, real-time chat, and reactions.</p>
            </div>
            <div className="flex flex-col gap-4">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
                <span className="text-2xl">🤫</span>
              </div>
              <h3 className="text-xl font-bold">Invite Only</h3>
              <p className="text-muted-foreground">A closed community. You must be invited by an admin to gain access.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}