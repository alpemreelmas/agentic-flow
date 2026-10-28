import { defineConfig } from "vite";

// Tauri expects a fixed dev port and must see Rust errors, so don't clear the screen.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
});
