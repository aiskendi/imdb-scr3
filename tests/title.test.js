const axios = require("axios");

test("test title route movie", async () => {
  let data = await axios.get("http://localhost:8787/title/tt8178634");

  expect(data.status).toBe(200);
  expect(data.data.contentType).toBe("Movie");
  expect(Array.isArray(data.data.rating.count)).not.toBe(0);
  expect(Array.isArray(data.data.rating.star)).not.toBe(0);
  expect(Array.isArray(data.data.year)).not.toBe(null);
  expect(Array.isArray(data.data.runtime)).not.toBe(null);
  expect(Array.isArray(data.data.actors)).toBe(true);
  expect(Array.isArray(data.data.directors)).toBe(true);
});

// IMDb throttles datacenter egress, so /title/{id}/akas may legitimately answer 502 with
// the reason in `_errors` (measured: releaseinfo 202 + empty body, GraphQL 403, and
// r.jina.ai 429 from Cloudflare Workers). The route itself is what is under test here:
// it must always answer JSON, and 200 must carry an `akas` array.
test("test title akas route", async () => {
  const res = await axios.get("http://localhost:8787/title/tt1801064/akas", {
    validateStatus: () => true,
  });

  expect([200, 502]).toContain(res.status);
  expect(res.headers["content-type"]).toContain("application/json");
  expect(Array.isArray(res.data.akas)).toBe(true);

  if (res.status === 200) {
    expect(res.data.akas.length > 0).toBe(true);
  } else {
    expect(Array.isArray(res.data._errors)).toBe(true);
  }
});

test("test title route tvseries", async () => {
  let data = await axios.get("http://127.0.0.1:8787/title/tt5491994");

  expect(data.status).toBe(200);
  expect(data.data.contentType).toBe("TVSeries");
  expect(Array.isArray(data.data.rating.count)).not.toBe(0);
  expect(Array.isArray(data.data.rating.star)).not.toBe(0);
  expect(Array.isArray(data.data.actors)).toBe(true);
  expect(Array.isArray(data.data.directors)).toBe(true);
  expect(Array.isArray(data.data.seasons)).toBe(true);
  expect(data.data.seasons.length > 0).toBe(true);
});
