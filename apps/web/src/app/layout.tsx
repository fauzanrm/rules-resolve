import type { Metadata } from "next";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "RuleResolve Beta",
  description: "Internal beta for RuleResolve",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
