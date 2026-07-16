import { useState } from "react";
import { useLocation } from "wouter";
import { useGetInvite, useAcceptInvite } from "@workspace/api-client-react";
import { Loader2, Ticket, CheckCircle2, XCircle } from "lucide-react";

export default function InvitePage({ params }: { params: { code: string } }) {
  const { code } = params;
  const [, setLocation] = useLocation();
  const { data: invite, isLoading, isError } = useGetInvite(code, {
    query: { enabled: !!code, retry: false }
  });
  const acceptMutation = useAcceptInvite();

  const handleAccept = () => {
    acceptMutation.mutate({ code }, {
      onSuccess: () => {
        setLocation("/sign-up");
      }
    });
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[calc(100vh-64px)]">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (isError || !invite) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[calc(100vh-64px)] bg-grain px-4">
        <div className="max-w-md w-full text-center space-y-6 bg-card p-8 rounded-2xl border border-destructive/20 shadow-2xl">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto border border-destructive/20">
            <XCircle className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Invalid Invite</h1>
          <p className="text-muted-foreground text-sm">
            This invite code doesn't exist, has expired, or has already been used.
          </p>
          <button onClick={() => setLocation("/")} className="text-primary hover:underline text-sm mt-4">
            Return home
          </button>
        </div>
      </div>
    );
  }

  const isUsed = !!invite.usedBy;
  const isExpired = invite.expiresAt ? new Date(invite.expiresAt) < new Date() : false;
  const isValid = !isUsed && !isExpired;

  return (
    <div className="flex-1 flex items-center justify-center min-h-[calc(100vh-64px)] bg-grain px-4">
      <div className="max-w-md w-full text-center space-y-6 bg-card p-8 rounded-2xl border border-primary/20 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent" />
        
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto border border-primary/20">
          <Ticket className="w-8 h-8 text-primary" />
        </div>
        
        <h1 className="text-2xl font-bold tracking-tight">Golden Ticket</h1>
        
        {isValid ? (
          <>
            <p className="text-muted-foreground text-sm">
              You've been invited to join StreamVault. Your private cinema awaits.
            </p>
            {invite.note && (
              <div className="p-4 bg-secondary/50 rounded-lg border border-border/50 text-sm italic text-muted-foreground">
                "{invite.note}"
              </div>
            )}
            <button 
              onClick={handleAccept}
              disabled={acceptMutation.isPending}
              className="w-full inline-flex items-center justify-center gap-2 px-8 py-4 bg-primary text-primary-foreground font-bold rounded-lg hover:bg-primary/90 transition-all shadow-lg disabled:opacity-50"
            >
              {acceptMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
              Accept Invitation
            </button>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            {isUsed ? "This ticket has already been claimed." : "This ticket has expired."}
          </p>
        )}
      </div>
    </div>
  );
}