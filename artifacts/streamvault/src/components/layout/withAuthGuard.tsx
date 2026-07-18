import { useEffect } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { useGetMe } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";

export function withAuthGuard(Component: React.ComponentType<any>) {
  return function ProtectedRoute(props: any) {
    const { isLoaded, isSignedIn } = useUser();
    const [, setLocation] = useLocation();
    
    // Always call hooks
    const { data: me, isLoading: isLoadingMe } = useGetMe({
      query: { enabled: isSignedIn, retry: 1 }
    });

    useEffect(() => {
      if (isLoaded && !isSignedIn) {
        // Preserve the full current URL so Clerk can redirect back after sign-in.
        // e.g. visiting /rooms/abc while signed out → after sign-in → lands in /rooms/abc
        const redirectTarget = encodeURIComponent(window.location.href);
        setLocation(`/sign-in?redirect_url=${redirectTarget}`);
      }
    }, [isLoaded, isSignedIn, setLocation]);

    useEffect(() => {
      if (me && !me.isApproved && me.role !== 'admin') {
        setLocation("/awaiting-approval");
      }
    }, [me, setLocation]);

    if (!isLoaded || isLoadingMe) {
      return (
        <div className="flex-1 flex items-center justify-center min-h-[50vh]">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      );
    }

    if (!isSignedIn) return null;
    if (me && !me.isApproved && me.role !== 'admin') return null;

    return <Component {...props} />;
  };
}