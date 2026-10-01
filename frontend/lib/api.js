import axios from "axios";
import { resolveApiBaseUrl } from "./apiBaseUrl";
import { sessionLoginPath } from "./portal";

const api = axios.create({
  baseURL: resolveApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL),
});

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = window.localStorage.getItem("embu_token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (typeof window !== "undefined" && err?.response?.status === 401) {
      // Send the user back to the door they came in through: the
      // Cooperative Portal for managers, the staff login for everyone else.
      const target = sessionLoginPath();
      window.localStorage.removeItem("embu_token");
      window.localStorage.removeItem("embu_user");
      // Never bounce a failed sign-in attempt off its own page.
      if (!["/login", "/cooperative/login"].includes(window.location.pathname)) {
        window.location.href = target;
      }
    }
    return Promise.reject(err);
  }
);

export default api;
