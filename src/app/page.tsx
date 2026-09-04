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
    "When a buyer returns part of a multi-vendor order, Razorpay can't tell which Route transfer to reverse. ReturnSplit computes the exact per-seller paise, reverses the right transfers, then refunds the customer - behind human approval and a tamper-evident trail.",
};

export default function Home() {
  return (
    <main className={`lp-root ${display.variable} ${sans.variable} ${mono.variable}`}>
      <Landing />
    </main>
  );
}
