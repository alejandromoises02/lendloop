import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { Header } from "@/components/Header";
import "./globals.css";

export const metadata: Metadata = {
  title: "LendLoop",
  description: "Borrow what you need. Lend what you don't.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ClerkProvider>
          <ConvexClientProvider>
            <Header />
            <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
          </ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
