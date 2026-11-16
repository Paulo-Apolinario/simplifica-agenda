import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["assets/simplifica-perfil.png", "assets/simplifica-perfil.svg"],
      manifest: {
        name: "Simplifica Agenda",
        short_name: "Simplifica",
        description: "Agenda simples para o seu negócio.",
        theme_color: "#2563EB",
        background_color: "#F8FAFC",
        display: "standalone",
        orientation: "portrait-primary",
        start_url: "/",
        icons: [
          { src: "/assets/simplifica-perfil.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
          { src: "/assets/simplifica-perfil.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000" },
  },
});
