import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Studio",
  description: "Create characters and explore interactive 3D environments.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
