import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { 
  ShieldAlert, 
  Users, 
  Ticket, 
  Trash2, 
  CheckCircle2, 
  XCircle, 
  Copy, 
  Plus, 
  Loader2,
  UserCheck,
  UserX,
  Shield,
  UserIcon
} from "lucide-react";
import { 
  useGetMe, 
  useListUsers, 
  useUpdateUser, 
  useDeleteUser,
  useListInvites,
  useCreateInvite,
  useDeleteInvite,
  User,
  Invite,
  UserAdminUpdateRole
} from "@workspace/api-client-react";
import { withAuthGuard } from "../components/layout/withAuthGuard";
import { format } from "date-fns";

function UsersTab() {
  const { data: usersData, isLoading } = useListUsers();
  const updateUserMutation = useUpdateUser();
  const deleteUserMutation = useDeleteUser();
  const { data: me } = useGetMe();

  const handleToggleApproval = (user: User) => {
    updateUserMutation.mutate({
      id: user.id,
      data: { isApproved: !user.isApproved }
    }, {
      onSuccess: () => {
        // QueryClient will be invalidated automatically if we use the right keys, 
        // but let's just let it refetch or we can optimistic update. Orval hooks handle this usually.
      }
    });
  };

  const handleToggleRole = (user: User) => {
    updateUserMutation.mutate({
      id: user.id,
      data: { role: user.role === 'admin' ? 'user' : 'admin' }
    });
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this user?")) {
      deleteUserMutation.mutate({ id });
    }
  };

  if (isLoading) return <div className="p-8 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="bg-card rounded-xl border border-border/50 overflow-hidden shadow-xl">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-secondary/50 text-muted-foreground">
            <tr>
              <th className="p-4 font-medium">User</th>
              <th className="p-4 font-medium">Role</th>
              <th className="p-4 font-medium">Status</th>
              <th className="p-4 font-medium">Joined</th>
              <th className="p-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {usersData?.users.map(user => (
              <tr key={user.id} className="hover:bg-secondary/20 transition-colors">
                <td className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-secondary border border-border/50 overflow-hidden flex-shrink-0">
                      {user.avatarUrl ? (
                        <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground bg-secondary">
                          {user.name.charAt(0)}
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="font-medium text-foreground">{user.name}</div>
                      <div className="text-muted-foreground text-xs">{user.email}</div>
                    </div>
                  </div>
                </td>
                <td className="p-4">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium border ${
                    user.role === 'admin' ? 'bg-primary/10 text-primary border-primary/20' : 'bg-secondary text-secondary-foreground border-border/50'
                  }`}>
                    {user.role === 'admin' ? <Shield className="w-3 h-3" /> : <UserIcon className="w-3 h-3" />}
                    {user.role}
                  </span>
                </td>
                <td className="p-4">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium border ${
                    user.isApproved ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'
                  }`}>
                    {user.isApproved ? <CheckCircle2 className="w-3 h-3" /> : <Loader2 className="w-3 h-3" />}
                    {user.isApproved ? 'Approved' : 'Pending'}
                  </span>
                </td>
                <td className="p-4 text-muted-foreground">
                  {format(new Date(user.createdAt), 'MMM d, yyyy')}
                </td>
                <td className="p-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {user.id !== me?.id && (
                      <>
                        <button
                          onClick={() => handleToggleApproval(user)}
                          disabled={updateUserMutation.isPending}
                          className="p-2 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground transition-colors"
                          title={user.isApproved ? "Revoke Access" : "Approve Access"}
                        >
                          {user.isApproved ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => handleToggleRole(user)}
                          disabled={updateUserMutation.isPending}
                          className="p-2 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground transition-colors"
                          title={user.role === 'admin' ? "Demote to User" : "Promote to Admin"}
                        >
                          <ShieldAlert className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(user.id)}
                          disabled={deleteUserMutation.isPending}
                          className="p-2 rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive transition-colors"
                          title="Delete User"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InvitesTab() {
  const { data: invites, isLoading } = useListInvites();
  const createInviteMutation = useCreateInvite();
  const deleteInviteMutation = useDeleteInvite();
  const [showModal, setShowModal] = useState(false);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createInviteMutation.mutate({
      data: {
        email: email || undefined,
        note: note || undefined,
      }
    }, {
      onSuccess: () => {
        setShowModal(false);
        setEmail("");
        setNote("");
      }
    });
  };

  const copyToClipboard = (code: string) => {
    const url = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/invite/${code}`;
    navigator.clipboard.writeText(url);
    alert("Invite link copied!");
  };

  if (isLoading) return <div className="p-8 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground font-bold rounded-lg hover:bg-primary/90 transition-colors shadow-lg"
        >
          <Plus className="w-4 h-4" /> Generate Invite
        </button>
      </div>

      <div className="bg-card rounded-xl border border-border/50 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-secondary/50 text-muted-foreground">
              <tr>
                <th className="p-4 font-medium">Code</th>
                <th className="p-4 font-medium">Target Email</th>
                <th className="p-4 font-medium">Note</th>
                <th className="p-4 font-medium">Status</th>
                <th className="p-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {invites?.map(invite => {
                const isUsed = !!invite.usedBy;
                const isExpired = invite.expiresAt ? new Date(invite.expiresAt) < new Date() : false;
                
                return (
                  <tr key={invite.id} className="hover:bg-secondary/20 transition-colors">
                    <td className="p-4 font-mono text-foreground">{invite.code}</td>
                    <td className="p-4 text-muted-foreground">{invite.email || '—'}</td>
                    <td className="p-4 text-muted-foreground">{invite.note || '—'}</td>
                    <td className="p-4">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium border ${
                        isUsed ? 'bg-green-500/10 text-green-500 border-green-500/20' : 
                        isExpired ? 'bg-destructive/10 text-destructive border-destructive/20' :
                        'bg-primary/10 text-primary border-primary/20'
                      }`}>
                        {isUsed ? 'Used' : isExpired ? 'Expired' : 'Active'}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {!isUsed && !isExpired && (
                          <button
                            onClick={() => copyToClipboard(invite.code)}
                            className="p-2 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground transition-colors"
                            title="Copy Link"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => deleteInviteMutation.mutate({ code: invite.code })}
                          className="p-2 rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive transition-colors"
                          title="Revoke Invite"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {invites?.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    No invites generated yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card w-full max-w-md rounded-2xl border border-border/50 shadow-2xl p-6">
            <h3 className="text-xl font-bold mb-4">Generate Invite</h3>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Target Email (Optional)</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-input border border-border rounded-lg px-3 py-2 text-foreground focus:ring-2 focus:ring-primary focus:border-primary outline-none"
                  placeholder="friend@example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Note (Optional)</label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full bg-input border border-border rounded-lg px-3 py-2 text-foreground focus:ring-2 focus:ring-primary focus:border-primary outline-none"
                  placeholder="For movie night crew"
                />
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-secondary text-foreground rounded-lg hover:bg-secondary/80 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createInviteMutation.isPending}
                  className="px-4 py-2 bg-primary text-primary-foreground font-bold rounded-lg hover:bg-primary/90 transition-colors inline-flex items-center gap-2"
                >
                  {createInviteMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  Generate
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminPageContent() {
  const [activeTab, setActiveTab] = useState<'users' | 'invites'>('users');
  const [, setLocation] = useLocation();
  const { data: me, isLoading } = useGetMe();

  useEffect(() => {
    if (me && me.role !== 'admin') {
      setLocation('/browse');
    }
  }, [me, setLocation]);

  if (isLoading || !me || me.role !== 'admin') return null;

  return (
    <div className="container mx-auto px-4 lg:px-8 py-8 md:py-12 pb-24">
      <div className="flex items-center gap-3 mb-8">
        <ShieldAlert className="w-8 h-8 text-primary" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
          <p className="text-muted-foreground">Manage users and access to the vault.</p>
        </div>
      </div>

      <div className="flex border-b border-border/50 mb-8">
        <button
          onClick={() => setActiveTab('users')}
          className={`px-6 py-3 font-medium text-sm transition-colors border-b-2 ${
            activeTab === 'users' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4" /> Users
          </div>
        </button>
        <button
          onClick={() => setActiveTab('invites')}
          className={`px-6 py-3 font-medium text-sm transition-colors border-b-2 ${
            activeTab === 'invites' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <div className="flex items-center gap-2">
            <Ticket className="w-4 h-4" /> Invites
          </div>
        </button>
      </div>

      {activeTab === 'users' ? <UsersTab /> : <InvitesTab />}
    </div>
  );
}

export default withAuthGuard(AdminPageContent);