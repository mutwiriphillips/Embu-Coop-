import { AgrovetAuthProvider } from "../../context/AgrovetAuthContext";

export const metadata = {
  title: "Agrovet Portal — Input Supply & Reimbursement",
  description: "Record farmer input collections and track reimbursement status.",
};

export default function AgrovetLayout({ children }) {
  return <AgrovetAuthProvider>{children}</AgrovetAuthProvider>;
}
