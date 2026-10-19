"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import api from "../lib/api";
import { setSessionPortal, sessionLoginPath, cooperativeHome } from "../lib/portal";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem("embu_user") : null;
    if (stored) {
      try {
        setUser(JSON.parse(stored));
      } catch {
        // ignore parse errors
      }
    }
    setLoading(false);
  }, []);

  const login = useCallback(
    async (email, password) => {
      const { data } = await api.post("/auth/login", { email, password });
      // Two-step sign-in: the password was right; the page now asks for the code.
      if (data.mfaRequired) return { mfaRequired: true, mfaToken: data.mfaToken };
      window.localStorage.setItem("embu_token", data.token);
      window.localStorage.setItem("embu_user", JSON.stringify(data.user));
      setSessionPortal("staff");
      setUser(data.user);
      router.push("/dashboard");
      return { mfaRequired: false };
    },
    [router]
  );

  // Second step of a two-step sign-in: an authenticator code or a recovery code.
  const verifyMfa = useCallback(
    async (mfaToken, { code, recoveryCode }) => {
      const { data } = await api.post("/auth/mfa/verify", { mfaToken, code, recoveryCode });
      window.localStorage.setItem("embu_token", data.token);
      window.localStorage.setItem("embu_user", JSON.stringify(data.user));
      setSessionPortal("staff");
      setUser(data.user);
      router.push("/dashboard");
    },
    [router]
  );

  // Cooperative Portal sign-in: its own endpoint and its own token type. The
  // identifier can be the manager's email or the cooperative's registration
  // number. Lands the manager straight in their cooperative.
  const cooperativeLogin = useCallback(
    async (identifier, password) => {
      const { data } = await api.post("/cooperative-auth/login", { identifier, password });
      window.localStorage.setItem("embu_token", data.token);
      window.localStorage.setItem("embu_user", JSON.stringify(data.user));
      setSessionPortal("cooperative");
      setUser(data.user);
      router.push(cooperativeHome(data.user));
    },
    [router]
  );

  // Replace the stored session (used after a password change, which issues a new token).
  const updateSession = useCallback((token, nextUser) => {
    window.localStorage.setItem("embu_token", token);
    window.localStorage.setItem("embu_user", JSON.stringify(nextUser));
    setUser(nextUser);
  }, []);

  const logout = useCallback(() => {
    const target = sessionLoginPath();
    window.localStorage.removeItem("embu_token");
    window.localStorage.removeItem("embu_user");
    setUser(null);
    router.push(target);
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, loading, login, verifyMfa, cooperativeLogin, logout, updateSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
