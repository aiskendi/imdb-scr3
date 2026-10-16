import DomParser from "dom-parser";
// Explicit `.js`: plain Node ESM (the self-hosted `npm start`) does not do extension
// resolution, so an extensionless specifier is ERR_MODULE_NOT_FOUND at boot.
import apiRequestRawHtml from "./apiRequestRawHtml.js";

export default async function seriesFetcher(id) {
  try {
    const firstSeason = await getSeason({ id, seasonId: 1 });

    return {
      all_seasons: firstSeason.all_seasons,
      seasons: [
        {
          ...firstSeason,
          all_seasons: undefined,
        },
      ],
    };
  } catch (error) {
    return {
      all_seasons: [],
      seasons: [],
    };
  }
}

export async function getSeason({ id, seasonId }) {
  const html = await apiRequestRawHtml(
    `https://www.imdb.com/title/${id}/episodes?season=${seasonId}`
  );

  let parser = new DomParser();
  let dom = parser.parseFromString(html);

  const nextData = dom.getElementsByAttribute("id", "__NEXT_DATA__");
  const json = JSON.parse(nextData[0].textContent);

  const episodes = json.props.pageProps.contentData.section.episodes.items;
  const seasons = json.props.pageProps.contentData.section.seasons;

  return {
    name: json.props.pageProps.contentData.entityMetadata.titleText.text,
    episodes: Object.values(episodes).map((e, i) => {
      return {
        idx: i + 1,
        no: e.episode,
        title: e.titleText,
        image: e.image.url,
        image_large: e.image.url,
        image_caption: e.image.caption,
        plot: e.plot,
        publishedDate: new Date(
          e.releaseDate.year,
          e.releaseDate.month - 1,
          e.releaseDate.day
        ).toISOString(),
        rating: {
          count: e.voteCount,
          star: e.aggregateRating,
        },
      };
    }),
    all_seasons: seasons.map((s) => ({
      id: s.value,
      name: `Season ${s.value}`,
      api_path: `/title/${id}/season/${s.value}`,
    })),
  };
}
