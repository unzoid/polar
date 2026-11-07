import { defineConfig, type Plugin } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

/** In dev, hand /api requests to the same Elysia app production uses. */
function elysiaDev(): Plugin {
  return {
    name: "elysia-dev",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        try {
          const { app } = await server.ssrLoadModule("/server/app.ts");
          const response: Response = await app.handle(
            new Request(new URL(req.url, "http://localhost"), { method: req.method }),
          );
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          next(error);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [solid(), tailwindcss(), elysiaDev()],
  build: {
    rollupOptions: {
      // One HTML page per route; served as /, /download/ and /roadmap/, and /watch/ and /party/ (#153).
      input: {
        home: "index.html",
        download: "download/index.html",
        roadmap: "roadmap/index.html",
        watch: "watch/index.html",
        party: "party/index.html",
      },
    },
  },
});
