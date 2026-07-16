import { useUser, useClerk } from "@clerk/react";
import { ShieldAlert } from "lucide-react";

export default function AwaitingApprovalPage() {
  const { signOut } = useClerk();
  
  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-[calc(100vh-64px)] bg-grain px-4">
      <div className="max-w-md w-full text-center space-y-6 bg-card p-8 rounded-2xl border border-border/50 shadow-2xl">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto border border-primary/20">
          <ShieldAlert className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Access Pending</h1>
        <p className="text-muted-foreground text-sm">
          Your account has been created, but you must be approved by an administrator before you can enter StreamVault.
        </p>
        <p className="text-muted-foreground text-sm italic">
          "The best seats in the house are worth waiting for."
        </p>
        <div className="pt-4 border-t border-border/50">
          <button 
            onClick={() => signOut()}
            className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}