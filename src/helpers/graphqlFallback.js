// Direct call to IMDb's GraphQL API - works on Cloudflare Workers
async function fetchFromGraphQL(id) {
  const query = `
    query GetTitleInfo($id: ID!) {
      title(id: $id) {
        id
        titleText { text }
        originalTitleText { text }
        titleType { id isSeries isEpisode text }
        releaseYear { year endYear }
        releaseDate { day month year }
        runtime { seconds displayableProperty { value { plainText } } }
        certificate { rating }
        ratingsSummary { aggregateRating voteCount }
        plot { plotText { plainText } language { id } }
        primaryImage { url caption { plainText } }
        genres { genres { id text } }
        principalCredits {
          category { id text }
          credits {
            name { id nameText { text } }
          }
        }
        productionStatus {
          currentProductionStage { id text }
        }
        countriesOfOrigin {
          countries { id text }
        }
        spokenLanguages {
          spokenLanguages { id text }
        }
      }
    }
  `;

  try {
    const response = await fetch("https://api.graphql.imdb.com/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ApleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        "x-amzn-sessionid": "000-0000000",
      },
      body: JSON.stringify({
        query,
        variables: { id },
      }),
    });

    if (!response.ok) {
      return null;
    }

    const json = await response.json();
    return json?.data?.title || null;
  } catch (error) {
    console.error("GraphQL fallback error:", error);
    return null;
  }
}

function buildResultFromGraphQL(id, data) {
  if (!data) return null;

  const getCredits = (lookFor) => {
    const credits = data.principalCredits || [];
    const found = credits.find((e) => e?.category?.id === lookFor);
    if (!found) return [];
    return (
      found.credits
        ?.map((e) => e?.name?.nameText?.text)
        .filter(Boolean) || []
    );
  };

  const getCreditsV2 = (lookFor) => {
    const credits = data.principalCredits || [];
    const found = credits.find((e) => e?.category?.id === lookFor);
    if (!found) return [];
    return (
      found.credits?.map((e) => ({
        id: e?.name?.id || null,
        name: e?.name?.nameText?.text || null,
      })) || []
    );
  };

  const rd = data.releaseDate;
  let releaseISO = null;
  if (rd?.year && rd?.month && rd?.day) {
    try {
      const date = new Date(Date.UTC(rd.year, rd.month - 1, rd.day));
      releaseISO = date.toISOString();
    } catch {
      releaseISO = null;
    }
  }

  return {
    id,
    review_api_path: `/reviews/${id}`,
    imdb: `https://www.imdb.com/title/${id}`,
    contentType: data.titleType?.id || null,
    contentRating: data.certificate?.rating || "N/A",
    isSeries: data.titleType?.isSeries || false,
    productionStatus:
      data.productionStatus?.currentProductionStage?.id || null,
    isReleased:
      data.productionStatus?.currentProductionStage?.id ===
      "released",
    title: data.titleText?.text || null,
    year: data.releaseYear?.year || null,
    originaltitle: data.originalTitleText?.text || null,
    image: data.primaryImage?.url || null,
    images: data.primaryImage?.url ? [data.primaryImage.url] : [],
    plot: data.plot?.plotText?.plainText || "N/A",
    runtime:
      data.runtime?.displayableProperty?.value?.plainText || "",
    runtimeSeconds: data.runtime?.seconds || 0,
    rating: {
      count: data.ratingsSummary?.voteCount || 0,
      star: data.ratingsSummary?.aggregateRating || 0,
    },
    award: { wins: 0, nominations: 0 },
    genre: (data.genres?.genres || [])
      .map((e) => e?.id)
      .filter(Boolean),
    releaseDetailed: {
      date: releaseISO,
      day: rd?.day || null,
      month: rd?.month || null,
      year: rd?.year || null,
      releaseLocation: { country: null, cca2: null },
      originLocations: (
        data.countriesOfOrigin?.countries || []
      ).map((e) => ({
        country: e?.text || null,
        cca2: e?.id || null,
      })),
    },
    spokenLanguages: (
      data.spokenLanguages?.spokenLanguages || []
    ).map((e) => ({
      language: e?.text || null,
      id: e?.id || null,
    })),
    filmingLocations: [],
    actors: getCredits("cast"),
    actors_v2: getCreditsV2("cast"),
    creators: getCredits("creator"),
    creators_v2: getCreditsV2("creator"),
    directors: getCredits("director"),
    directors_v2: getCreditsV2("director"),
    writers: getCredits("writer"),
    writers_v2: getCreditsV2("writer"),
    top_credits: (data.principalCredits || []).map((e) => ({
      id: e?.category?.id || null,
      name: e?.category?.text || null,
      credits: (e.credits || [])
        .map((c) => c?.name?.nameText?.text)
        .filter(Boolean),
    })),
    _source: "graphql",
  };
}

// Suggestion API - most reliable fallback
async function fetchFromSuggestionAPI(id) {
  try {
    const response = await fetch(
      `https://v3.sg.media-imdb.com/suggestion/x/${id}.json?includeVideos=0`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        },
      }
    );

    if (!response.ok) return null;

    const data = await response.json();
    const item = data?.d?.find((d) => d.id === id);
    if (!item) return null;

    return {
      id,
      review_api_path: `/reviews/${id}`,
      imdb: `https://www.imdb.com/title/${id}`,
      contentType: item.qid || null,
      contentRating: "N/A",
      isSeries: item.qid === "tvSeries",
      productionStatus: null,
      isReleased: true,
      title: item.l || null,
      year: item.y || null,
      originaltitle: item.l || null,
      image: item.i?.imageUrl || null,
      images: item.i?.imageUrl ? [item.i.imageUrl] : [],
      plot: "N/A",
      runtime: "",
      runtimeSeconds: 0,
      rating: { count: 0, star: 0 },
      award: { wins: 0, nominations: 0 },
      genre: [],
      releaseDetailed: {
        date: null,
        day: null,
        month: null,
        year: item.y || null,
        releaseLocation: { country: null, cca2: null },
        originLocations: [],
      },
      spokenLanguages: [],
      filmingLocations: [],
      actors: (item.s || "").split(", ").filter(Boolean),
      actors_v2: [],
      creators: [],
      creators_v2: [],
      directors: [],
      directors_v2: [],
      writers: [],
      writers_v2: [],
      top_credits: [],
      _partial: true,
      _source: "suggestion_api",
    };
  } catch {
    return null;
  }
}

export {
  fetchFromGraphQL,
  buildResultFromGraphQL,
  fetchFromSuggestionAPI,
};
