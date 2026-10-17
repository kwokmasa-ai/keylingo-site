#!/usr/bin/env node
// Reddit lead finder for KeyLingo.
//
// Searches subreddits for posts where people ask about language switching,
// bilingual typing, or language-learning keyboards, and writes the results to
// JSON and CSV. Read-only: it never posts, votes, or messages anyone.
//
// Uses Reddit's official API with app-only OAuth (client_credentials grant).
// Create a "script" app at https://www.reddit.com/prefs/apps, then set:
//   REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT
//
// Usage:
//   node scripts/reddit-scraper.mjs
//   node scripts/reddit-scraper.mjs --subs languagelearning,ios --keywords "keyboard,typing" --pages 2
//
// Requires Node 18+ (uses global fetch). No dependencies.

import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SUBS = ["languagelearning", "bilingual", "ios", "iphone", "learnlanguages"];
const DEFAULT_KEYWORDS = [
  "keyboard language switch",
  "type in two languages",
  "translate while typing",
  "bilingual keyboard",
  "keyboard learn language",
];

const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {
    subs: DEFAULT_SUBS,
    keywords: DEFAULT_KEYWORDS,
    time: "month",
    pages: 1,
    out: join(here, "output"),
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--subs") args.subs = value.split(",").map((s) => s.trim()).filter(Boolean), i++;
    else if (flag === "--keywords") args.keywords = value.split(",").map((s) => s.trim()).filter(Boolean), i++;
    else if (flag === "--time") args.time = value, i++;
    else if (flag === "--pages") args.pages = Math.max(1, Number(value) || 1), i++;
    else if (flag === "--out") args.out = value, i++;
    else throw new Error(`Unknown argument: ${flag}`);
  }
  return args;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Create a script app at https://www.reddit.com/prefs/apps and set it.`);
  }
  return value;
}

async function getAccessToken(clientId, clientSecret, userAgent) {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgent,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Token request failed: HTTP ${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token response had no access_token: ${JSON.stringify(data)}`);
  return data.access_token;
}

// Reddit allows about 100 requests per minute per OAuth client. Wait when the
// window is nearly used up so we don't get 429s.
async function respectRateLimit(res) {
  const remaining = Number(res.headers.get("x-ratelimit-remaining"));
  const resetSeconds = Number(res.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(remaining) && remaining < 2 && resetSeconds > 0) {
    await new Promise((resolve) => setTimeout(resolve, (resetSeconds + 1) * 1000));
  }
}

async function searchSubreddit({ token, userAgent, sub, query, time, pages }) {
  const posts = [];
  let after = null;
  for (let page = 0; page < pages; page++) {
    const params = new URLSearchParams({
      q: query,
      restrict_sr: "1",
      sort: "new",
      t: time,
      type: "link",
      limit: "100",
      raw_json: "1",
    });
    if (after) params.set("after", after);

    const res = await fetch(`https://oauth.reddit.com/r/${sub}/search?${params}`, {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": userAgent },
    });
    await respectRateLimit(res);
    if (!res.ok) {
      console.warn(`  r/${sub} "${query}" page ${page + 1}: HTTP ${res.status}, skipping`);
      break;
    }

    const listing = await res.json();
    for (const child of listing.data.children) {
      const d = child.data;
      posts.push({
        id: d.id,
        subreddit: d.subreddit,
        title: d.title,
        body: (d.selftext || "").slice(0, 500),
        author: d.author,
        url: `https://www.reddit.com${d.permalink}`,
        created: new Date(d.created_utc * 1000).toISOString(),
        score: d.score,
        comments: d.num_comments,
        matched_query: query,
      });
    }

    after = listing.data.after;
    if (!after) break;
  }
  return posts;
}

function toCsv(rows) {
  const columns = ["id", "subreddit", "title", "body", "author", "url", "created", "score", "comments", "matched_query"];
  const escape = (value) => {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((c) => escape(row[c])).join(","));
  return lines.join("\n") + "\n";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const clientId = requireEnv("REDDIT_CLIENT_ID");
  const clientSecret = requireEnv("REDDIT_CLIENT_SECRET");
  const userAgent = requireEnv("REDDIT_USER_AGENT");

  const token = await getAccessToken(clientId, clientSecret, userAgent);
  const seen = new Map();

  for (const sub of args.subs) {
    for (const query of args.keywords) {
      console.log(`Searching r/${sub} for "${query}"`);
      const posts = await searchSubreddit({ token, userAgent, sub, query, time: args.time, pages: args.pages });
      for (const post of posts) {
        // A post can match several keywords. Keep the first match only.
        if (!seen.has(post.id)) seen.set(post.id, post);
      }
    }
  }

  const results = [...seen.values()].sort((a, b) => b.created.localeCompare(a.created));
  const stamp = new Date().toISOString().slice(0, 10);
  await mkdir(args.out, { recursive: true });
  const base = join(args.out, `reddit-leads-${stamp}`);
  await writeFile(`${base}.json`, JSON.stringify(results, null, 2) + "\n");
  await writeFile(`${base}.csv`, toCsv(results));

  console.log(`\nSaved ${results.length} unique posts to ${base}.json and ${base}.csv`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
