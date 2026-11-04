import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import "../styles/nucleas-apps.css";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import OrganizationSetupCheck from "@/components/OrganizationSetupCheck";
import AppMobileShell from "@/components/AppMobileShell";
import { StructuredData } from "@/components/StructuredData";
import PostHogProvider from "@/components/analytics/PostHogProvider";
import AnalyticsScripts from "@/components/analytics/AnalyticsScripts";
import GoogleAnalytics from "@/components/analytics/GoogleAnalytics";
import PlatformGuideLayoutWrapper from "@/components/platformGuide/PlatformGuideLayoutWrapper";
import RecaptchaScript from "@/components/recaptcha/RecaptchaScript";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Nucleas — The Smart Operating System for Building and Running a Business",
    template: "%s | Nucleas",
  },
  description: "Nucleas is the smart operating system for building and running a business. Not another project manager — the business management layer that brings projects, team, content, meetings, and tools together. Build. Organize. Operate.",
  keywords: ["business management", "business operating system", "project management", "team management", "content planning", "meeting management", "startup tools", "business tools", "SaaS management"],
  authors: [{ name: "Nucleas" }],
  creator: "Nucleas",
  publisher: "Nucleas",
  icons: {
    icon: [{ url: '/images/nucleas-logo.png?v=5', type: 'image/png' }],
    shortcut: '/images/nucleas-logo.png?v=5',
    apple: '/images/nucleas-logo.png?v=5',
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL(process.env.NEXTAUTH_URL || 'https://nucleas.app'),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://nucleas.app',
    siteName: 'Nucleas',
    title: "Nucleas — The Smart Operating System for Building and Running a Business",
    description: "Not another project manager. Nucleas is the business management layer that brings projects, team, content, meetings, and tools together. Build. Organize. Operate.",
    images: [
      {
        url: '/images/nucleas-logo.png',
        width: 512,
        height: 512,
        alt: 'Nucleas — Business Operating System',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: "Nucleas — The Smart Operating System for Building and Running a Business",
    description: "Not another project manager. The business management layer that brings it all together. Build. Organize. Operate.",
    images: ['/images/nucleas-logo.png'],
    ...(process.env.NEXT_PUBLIC_TWITTER_SITE
      ? {
          site: process.env.NEXT_PUBLIC_TWITTER_SITE,
          creator: process.env.NEXT_PUBLIC_TWITTER_SITE,
        }
      : {}),
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const shellHeader = (await headers()).get('x-nucleas-shell');
  const isOsShell = shellHeader === 'os';
  const isMinimalShell = shellHeader === 'minimal';
  const isIdeShell = shellHeader === 'ide';
  const isBareShell = isOsShell || isMinimalShell;
  const baseUrl = process.env.NEXTAUTH_URL || 'https://nucleas.app';
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased flex flex-col min-h-screen${isOsShell ? ' nucleas-os' : ''}${isMinimalShell ? ' nucleas-minimal' : ''}${isIdeShell ? ' nucleas-ide overflow-hidden' : ''}`}
        suppressHydrationWarning
      >
        <StructuredData
          type="Organization"
          data={{
            name: 'Nucleas',
            url: baseUrl,
            logo: `${baseUrl}/images/nucleas-logo.png`,
            description: 'Nucleas is the smart operating system for building and running a business. The business management layer that brings projects, team, content, meetings, and tools together.',
            contactPoint: {
              '@type': 'ContactPoint',
              email: 'theteam@nucleas.app',
              contactType: 'Customer Service',
              url: `${baseUrl}/contact`,
            },
          }}
        />
        <RecaptchaScript />
        {!isMinimalShell && (
          <>
            <AnalyticsScripts />
            <GoogleAnalytics />
          </>
        )}
        <PostHogProvider>
          <PlatformGuideLayoutWrapper>
          <OrganizationSetupCheck>
            {isBareShell ? (
              children
            ) : (
              <>
                <Navigation />
                <AppMobileShell>
                  <main className={`flex-1 ${isIdeShell ? 'min-h-0 overflow-hidden pb-0' : 'pb-16 md:pb-0'}`}>
                    {children}
                  </main>
                  {!isIdeShell ? <Footer /> : null}
                </AppMobileShell>
              </>
            )}
          </OrganizationSetupCheck>
          </PlatformGuideLayoutWrapper>
        </PostHogProvider>
      </body>
    </html>
  );
}
