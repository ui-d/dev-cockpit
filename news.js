// DevCockpit — developer-news fetchers (Hacker News + Dev.to).
//
// Imported by app.js and run in page context. Both endpoints are keyless and
// CORS-friendly; their hosts are listed in manifest host_permissions so the
// extension page can fetch them directly (same approach as the weather pill).
// Each source is normalized to a common item shape so the feed renders uniformly.

const HN_URL = "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30";
const DEVTO_URL = "https://dev.to/api/articles?top=7&per_page=30";

/**
 * @typedef {{ id: string, title: string, url: string, commentsUrl: string,
 *   source: 'hn'|'devto', points: number, comments: number, author: string, time: number }} NewsItem
 */

/** @returns {Promise<NewsItem[]>} */
export async function fetchHackerNews() {
  const res = await fetch(HN_URL);
  if (!res.ok) throw new Error("hn_http_" + res.status);
  const json = await res.json();
  const hits = Array.isArray(json && json.hits) ? json.hits : [];
  return hits
    .filter((h) => h && (h.title || h.story_title))
    .map((h) => {
      const item = "https://news.ycombinator.com/item?id=" + h.objectID;
      return {
        id: "hn-" + h.objectID,
        title: h.title || h.story_title,
        url: h.url || h.story_url || item,
        commentsUrl: item,
        source: "hn",
        points: h.points || 0,
        comments: h.num_comments || 0,
        author: h.author || "",
        time: (h.created_at_i || 0) * 1000,
      };
    });
}

/** @returns {Promise<NewsItem[]>} */
export async function fetchDevTo() {
  const res = await fetch(DEVTO_URL);
  if (!res.ok) throw new Error("devto_http_" + res.status);
  const json = await res.json();
  const arr = Array.isArray(json) ? json : [];
  return arr
    .filter((a) => a && a.title && a.url)
    .map((a) => ({
      id: "devto-" + a.id,
      title: a.title,
      url: a.url,
      commentsUrl: a.url,
      source: "devto",
      points: a.positive_reactions_count || a.public_reactions_count || 0,
      comments: a.comments_count || 0,
      author: (a.user && (a.user.name || a.user.username)) || "",
      time: a.published_timestamp ? Date.parse(a.published_timestamp) : 0,
    }));
}

/**
 * Fetch every source in parallel. One source failing never sinks the others.
 * @returns {Promise<{ items: NewsItem[], errors: string[] }>}
 */
export async function fetchAllNews() {
  const settled = await Promise.allSettled([fetchHackerNews(), fetchDevTo()]);
  const labels = ["Hacker News", "Dev.to"];
  const items = [];
  const errors = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") items.push(...r.value);
    else errors.push(labels[i]);
  });
  items.sort((a, b) => (b.time || 0) - (a.time || 0));
  return { items, errors };
}
