"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import agrovetApi from "../lib/agrovetApi";

const AgrovetAuthContext = createContext(null);

export function AgrovetAuthProvider({ children }) {
  const [shop, setShop] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem("embu_agrovet_profile") : null;
    if (stored) {
      try {
        setShop(JSON.parse(stored));
      } catch {
        // ignore parse errors
      }
    }
    setLoading(false);
  }, []);

  const login = useCallback(
    async (nationalId, password) => {
      const { data } = await agrovetApi.post("/agrovet-auth/login", { nationalId, password });
      window.localStorage.setItem("embu_agrovet_token", data.token);
      window.localStorage.setItem("embu_agrovet_profile", JSON.stringify(data.shop));
      setShop(data.shop);
      router.push("/agrovet/dashboard");
    },
    [router]
  );

  // "apply", not "register" — an agrovet shop doesn't exist on the platform
  // yet, so this creates the shop application itself, in PENDING status.
  const apply = useCallback(
    async (form) => {
      const { data } = await agrovetApi.post("/agrovet-auth/apply", form);
      window.localStorage.setItem("embu_agrovet_token", data.token);
      window.localStorage.setItem("embu_agrovet_profile", JSON.stringify(data.shop));
      setShop(data.shop);
      router.push("/agrovet/dashboard");
    },
    [router]
  );

  const logout = useCallback(() => {
    window.localStorage.removeItem("embu_agrovet_token");
    window.localStorage.removeItem("embu_agrovet_profile");
    setShop(null);
    router.push("/agrovet/login");
  }, [router]);

  return (
    <AgrovetAuthContext.Provider value={{ shop, loading, login, apply, logout }}>
      {children}
    </AgrovetAuthContext.Provider>
  );
}

export function useAgrovetAuth() {
  const ctx = useContext(AgrovetAuthContext);
  if (!ctx) throw new Error("useAgrovetAuth must be used within AgrovetAuthProvider");
  return ctx;
}
