import { fileURLToPath } from 'node:url';

// Which engine tesseract.js loads in Node depends on its internals (today it picks the plain "simd" one), so ship all four.
const tesseractEngineFiles = ['tesseract-core-simd.wasm', 'tesseract-core.wasm', 'tesseract-core-simd-lstm.wasm', 'tesseract-core-lstm.wasm']
  .map((f) => fileURLToPath(new URL(`./node_modules/tesseract.js-core/${f}`, import.meta.url)));

export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  // Client-side rendering only: every Supabase call is made by the browser, which trusts the OS certificate store.
  // (Server-side rendering made Node call Supabase directly, which fails behind a TLS-inspecting firewall.)
  ssr: false,
  // The floating DevTools badge sits on top of the mobile tab bar while developing
  devtools: { enabled: false },
  devServer: {
    port: 3005,
  },
  modules: ['@nuxtjs/tailwindcss', '@nuxtjs/supabase'],
  css: ['~/assets/css/main.css'],
  supabase: {
    // reads SUPABASE_URL and SUPABASE_KEY (anon key) from env
    redirectOptions: { login: '/login', callback: '/', exclude: [] },
    // Keep the session cookie for a year (module default is 8 hours) so users stay logged in until they sign out.
    // The access token still refreshes itself in the background via the refresh token.
    cookieOptions: { maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' },
  },
  nitro: {
    preset: 'vercel',
    vercel: { functions: { maxDuration: 60 } }, // OCR can take several seconds
    // Tesseract's loader reads its .wasm engine from disk at run time, which Vercel's file tracing cannot see,
    // so the serverless function would be deployed without it. Include the engines explicitly.
    externals: { traceInclude: tesseractEngineFiles },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'th' },
      meta: [
        // viewport-fit=cover lets the page draw under the iPhone notch/home bar; the layout already pads with safe-area insets
        { name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover' },
        { name: 'color-scheme', content: 'light' },
        { name: 'theme-color', content: '#f5f5f7' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-title', content: 'Wealth' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
      ],
      link: [
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'icon', type: 'image/png', href: '/icons/icon-192.png' },
        { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          // Fallback for non-Apple devices; on macOS/iOS the system font (SF Pro) is used first.
          // media="print" + onload makes it NON-blocking: the page paints at once with the system font and the web
          // font swaps in when it arrives (a slow or filtered fonts.googleapis.com can no longer hold the page back).
          href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Noto+Sans+Thai:wght@400;500;600&display=swap',
          media: 'print',
          onload: "this.media='all'",
        },
      ],
    },
  },
});
