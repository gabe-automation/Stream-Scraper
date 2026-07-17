import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { dark } from '@clerk/themes';
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";

import Shell from "./components/layout/Shell";
import { useSystemSocket } from "./hooks/useSystemSocket";
import LandingPage from "./pages/LandingPage";
import BrowsePage from "./pages/BrowsePage";
import MoviePage from "./pages/MoviePage";
import TvPage from "./pages/TvPage";
import RoomsPage from "./pages/RoomsPage";
import WatchRoomPage from "./pages/WatchRoomPage";
import AdminPage from "./pages/AdminPage";
import InvitePage from "./pages/InvitePage";
import AwaitingApprovalPage from "./pages/AwaitingApprovalPage";

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY');

const clerkAppearance = {
  theme: dark,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(43, 96%, 56%)",         // warm amber/gold
    colorForeground: "hsl(210, 40%, 98%)",      // light text on dark bg
    colorMutedForeground: "hsl(215, 20.2%, 65.1%)",
    colorDanger: "hsl(0, 62.8%, 30.6%)",
    colorBackground: "hsl(232, 47%, 6%)",      // deep dark card bg
    colorInput: "hsl(232, 47%, 12%)",
    colorInputForeground: "hsl(210, 40%, 98%)",
    colorNeutral: "hsl(232, 47%, 12%)",
    fontFamily: "Geist, Inter, sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-card rounded-2xl w-[440px] max-w-full overflow-hidden border border-border/50 shadow-2xl",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-foreground font-bold tracking-tight text-2xl",
    headerSubtitle: "text-muted-foreground",
    socialButtonsBlockButtonText: "text-foreground font-medium",
    formFieldLabel: "text-foreground font-medium",
    footerActionLink: "text-primary hover:text-primary/80 font-medium",
    footerActionText: "text-muted-foreground",
    dividerText: "text-muted-foreground",
    identityPreviewEditButton: "text-primary hover:text-primary/80",
    formFieldSuccessText: "text-primary",
    alertText: "text-destructive-foreground",
    logoBox: "flex justify-center mb-6",
    logoImage: "h-12 w-auto",
    socialButtonsBlockButton: "bg-input border-border hover:bg-input/80 text-foreground",
    formButtonPrimary: "bg-primary text-primary-foreground hover:bg-primary/90 font-bold",
    formFieldInput: "bg-input border-border text-foreground focus:ring-primary focus:border-primary",
    footerAction: "bg-transparent",
    dividerLine: "bg-border",
    alert: "bg-destructive/20 border border-destructive text-destructive-foreground",
    otpCodeFieldInput: "bg-input border-border text-foreground focus:ring-primary",
    formFieldRow: "mb-4",
    main: "w-full",
  },
};

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);
  return null;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/browse" />
      </Show>
      <Show when="signed-out">
        <LandingPage />
      </Show>
    </>
  );
}

function SystemSocketBridge() {
  useSystemSocket();
  return null;
}

function AppRouter() {
  return (
    <>
    <SystemSocketBridge />
    <Shell>
      <Switch>
        <Route path="/" component={HomeRedirect} />
        <Route path="/sign-in/*?">
          <div className="flex min-h-screen bg-grain items-center justify-center pt-16 px-4">
            <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
          </div>
        </Route>
        <Route path="/sign-up/*?">
          <div className="flex min-h-screen bg-grain items-center justify-center pt-16 px-4">
            <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
          </div>
        </Route>
        <Route path="/invite/:code" component={InvitePage} />
        <Route path="/browse" component={BrowsePage} />
        <Route path="/movie/:id" component={MoviePage} />
        <Route path="/tv/:id" component={TvPage} />
        <Route path="/rooms" component={RoomsPage} />
        <Route path="/rooms/:id" component={WatchRoomPage} />
        <Route path="/admin" component={AdminPage} />
        <Route path="/awaiting-approval" component={AwaitingApprovalPage} />
        <Route>
          <div className="flex items-center justify-center h-[calc(100vh-64px)] text-muted-foreground">
            404 Not Found
          </div>
        </Route>
      </Switch>
    </Shell>
    </>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: "Welcome back", subtitle: "Sign in to StreamVault" } },
        signUp: { start: { title: "Join StreamVault", subtitle: "Invite-only access" } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <AppRouter />
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}