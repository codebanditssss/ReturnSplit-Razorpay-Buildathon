import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter, JetBrains_Mono } from "next/font/google";
import { Landing } from "@/components/landing/landing";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--lp-display",
  display: "swap",
});

const sans = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--lp-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--lp-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ReturnSplit",
  description:
    "A working Razorpay Route financial-control prototype for exact per-seller paise, named human approval, retry-safe execution, and a redacted process-local audit trail.",
};

export default function Home() {
  return (
    <main className={`lp-root ${display.variable} ${sans.variable} ${mono.variable}`}>
      <Landing />
    </main>
  );
}
