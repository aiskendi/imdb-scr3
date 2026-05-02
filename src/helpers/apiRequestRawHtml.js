async function apiRequestRawHtml(url) {
  let data = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ApleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0 Safari/537.36",
      accept: "text/html",
      "accept-language": "en-US",
    },
  });
  let text = await data.text();
  return text;
}

async function apiRequestJson(url) {
  let data = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      accept: "text/html",
      "accept-language": "en-US",
    },
  });
  let text = await data.json();
  return text;
}

async function apiRequestRawHtmlWithRetry(url, maxRetries = 1) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const html = await apiRequestRawHtml(url);
      if (html && html.includes("__NEXT_DATA__")) {
        return html;
      }
    } catch (error) {
      if (attempt === maxRetries) throw error;
    }
  }
  return await apiRequestRawHtml(url);
}

export default apiRequestRawHtml;
export { apiRequestJson, apiRequestRawHtmlWithRetry };
