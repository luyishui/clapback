import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: false,
    copyPublicDir: false,
    lib: {
      entry: "src/content/main.ts",
      name: "ClapbackContent",
      formats: ["iife"],
      fileName: () => "assets/content.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
