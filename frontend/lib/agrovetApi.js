import axios from "axios";
import { resolveApiBaseUrl } from "./apiBaseUrl";

// Deliberately separate from lib/api.js AND lib/memberApi.js: agrovet
// tokens live under their own localStorage key and are never sent on staff
// or farmer API calls — mirrors the backend's third, fully isolated
// authenticateAgrovet middleware and its own JWT "type" claim.
const agrovetApi = axios.create({
  baseURL: resolveApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL),
});

agrovetApi.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = window.localStorage.getItem("embu_agrovet_token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

agrovetApi.interceptors.response.use(
  (res) => res,
  (err) => {
    if (typeof window !== "undefined" && err?.response?.status === 401) {
      window.localStorage.removeItem("embu_agrovet_token");
      window.localStorage.removeItem("embu_agrovet_profile");
      if (window.location.pathname !== "/agrovet/login") {
        window.location.href = "/agrovet/login";
      }
    }
    return Promise.reject(err);
  }
);

export default agrovetApi;
