import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";

// Dev needs 'unsafe-eval' for vite HMR tooling; production must not ship it.
function tightenCsp(): Plugin {
  return {
    name: "pi-tighten-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html
        .replace(" 'unsafe-eval'", "")
        .replace(
          /connect-src [^;]*;/,
          "connect-src 'self';",
        );
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "electron/main/index.ts"),
        },
      },
    },
  },
  preload: {
    // No externalizeDepsPlugin here: the preload must be a fully bundled CJS
    // file so it can run in a sandboxed renderer (no Node module resolution).
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "electron/preload/index.ts"),
          "plugin-panel": resolve(__dirname, "electron/preload/plugin-panel.ts"),
        },
        output: {
          format: "cjs",
          // Main window preload stays .cjs; plugin panels use .js as referenced by panel host.
          entryFileNames: (chunk) =>
            chunk.name === "plugin-panel" ? "[name].js" : "[name].cjs",
        },
      },
    },
  },
  renderer: {
    root: ".",
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "index.html"),
        },
      },
    },
    plugins: [react(), tailwindcss(), tightenCsp()],
    resolve: {
      alias: {
        "@renderer": resolve("src"),
      },
    },
  },
});
