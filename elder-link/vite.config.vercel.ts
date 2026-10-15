// Vercel build configuration.
// The default vite.config.ts uses the Lovable preset (Nitro targets Cloudflare).
// Vercel builds with:  vite build --config vite.config.vercel.ts
// which uses the standard TanStack Start plugins and Nitro's Vercel preset.
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";

export default defineConfig({
  plugins: [
    tsconfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    tanstackStart({ server: { entry: "server" } }),
    viteReact(),
    nitro({
      preset: "vercel",
      // Nitro wipes its output directory before building. On Windows a
      // filesystem guard intercepts that bulk delete and aborts the build
      // ("SAFE_DELETE_BULK_CONFIRM_REQUIRED"). Pointing each build at a
      // timestamped directory avoids the delete entirely; Vercel reads the
      // location from .vercel/output, which the deploy step writes itself.
      output: {
        dir: process.env["NITRO_OUTPUT_DIR"] ?? ".vercel/output",
      },
    }),
  ],
});
