import { Hono } from "hono";
import { getTitle, getSeason } from "../helpers/getTitle.js";
import { getAkas } from "../helpers/akas.js";

const title = new Hono();

title.get("/:id", async (c) => {
  const id = c.req.param("id");

  // Validate IMDb ID format
  if (!id || !/^tt\d{7,}$/.test(id)) {
    c.status(400);
    return c.json({
      error: true,
      message:
        "Invalid IMDb title ID format. Expected: tt1234567",
    });
  }

  try {
    const result = await getTitle(id);

    // Return error status for failed requests
    if (result.error) {
      c.status(502);
      return c.json(result);
    }

    // Validate minimum required fields
    if (!result.title && !result.contentType) {
      c.status(502);
      return c.json({
        id,
        error: true,
        message: "Could not retrieve valid title data",
      });
    }

    return c.json(result);
  } catch (error) {
    c.status(500);
    return c.json({
      id,
      error: true,
      message: error.message,
    });
  }
});

/**
 * Alternate titles (AKA) for a title.
 *
 * `/title/{id}` alone cannot answer "what is this film called in its own language?":
 * `title` is the release title and `originaltitle` is frequently the same string.
 * Measured tt1801064 — `title`/`originaltitle` = "Superstition" (via the suggestion
 * fallback) while the AKA list carries `(original title) Khurafat: Perjanjian Syaitan`,
 * which is the name catalogues actually index the file under.
 *
 * @returns {{id:string,imdb:string,title:?string,originaltitle:?string,
 *            akas:Array<{text:string,country:?string,language:?string}>, _source:string}}
 *   `originaltitle` is the entry filed under `(original title)`; `akas` is the full
 *   list (country variants included). 502 when IMDb cannot be reached by either path.
 */
title.get("/:id/akas", async (c) => {
  const id = c.req.param("id");

  if (!id || !/^tt\d{7,}$/.test(id)) {
    c.status(400);
    return c.json({
      error: true,
      message: "Invalid IMDb title ID format. Expected: tt1234567",
    });
  }

  try {
    const result = await getAkas(id);
    const hasData = Boolean(result.originaltitle) || result.akas.length > 0;

    if (!hasData) {
      c.status(502);
      return c.json({
        id,
        imdb: `https://www.imdb.com/title/${id}`,
        releaseinfo_url: `https://www.imdb.com/title/${id}/releaseinfo/`,
        error: true,
        message: "Could not retrieve AKA data from IMDb",
        ...result,
      });
    }

    return c.json({
      id,
      imdb: `https://www.imdb.com/title/${id}`,
      releaseinfo_url: `https://www.imdb.com/title/${id}/releaseinfo/`,
      ...result,
    });
  } catch (error) {
    c.status(500);
    return c.json({ id, error: true, message: error.message });
  }
});

title.get("/:id/season/:seasonId", async (c) => {
  const id = c.req.param("id");
  const seasonId = c.req.param("seasonId");

  try {
    const result = await getSeason({ id, seasonId });
    const response = Object.assign(
      {
        id,
        title_api_path: `/title/${id}`,
        imdb: `https://www.imdb.com/title/${id}/episodes?season=${seasonId}`,
        season_id: seasonId,
      },
      result
    );
    return c.json(response);
  } catch (error) {
    c.status(500);
    return c.json({ message: error.message });
  }
});

export default title;
