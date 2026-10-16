/**
 * Write the resolved identity (imdb id + alternate title) back into WordPress'
 * `media_ids_idx`, so callers never have to spend their own `/media-ids` round-trip just to
 * store an aka.
 *
 * Both services run on the same VPS, so this is a server-to-server call and the secret never
 * reaches a client: `WP_API_BASE` + `WP_API_SECRET` come from the container environment
 * (`run.sh` reads them out of 0600 files).
 *
 * Two rules keep it safe:
 *   * it is skipped unless BOTH base and secret are configured, so the Worker deployment and
 *     a bare local run stay read-only;
 *   * the write is idempotent and skipped for values already written in this process, because
 *     the endpoint is a synchronous WordPress call.
 *
 * NOTE the `year` matters: the upsert writes the year column, and a 0 there would break the
 * ±1-year file matcher for that title, so a write without a known year is refused.
 */

const NPM_ENV =
  typeof process !== "undefined" && process.env ? process.env : {};

const written = new Set(); // "tt1234|aka" keys persisted in this process

function wpBase(env) {
  const base = (env && env.WP_API_BASE) || NPM_ENV.WP_API_BASE || "";
  return String(base).replace(/\/+$/, "");
}

function wpSecret(env) {
  return (env && env.WP_API_SECRET) || NPM_ENV.WP_API_SECRET || "";
}

export function mediaIdsConfigured(env) {
  return Boolean(wpBase(env) && wpSecret(env));
}

/**
 * @returns {Promise<boolean>} true when the row now carries this data (or was already known).
 */
export async function persistMediaIds(
  { imdbId, title = "", year = "", aka = "", type = "movie" },
  env
) {
  const imdb = String(imdbId || "").trim();
  if (!imdb || !/^tt\d{6,10}$/.test(imdb)) {
    return false;
  }
  const base = wpBase(env);
  const secret = wpSecret(env);
  if (!base || !secret) {
    return false;
  }

  const numericYear = Number.parseInt(String(year), 10) || 0;
  if (numericYear === 0) {
    // See the note above — never write a row with year 0.
    return false;
  }

  const key = `${imdb}|${aka}`;
  if (written.has(key)) {
    return true;
  }

  const numeric = Number(imdb.replace(/\D/g, "")) % 1000000000;
  const payload = {
    // Same pseudo post ids the PencariMovie backend uses for ids with no catalog post.
    post_id: 9000000000 + numeric,
    media_ids: { imdb, tt: imdb },
    title: String(title || "").trim() || imdb,
    year: numericYear,
    imdb_id: imdb,
    media_type: /series|tv/i.test(String(type)) ? "tvseries" : "movie",
    aka: String(aka || "").trim(),
  };

  try {
    const res = await fetch(`${base}/media-ids`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-secret": secret,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`media-ids write failed for ${imdb}: http ${res.status}`);
      return false;
    }
    written.add(key);
    return true;
  } catch (error) {
    console.error(`media-ids write failed for ${imdb}: ${error.message}`);
    return false;
  }
}
