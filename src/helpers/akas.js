/**
 * Alternate (AKA) titles for a title id.
 *
 * Why this exists: `/title/{id}` returns `title` and `originaltitle`, which for a
 * non-English film are NOT interchangeable — IMDb keeps the release title in `title`
 * and the film's own (original) title separately. Measured on tt1801064:
 *
 *   title        = "Superstition"          (US/UK release title)
 *   originaltitle = "Khurafat: Perjanjian Syaitan"
 *
 * Consumers that index files named after the original title (e.g. Telegram catalogues
 * with `Khurafat.Perjanjian.Syaitan.2011...mkv`) need the original title + the full AKA
 * list, which `title`/`originaltitle` alone do not give (there are also country variants
 * like "Superstition (English)").
 *
 * IMDb itself is unreliable from datacenter egress (Cloudflare Workers included): the
 * releaseinfo page answers `202` with an empty body or a challenge page. Two sources are
 * therefore tried in order:
 *   1. the page's `__NEXT_DATA__` (`mainColumnData.akas.edges`), when the fetch works;
 *   2. the same page through the text-extraction proxy `https://r.jina.ai/<url>`, which
 *      returns it as markdown — the AKA list survives the conversion verbatim.
 *
 * Measured (tt1801064) — 200 from the proxy, section content:
 *     Also known as (AKA)
 *     *   (original title)
 *         *   Khurafat: Perjanjian Syaitan
 *     *   United Kingdom
 *         *   Superstition
 *     *   United States
 *         *   Superstition
 *     *   World-wide
 *         *   Superstition (English)
 */

import apiRequestRawHtml from "./apiRequestRawHtml.js";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0 Safari/537.36";

const RELEASEINFO_URL = (id) =>
  `https://www.imdb.com/title/${id}/releaseinfo/`;

/**
 * Pull `props.pageProps` out of an IMDb page's `__NEXT_DATA__` script tag.
 * Uses a regex rather than a DOM parser: the payload is one script tag and this keeps
 * the helper free of parser dependencies (the page is 1-2 MB).
 */
export function extractNextData(html) {
  if (!html || typeof html !== "string") return null;
  const match = html.match(
    /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1])?.props?.pageProps || null;
  } catch {
    return null;
  }
}

/** Build the AKA payload from an IMDb `__NEXT_DATA__` props object. */
export function parseNextDataAkas(props) {
  if (!props) return null;
  const aftd = props.aboveTheFoldData || {};
  const main = props.mainColumnData || {};
  const edges = main.akas?.edges || aftd.akas?.edges || [];
  const akas = edges
    .map((e) => ({
      text: e?.node?.text || null,
      country: e?.node?.country?.text || e?.node?.country?.id || null,
      language: e?.node?.language?.text || e?.node?.language?.id || null,
    }))
    .filter((a) => a.text);
  const originaltitle = aftd.originalTitleText?.text || null;
  const title = aftd.titleText?.text || null;
  if (!originaltitle && !akas.length) return null;
  return { title, originaltitle, akas };
}

/**
 * Parse the AKA section out of the markdown rendering of the releaseinfo page.
 * Group headings (`*   United Kingdom`) carry no indentation; alias titles are nested
 * (`    *   Superstition`). `(original title)` is itself a group heading.
 */
export function parseAkasMarkdown(text) {
  if (!text || typeof text !== "string") return null;
  const start = text.indexOf("Also known as");
  if (start < 0) return null;
  let section = text.slice(start);
  const nextHeading = section.slice(1).search(/\n#{1,6}\s/);
  if (nextHeading >= 0) section = section.slice(0, nextHeading + 1);

  const akas = [];
  let group = null;
  for (const rawLine of section.split("\n")) {
    const match = rawLine.match(/^(\s*)\*\s+(.+?)\s*$/);
    if (!match) continue;
    const value = match[2].trim();
    if (!value || value.startsWith("[")) continue; // skip links ("Contribute to this page")
    if (match[1].length >= 2) {
      akas.push({ text: value, country: group, language: null });
    } else {
      group = value;
    }
  }
  if (!akas.length) return null;
  const original = akas.find((a) => (a.country || "").toLowerCase() === "(original title)");
  return {
    title: null,
    originaltitle: original ? original.text : null,
    akas,
  };
}

async function fetchDirect(id) {
  const html = await apiRequestRawHtml(RELEASEINFO_URL(id));
  if (!html || !html.includes("__NEXT_DATA__")) {
    throw new Error(`no __NEXT_DATA__ (html length ${html ? html.length : 0})`);
  }
  const parsed = parseNextDataAkas(extractNextData(html));
  if (!parsed) throw new Error("__NEXT_DATA__ present but no akas/originalTitle");
  return parsed;
}

/**
 * Authenticated proxy call. The API key matters: anonymous r.jina.ai answers **429** to
 * Cloudflare Workers egress (shared datacenter IPs), which is what this route used to
 * return. The key is a worker SECRET (`wrangler secret put JINA_API_KEY`), exposed either
 * as `env.JINA_API_KEY` (Hono context) or `process.env.JINA_API_KEY` (nodejs_compat).
 */
async function fetchViaProxy(id, env) {
  const headers = { "User-Agent": BROWSER_UA, accept: "text/plain" };
  const key =
    (env && env.JINA_API_KEY) ||
    (typeof process !== "undefined" && process.env
      ? process.env.JINA_API_KEY
      : "");
  if (key) headers.Authorization = `Bearer ${key}`;

  const res = await fetch(`https://r.jina.ai/${RELEASEINFO_URL(id)}`, {
    headers,
  });
  if (!res.ok) throw new Error(`proxy http ${res.status}`);
  const text = await res.text();
  if (!text || text.length < 200) {
    throw new Error(`proxy short body ${text ? text.length : 0}`);
  }
  const parsed = parseAkasMarkdown(text);
  if (!parsed) throw new Error(`proxy body has no AKA section (length ${text.length})`);
  return parsed;
}

/**
 * Both sources failing is normal when IMDb throttles the worker (see the file header),
 * so the failure detail is returned rather than swallowed — it is what a caller needs to
 * decide whether to retry, and what an operator needs to see in the response.
 *
 * @returns {Promise<{title:?string,originaltitle:?string,akas:Array,_source:string,_errors?:string[]}>}
 */
async function getAkas(id, env) {
  const errors = [];

  try {
    const direct = await fetchDirect(id);
    return { ...direct, _source: "releaseinfo" };
  } catch (error) {
    errors.push("direct: " + error.message);
  }

  try {
    const proxied = await fetchViaProxy(id, env);
    return { ...proxied, _source: "releaseinfo_proxy" };
  } catch (error) {
    errors.push("proxy: " + error.message);
  }

  return { title: null, originaltitle: null, akas: [], _source: "none", _errors: errors };
}

export { getAkas };
