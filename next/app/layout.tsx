import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quadruped rig",
  description: "Image to Trellis model to Tripo quadruped rig.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
