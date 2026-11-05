import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { app as api } from "./app";

// Cloudflare Worker entry: the same /api routes the Vite dev server mounts.
export default new Elysia({ adapter: CloudflareAdapter }).use(api).compile();
