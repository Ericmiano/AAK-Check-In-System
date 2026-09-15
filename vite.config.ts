// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  nitro: {
    // exceljs (~930KB) is only ever reached via a dynamic import() inside a
    // client-side button handler (Excel export), but the route module that
    // calls it is still part of the server-side route graph Nitro traces
    // (TanStack Start needs it registered server-side for routing even
    // though the route itself has ssr:false), so without this it gets
    // bundled into the deployed Worker and never used there. The client
    // build has its own separate Vite pipeline and keeps its own exceljs
    // chunk, loaded on demand in the browser as before.
    //
    // `rollupConfig` is a real nitro option that passes straight through
    // to the underlying `nitro()` plugin call — this wrapper's own type
    // just doesn't list it, hence the cast.
    rollupConfig: { external: ["exceljs"] },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see comment above: this wrapper's `nitro` type is narrower than what it actually forwards.
  } as any,
});
