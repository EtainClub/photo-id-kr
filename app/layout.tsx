import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteUrl = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://korean-passport-photo.jollygood.chatgpt.site");

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: "여권사진 준비 | 찍기 전에 규격을 맞춰보세요",
  description: "촬영 가이드부터 규격 점검, 온라인 제출용 파일까지 한국 여권사진을 한 번에 준비하세요.",
  applicationName: "여권사진 준비",
  alternates: {
    canonical: "/"
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: "/icon.svg"
  },
  manifest: "/app/manifest.webmanifest",
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: "/",
    siteName: "여권사진 준비",
    title: "여권사진 준비 | 찍기 전에 규격을 맞춰보세요",
    description: "촬영 가이드부터 규격 점검, 온라인 제출용 파일까지 한 번에 준비해요.",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "스마트폰에서 여권사진 규격을 확인하는 여권사진 준비 서비스"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "여권사진 준비 | 찍기 전에 규격을 맞춰보세요",
    description: "촬영 가이드부터 규격 점검, 온라인 제출용 파일까지 한 번에 준비해요.",
    images: ["/og.png"]
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f5f5f7"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
