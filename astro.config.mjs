import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import db from "@astrojs/db";

export default defineConfig({
  output: "server",
  adapter: node({
    mode: "standalone",
  }),
  server: {
    host: true,
  },
  preview: {
    host: true,
  },
  integrations: [db()],
});
