import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.RETURNSPLIT_APP_ORIGIN ?? "https://returnsplit.com"),
  title: { default: "ReturnSplit", template: "%s · ReturnSplit" },
  description: "Review, approve, and reconcile exact marketplace return reversals before the customer refund moves.",
  applicationName: "ReturnSplit",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: "/",
    siteName: "ReturnSplit",
    title: "ReturnSplit — Refund control for multi-seller orders",
    description: "Reverse the right seller transfer, balance every paise, and refund the buyer once.",
    images: [
      {
        url: "/social/returnsplit-share.png",
        width: 1200,
        height: 630,
        alt: "ReturnSplit marketplace refund control workbench",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@laziedev",
    creator: "@laziedev",
    title: "ReturnSplit — Refund control for multi-seller orders",
    description: "Reverse the right seller transfer, balance every paise, and refund the buyer once.",
    images: ["/social/returnsplit-share.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
