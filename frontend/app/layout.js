import "./globals.css";
import { AuthProvider } from "../context/AuthContext";

export const metadata = {
  title: "Embu County Cooperative Management & Governance System",
  description: "Co-operative Development Section — Embu County Government",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
