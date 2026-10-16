import config from "../../config.js";

async function cache(c, next) {
  // The Cache API exists on Cloudflare Workers only. When this app runs on plain Node
  // (server.js, i.e. the self-hosted deployment) `caches` is undefined, and without this
  // guard every single request fails with "caches is not defined".
  if (typeof caches === "undefined" || !caches.default) {
    return await next();
  }

  const key = c.req.url;
  const cacheStore = await caches.default;
  const response = await cacheStore.match(key);

  function getCacheTTL() {
    try {
      let url = key.toString().toLowerCase();
      if (url.includes("/reviews")) return 60 * 60 * 24;
      if (url.includes("/title")) return 60 * 24;
      if (url.includes("/search")) return 60 * 60 * 24 * 2;
    } catch (_) {}
    return 86400;
  }

  if (!response) {
    await next();
    if (c.res.status === 200 && !config.cacheDisabled) {
      c.res.headers.append(
        "Cache-Control",
        `public, max-age=${getCacheTTL()}`
      );
      await cacheStore.put(key, c.res.clone());
    }
    return;
  } else {
    for (let [k, value] of response.headers.entries()) {
      c.res.headers.set(k, value);
    }
    return c.json(await response.json());
  }
}

export default cache;
