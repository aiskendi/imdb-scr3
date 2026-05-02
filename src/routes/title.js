import { Hono } from "hono";
import { getTitle, getSeason } from "../helpers/getTitle.js";

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
