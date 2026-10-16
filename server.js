/**
 * Plain-Node entry point, so this API can be self-hosted outside Cloudflare.
 *
 * `npm run dev` / `npm run deploy` are wrangler commands — they need a Cloudflare account
 * and put the service on Cloudflare's egress, which IMDb blocks (`/title/{id}/releaseinfo/`
 * answers `202` with a 0-byte body) and which `r.jina.ai` throttles with `429`. Running it
 * on your own host with `npm start` avoids both: requests leave from your IP and the API
 * key stays on your machine.
 *
 * Usage:
 *   JINA_API_KEY=... PORT=3010 npm start
 *
 * Deliberately dependency-free (`node:http` + the global fetch `Request`/`Response` that
 * Node 18+ provides): the obvious `@hono/node-server` adapter requires `hono >= 4` as a
 * peer, and this repo pins `hono@1.4.1`, so adding it made `npm install` fail with
 * ERESOLVE and the shipped Dockerfile could not build. The Dockerfile's
 * `CMD ["npm", "start"]` now resolves — it previously pointed at a `start` script that did
 * not exist in package.json.
 */
import http from "node:http";
import app from "./src/index.js";

const port = Number(process.env.PORT || 3000);
// 0.0.0.0 by default: inside a container the app must not bind its OWN loopback, or
// Docker's published-port proxy (`-p 127.0.0.1:3010:3000`) cannot reach it and every
// request fails to connect (measured: curl exit 000 while the log said "listening").
// Exposure is controlled by the port mapping, not by the bind address.
const host = process.env.HOST || "0.0.0.0";

const server = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = chunks.length ? Buffer.concat(chunks) : undefined;

    const request = new Request(
      `http://${req.headers.host || `${host}:${port}`}${req.url}`,
      {
        method: req.method,
        headers: req.headers,
        body,
      }
    );

    const response = await app.fetch(request, process.env, {});
    const headers = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: true, message: error.message }));
  }
});

server.listen(port, host, () => {
  console.log(`imdb-api listening on http://${host}:${port}`);
});
