import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { resolveMetadataBase } from "@/lib/canonical-host";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  // Resolve absolute URLs against the pinned canonical origin rather than the
  // request headers, so a forged x-forwarded-host cannot rewrite the OG and
  // canonical URLs. Only the Cloudflare-validated Host can opt into a local
  // base, which keeps `npm run dev` resolving assets against localhost.
  const requestHeaders = await headers();
  const metadataBase = resolveMetadataBase(requestHeaders.get("host"));
  const title = "Runway | Your always-on financial operations agent";
  const description =
    "An always-on financial operations agent for Australian sole traders.";

  return {
    metadataBase,
    title,
    description,
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title,
      description,
      type: "website",
      images: [
        {
          url: "/og-runway.png",
          width: 1734,
          height: 907,
          alt: "Runway — know what is cash and what is coming.",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og-runway.png"],
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#f5f1e8",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
