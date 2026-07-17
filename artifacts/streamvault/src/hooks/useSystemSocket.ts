/**
 * useSystemSocket — persistent global socket for system-wide push events.
 *
 * Connects once when the user is signed in, identifies itself so the server
 * can target this user's socket, then reacts to:
 *   • user-updated    → refetch /me so approval/role changes take effect
 *   • user-deleted    → sign out (admin removed the account)
 *   • admin-users-changed → admins refetch the user list
 *   • rooms-list-changed  → refetch the rooms list (creation / deletion)
 *   • room-closed     → navigate away if viewing that room (handled in WatchRoomPage;
 *                        here we just invalidate the list)
 */
import { useEffect } from "react";
import { io as ioConnect, type Socket } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import { useClerk, useUser } from "@clerk/react";
import { useLocation } from "wouter";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

let _socket: Socket | null = null;
let _clerkId: string | null = null;

/** Returns the singleton system socket (create if needed) */
function getSystemSocket(): Socket {
  if (!_socket || _socket.disconnected) {
    _socket = ioConnect(window.location.origin, {
      path: `${BASE_URL}/ws/socket.io`,
      transports: ["websocket", "polling"],
    });
  }
  return _socket;
}

export function useSystemSocket() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const clerkId = user?.id ?? null;

  useEffect(() => {
    if (!clerkId) return;

    const s = getSystemSocket();
    _clerkId = clerkId;

    function onConnect() {
      s.emit("identify", clerkId);
    }

    function onUserUpdated(_data: { id: string; clerkId: string; isApproved: boolean; role: string }) {
      // Our account was approved or role changed — refresh /me so the UI adapts
      queryClient.invalidateQueries({ queryKey: ["/api/users/me"] });
    }

    function onUserDeleted(_data: { id: string }) {
      // Our account was removed — sign out
      signOut();
    }

    function onAdminUsersChanged() {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
    }

    function onRoomsListChanged() {
      queryClient.invalidateQueries({ queryKey: ["/api/rooms"] });
    }

    // Register listeners
    if (s.connected) onConnect();
    s.on("connect", onConnect);
    s.on("user-updated", onUserUpdated);
    s.on("user-deleted", onUserDeleted);
    s.on("admin-users-changed", onAdminUsersChanged);
    s.on("rooms-list-changed", onRoomsListChanged);

    return () => {
      s.off("connect", onConnect);
      s.off("user-updated", onUserUpdated);
      s.off("user-deleted", onUserDeleted);
      s.off("admin-users-changed", onAdminUsersChanged);
      s.off("rooms-list-changed", onRoomsListChanged);
      // Don't disconnect here — the singleton should live as long as the app does
    };
  }, [clerkId, queryClient, signOut, setLocation]);
}
