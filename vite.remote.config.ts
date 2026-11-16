/// <reference types="vitest/config" />
// The phone app is a separate, tiny site: static files served from
// olittechnologies.co.in/remote/, with no Tauri and none of the desktop app's code.
// Its own config keeps it that way -- it can't accidentally pull in the desktop bundle.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "remote",
  base: "/remote/",
  plugins: [react()],
  build: {
    outDir: "../dist-remote",
    emptyOutDir: true,
    target: "es2020", // older phones still get a working page
    sourcemap: false,
  },
});
