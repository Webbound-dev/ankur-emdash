import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Instagram Graph API (the old "Basic Display API" was shut down by Meta in
// Dec 2024) — requires the target account to be an Instagram Business or
// Creator account connected to a Facebook Page, and a Page access token
// with the instagram_basic permission. Generate one via a Meta Developer
// App: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api
const TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
const IG_USER_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
const GRAPH_VERSION = process.env.INSTAGRAM_GRAPH_VERSION || 'v21.0';
const POST_LIMIT = 6;
const DESTINATION = join('content', 'instagram-feed.json');

// No credentials configured — leave whatever's already on disk (or nothing)
// alone. gallery.astro falls back to the CMS-authored static posts in
// gallery.json when this file is missing, so local dev / a build without
// these secrets set still works, just without live posts.
if (!TOKEN || !IG_USER_ID) {
  console.log('Instagram credentials not set (INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_BUSINESS_ACCOUNT_ID) — skipping live feed fetch, using static fallback.');
  process.exit(0);
}

const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${IG_USER_ID}/media`);
url.searchParams.set('fields', 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp');
url.searchParams.set('limit', String(POST_LIMIT));
url.searchParams.set('access_token', TOKEN);

const res = await fetch(url);
if (!res.ok) {
  // Fail the build loudly rather than silently shipping a stale feed — a
  // misconfigured/expired token (these need refreshing roughly every 60
  // days) should surface immediately in CI, not go unnoticed for weeks.
  const body = await res.text();
  console.error(`Instagram Graph API request failed: ${res.status} ${res.statusText}\n${body}`);
  process.exit(1);
}

const data = await res.json();

const posts = (data.data ?? [])
  .filter((item) => item.media_type !== 'VIDEO' || item.thumbnail_url) // need a still image either way
  .slice(0, POST_LIMIT)
  .map((item) => ({
    src: item.media_type === 'VIDEO' ? item.thumbnail_url : item.media_url,
    alt: (item.caption ?? 'Ankur Salt on Instagram').slice(0, 140),
    permalink: item.permalink,
  }));

await mkdir(dirname(DESTINATION), { recursive: true });
await writeFile(DESTINATION, JSON.stringify({ posts, fetchedAt: new Date().toISOString() }, null, 2));
console.log(`Fetched ${posts.length} live Instagram posts -> ${DESTINATION}`);
