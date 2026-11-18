import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  server: {
    proxy: {
      "/api": {
        target:
          "https://rankup-api-h7gecre8b2f4f0e2.eastasia-01.azurewebsites.net",
        secure: false,
        changeOrigin: true,
      },
    },
  },
  plugins: [react(), tailwindcss()],
});
