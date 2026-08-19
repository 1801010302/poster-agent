import { useEffect, useState } from "react";
import { client } from "../lib/edgespark";

export function useAuth() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => client.auth.onSessionChange((next) => {
    setSession(next);
    setLoading(false);
  }), []);

  return {
    session,
    user: session?.user || null,
    loading,
    signOut: () => client.auth.signOut(),
  };
}
