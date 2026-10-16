import DomParser from "dom-parser";
import {
  apiRequestRawHtmlWithRetry,
} from "./apiRequestRawHtml.js";
import seriesFetcher, { getSeason } from "./seriesFetcher.js";
import {
  fetchFromGraphQL,
  buildResultFromGraphQL,
  fetchFromSuggestionAPI,
} from "./graphqlFallback.js";

// Parse __NEXT_DATA__ from HTML
function parseNextData(html) {
  try {
    const parser = new DomParser();
    const dom = parser.parseFromString(html);
    const nextData = dom.getElementsByAttribute(
      "id",
      "__NEXT_DATA__"
    );

    if (!nextData || !nextData.length) return null;

    const json = JSON.parse(nextData[0].textContent);
    return json.props?.pageProps || null;
  } catch (error) {
    console.error("parseNextData error:", error);
    return null;
  }
}

// Build result from HTML __NEXT_DATA__
function buildResultFromHTML(id, props) {
  const getCredits = (lookFor, v) => {
    const credits =
      props.aboveTheFoldData?.principalCredits || [];
    const result = credits.find(
      (e) => e?.category?.id === lookFor
    );
    if (!result) return [];
    return (
      result.credits?.map((e) => {
        if (!e?.name?.nameText?.text)
          return v === "2" ? { id: null, name: null } : null;
        return v === "2"
          ? {
              id: e.name.id || null,
              name: e.name.nameText.text,
            }
          : e.name.nameText.text;
      }) || []
    );
  };

  const aftd = props.aboveTheFoldData || {};
  const mainCol = props.mainColumnData || {};

  const getValidatedDate = (rd) => {
    if (!rd) return null;
    const year = parseInt(rd.year);
    const month = parseInt(rd.month);
    const day = parseInt(rd.day);
    if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31)
      return null;
    try {
      const date = new Date(Date.UTC(year, month - 1, day));
      const isValid =
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day;
      return isValid ? date.toISOString() : null;
    } catch {
      return null;
    }
  };

  return {
    id,
    review_api_path: `/reviews/${id}`,
    imdb: `https://www.imdb.com/title/${id}`,
    contentType: aftd.titleType?.id || null,
    contentRating: aftd.certificate?.rating || "N/A",
    isSeries: aftd.titleType?.isSeries || false,
    productionStatus:
      aftd.productionStatus?.currentProductionStage?.id || null,
    isReleased:
      aftd.productionStatus?.currentProductionStage?.id ===
      "released",
    title: aftd.titleText?.text || null,
    year: aftd.releaseYear?.year || null,
    originaltitle: aftd.originalTitleText?.text || null,
    image: aftd.primaryImage?.url || null,
    images: (mainCol.titleMainImages?.edges || [])
      .filter(
        (e) => e?.__typename === "ImageEdge" && e?.node?.url
      )
      .map((e) => e.node.url),
    plot: aftd.plot?.plotText?.plainText || "N/A",
    runtime:
      aftd.runtime?.displayableProperty?.value?.plainText || "",
    runtimeSeconds: aftd.runtime?.seconds || 0,
    rating: {
      count: aftd.ratingsSummary?.voteCount || 0,
      star: aftd.ratingsSummary?.aggregateRating || 0,
    },
    award: {
      wins: mainCol.wins?.total || 0,
      nominations: mainCol.nominations?.total || 0,
    },
    genre: (aftd.genres?.genres || [])
      .map((e) => e?.id)
      .filter(Boolean),
    releaseDetailed: {
      date: getValidatedDate(aftd.releaseDate),
      day: aftd.releaseDate?.day || null,
      month: aftd.releaseDate?.month || null,
      year: aftd.releaseDate?.year || null,
      releaseLocation: {
        country:
          mainCol.releaseDate?.country?.text || null,
        cca2: mainCol.releaseDate?.country?.id || null,
      },
      originLocations: (
        mainCol.countriesOfOrigin?.countries || []
      ).map((e) => ({
        country: e?.text || null,
        cca2: e?.id || null,
      })),
    },
    spokenLanguages: (
      mainCol.spokenLanguages?.spokenLanguages || []
    ).map((e) => ({
      language: e?.text || null,
      id: e?.id || null,
    })),
    filmingLocations: (
      mainCol.filmingLocations?.edges || []
    )
      .filter((e) => e?.node?.text)
      .map((e) => e.node.text),
    actors: getCredits("cast"),
    actors_v2: getCredits("cast", "2"),
    creators: getCredits("creator"),
    creators_v2: getCredits("creator", "2"),
    directors: getCredits("director"),
    directors_v2: getCredits("director", "2"),
    writers: getCredits("writer"),
    writers_v2: getCredits("writer", "2"),
    top_credits: (aftd.principalCredits || []).map((e) => ({
      id: e?.category?.id || null,
      name: e?.category?.text || null,
      credits: (e.credits || [])
        .map((c) => c?.name?.nameText?.text)
        .filter(Boolean),
    })),
    _source: "html",
  };
}

// Attach series data if needed
async function attachSeriesData(result, id) {
  if (!result.isSeries) return result;

  try {
    const seriesData = await seriesFetcher(id);
    return { ...result, ...seriesData };
  } catch (seriesError) {
    console.error(
      `Error fetching series data for ${id}:`,
      seriesError
    );
    return result;
  }
}

/**
 * Fetch the IMDb page through r.jina.ai and hand back its RAW HTML.
 *
 * IMDb answers datacenter egress with `202` and a 0-byte body (measured from this VPS *and*
 * from Cloudflare Workers), so before this the chain could only ever fall through to the
 * partial `suggestion_api` shape — where `originaltitle` merely echoes `title` and there are
 * no AKAs. r.jina.ai fetches from its own egress and, with `X-Return-Format: html`, returns
 * the page itself (measured 1,414,966 bytes containing `__NEXT_DATA__`), so
 * [`buildResultFromHTML()`](getTitle.js) — the same parser the direct path uses — produces a
 * COMPLETE record including the real `originaltitle`.
 *
 * The key is read from this host's environment/secret and is never sent to a client; the
 * anonymous route is rate-limited and currently answers 403, so a key is required for this
 * fallback to work at all.
 */
// In-process cache for the jina HTML fetches. The page is ~1.4 MB, i.e. a few hundred
// thousand tokens against the account's budget, so the same id must not be paid for twice
// in a row. (The Workers Cache API middleware in cache.js is a no-op on Node, so without
// this every repeat call re-spent tokens.)
const jinaHtmlCache = new Map(); // id -> { at, html }
const JINA_HTML_TTL_MS = 30 * 60 * 1000;
const JINA_HTML_CACHE_MAX = 20;

async function fetchFromJina(id, env) {
  const cached = jinaHtmlCache.get(id);
  if (cached && Date.now() - cached.at < JINA_HTML_TTL_MS) {
    return cached.html;
  }
  const key =
    (env && env.JINA_API_KEY) ||
    (typeof process !== "undefined" && process.env
      ? process.env.JINA_API_KEY
      : "");
  if (!key) {
    return null;
  }

  const res = await fetch(`https://r.jina.ai/https://www.imdb.com/title/${id}`, {
    headers: {
      authorization: `Bearer ${key}`,
      "x-return-format": "html",
      accept: "text/html",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    },
  });
  if (!res.ok) {
    throw new Error(`r.jina.ai http ${res.status}`);
  }
  const html = await res.text();
  if (!html.includes("__NEXT_DATA__")) {
    return null;
  }
  if (jinaHtmlCache.size >= JINA_HTML_CACHE_MAX) {
    jinaHtmlCache.delete(jinaHtmlCache.keys().next().value);
  }
  jinaHtmlCache.set(id, { at: Date.now(), html });
  return html;
}

// Main function - fallback chain
async function getTitle(id, env) {
  let result = null;

  // === METHOD 1: HTML Scraping with retry ===
  try {
    const html = await apiRequestRawHtmlWithRetry(
      `https://www.imdb.com/title/${id}`,
      1
    );

    if (html) {
      const props = parseNextData(html);
      if (props) {
        result = buildResultFromHTML(id, props);
        if (result && result.title) {
          return await attachSeriesData(result, id);
        }
      }
    }
  } catch (error) {
    console.error(`HTML scraping failed for ${id}:`, error.message);
  }

  // === METHOD 1b: the same page through r.jina.ai, as raw HTML ===
  // Runs before the GraphQL/suggestion fallbacks because those return less: the suggestion
  // shape has no real original title and no AKAs, and GraphQL is 403 from datacenter egress.
  try {
    const html = await fetchFromJina(id, env);
    if (html) {
      const props = parseNextData(html);
      if (props) {
        result = buildResultFromHTML(id, props);
        if (result && result.title) {
          result._source = "html_jina";
          return await attachSeriesData(result, id);
        }
      }
    }
  } catch (error) {
    console.error(`jina fallback failed for ${id}:`, error.message);
  }

  // === METHOD 2: GraphQL API ===
  try {
    console.log(`Trying GraphQL fallback for ${id}...`);
    const graphqlData = await fetchFromGraphQL(id);

    if (graphqlData) {
      result = buildResultFromGraphQL(id, graphqlData);
      if (result && result.title) {
        return await attachSeriesData(result, id);
      }
    }
  } catch (error) {
    console.error(`GraphQL failed for ${id}:`, error.message);
  }

  // === METHOD 3: Suggestion API (basic info) ===
  try {
    console.log(`Trying suggestion API fallback for ${id}...`);
    result = await fetchFromSuggestionAPI(id);

    if (result && result.title) {
      return await attachSeriesData(result, id);
    }
  } catch (error) {
    console.error(`Suggestion API failed for ${id}:`, error.message);
  }

  // === ALL METHODS FAILED ===
  return {
    id,
    error: true,
    message:
      "All fetch methods failed. IMDb may be blocking requests.",
  };
}

export { getTitle, getSeason };
