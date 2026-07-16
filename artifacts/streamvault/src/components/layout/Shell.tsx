import { useUser, useClerk, Show } from "@clerk/react";
import { Link, useLocation } from "wouter";
import { Film, LogOut, ShieldAlert, Users, LayoutDashboard, Search, MonitorPlay } from "lucide-react";
import { useGetMe } from "@workspace/api-client-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export default function Shell({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  
  const { data: me } = useGetMe({ query: { enabled: !!user } });

  const isAdmin = me?.role === "admin";
  const isApproved = me?.isApproved;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background selection:bg-primary/30 text-foreground font-sans">
      <header className="fixed top-0 inset-x-0 h-16 z-50 bg-background/80 backdrop-blur-md border-b border-border/50">
        <div className="container h-full mx-auto flex items-center justify-between px-4 lg:px-8">
          <Link href="/" className="flex items-center gap-2 group transition-opacity hover:opacity-80">
            <Film className="w-6 h-6 text-primary group-hover:scale-110 transition-transform" />
            <span className="font-bold tracking-widest text-lg hidden sm:inline-block">STREAMVAULT</span>
          </Link>

          <Show when="signed-in">
            {isApproved ? (
              <nav className="flex items-center gap-6">
                <Link href="/browse" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2">
                  <Search className="w-4 h-4" />
                  <span className="hidden sm:inline-block">Browse</span>
                </Link>
                <Link href="/rooms" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2">
                  <MonitorPlay className="w-4 h-4" />
                  <span className="hidden sm:inline-block">Rooms</span>
                </Link>
                {isAdmin && (
                  <Link href="/admin" className="text-sm font-medium text-primary hover:text-primary/80 transition-colors flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4" />
                    <span className="hidden sm:inline-block">Admin</span>
                  </Link>
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-2 outline-none">
                      <Avatar className="h-8 w-8 border border-border/50 hover:border-primary transition-colors cursor-pointer">
                        <AvatarImage src={user?.imageUrl} />
                        <AvatarFallback className="bg-secondary text-xs">{user?.firstName?.charAt(0) || "U"}</AvatarFallback>
                      </Avatar>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48 bg-card border-border/50 shadow-2xl">
                    <div className="flex flex-col space-y-1 p-2">
                      <p className="text-sm font-medium leading-none">{user?.fullName}</p>
                      <p className="text-xs text-muted-foreground leading-none">{user?.primaryEmailAddress?.emailAddress}</p>
                    </div>
                    <DropdownMenuSeparator className="bg-border/50" />
                    {isAdmin && (
                      <DropdownMenuItem asChild>
                        <Link href="/admin" className="cursor-pointer">
                          <LayoutDashboard className="mr-2 h-4 w-4" />
                          <span>Admin Dashboard</span>
                        </Link>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem className="text-destructive focus:text-destructive cursor-pointer" onClick={() => signOut({ redirectUrl: basePath || "/" })}>
                      <LogOut className="mr-2 h-4 w-4" />
                      <span>Log out</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </nav>
            ) : (
               <button onClick={() => signOut({ redirectUrl: basePath || "/" })} className="text-sm font-medium text-muted-foreground hover:text-foreground">
                 Sign Out
               </button>
            )}
          </Show>

          <Show when="signed-out">
            <nav className="flex items-center gap-4">
              <Link href="/sign-in" className="text-sm font-medium hover:text-primary transition-colors">Sign In</Link>
              <Link href="/sign-up" className="text-sm font-medium bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 transition-colors">Join</Link>
            </nav>
          </Show>
        </div>
      </header>

      <main className="flex-1 mt-16 flex flex-col relative z-0">
        {children}
      </main>
    </div>
  );
}