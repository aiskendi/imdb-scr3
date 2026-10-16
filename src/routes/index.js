import { Hono } from "hono";

// Metadata for the root response. This used to be
//     import packageJson from "../../package.json";
// which only works under a bundler: plain Node (the self-hosted `npm start`, i.e.
// server.js) rejects a JSON import without an import attribute on >= 20.10 with
// ERR_IMPORT_ATTRIBUTE_MISSING, and the esbuild inside this repo's pinned wrangler 3.22
// cannot parse `with { type: "json" }` ("Expected \";\" but found \"with\""). Reading npm's
// own environment is the one form both runtimes accept — `npm start` exports
// npm_package_* — with static fallbacks for the Worker, where they are absent.
// `typeof process` (not `process.env?.`) — on the Worker runtime `process` is not even
// defined at upload validation time, and a bare reference aborts the deploy with
// "Uncaught ReferenceError: process is not defined".
const NPM_ENV =
  typeof process !== "undefined" && process.env ? process.env : {};

const PKG = {
  name: NPM_ENV.npm_package_name || "imdb-scr3",
  description:
    NPM_ENV.npm_package_description ||
    "Serverless IMDB API powered by Cloudflare Worker",
  version: NPM_ENV.npm_package_version || "1.0.4",
  author: NPM_ENV.npm_package_author || "tuhinpal <me@thetuhin.com>",
  license: NPM_ENV.npm_package_license || "Apache-2.0",
  homepage:
    NPM_ENV.npm_package_homepage || "https://github.com/aiskendi/imdb-scr3",
};

const index = new Hono();

// NOTE: there is deliberately no generic r.jina.ai proxy route here. The r.jina.ai key is
// used INSIDE this app — [`fetchFromJina()`](helpers/getTitle.js) for `/title/{id}` and
// [`fetchViaProxy()`](helpers/akas.js) for `/title/{id}/akas` — so every consumer
// (imdb-scraper.php, the PencariMovie backend, any other addon) gets the data from this
// API and never needs a key, and no text-proxy is exposed to abuse.

index.get("/", async (c) => {
  return c.json({
    status: "Running",
    name: PKG.name,
    description: PKG.description,
    version: PKG.version,
    repository: PKG.homepage,
    author: PKG.author,
    license: PKG.license,
    postman:
      "https://www.postman.com/tuhin-pal/workspace/imdb-api/collection/12162111-12f08f8e-a76b-4cf4-a7b9-17cb9f95dd82?action=share&creator=12162111",
    postman_collection_json:
      "https://www.getpostman.com/collections/c261b9abc6b2a4b5f1c8",
  });
});

export default index;
