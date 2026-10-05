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
  },
  app: {
    head: {
      htmlAttrs: { lang: 'th' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'color-scheme', content: 'light' },
      ],
      link: [
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
