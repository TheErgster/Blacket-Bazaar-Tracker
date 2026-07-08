// ============================================================
// fetch.ts — Blacket Bazaar Price Tracker
// Runs on a schedule via GitHub Actions. Hits /worker/bazaar,
// finds the lowest listing price per item, and appends a
// timestamped snapshot to ../data/history.json
// ============================================================

import { BlacketClient } from "@softfault/blacketjs";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

// ── Auth ─────────────────────────────────────────────────────
// The cookie comes from GitHub Secrets (BLACKET_COOKIE).
// When your session expires (usually after a few days of inactivity),
// the Action will start failing. To fix: log into Blacket, grab the
// cookie from any request in your Network tab, update the secret.
const cookie = process.env.COOKIES;
if (!cookie) {
    throw new Error("Missing COOKIES env var — did you set the GitHub Secret?");
}

const client = new BlacketClient({ cookie });

// ── Fetch bazaar listings ────────────────────────────────────
// This is the raw endpoint the site itself calls. It returns a flat
// array of all current listings across all items — not grouped by item.
console.log("Fetching bazaar listings...");

const res = await client.get<{
    error: boolean;
    reason?: string;
    bazaar: Array<{
        id: number;
        item: string;     // blook name e.g. "Vampire Frog"
        price: number;    // listing price in tokens
        seller: string;   // username
        sellerId: number;
        date: number;     // unix timestamp (seconds)
    }>;
}>("/worker/bazaar");

if (res.error) {
    throw new Error(`Bazaar fetch failed: ${res.reason ?? "unknown error"}`);
}

console.log(`Got ${res.bazaar.length} listings`);

// ── Reduce listings → one price per item ────────────────────
// Multiple sellers can list the same item at different prices.
// We track TWO prices per item:
//   lowestAsk  = cheapest listing right now (best buy price)
//   avgPrice   = average across all listings (smooths out outliers)
// Both are useful — lowest is most "real", average is more stable.

const itemGroups: Record<string, number[]> = {};

for (const listing of res.bazaar) {
    if (!itemGroups[listing.item]) {
        itemGroups[listing.item] = [];
    }
    itemGroups[listing.item].push(listing.price);
}

const prices: Record<string, { lowestAsk: number; avgPrice: number; listingCount: number }> = {};

for (const [item, listings] of Object.entries(itemGroups)) {
    const sorted = listings.sort((a, b) => a - b);
    const avg = Math.round(listings.reduce((sum, p) => sum + p, 0) / listings.length);
    prices[item] = {
        lowestAsk: sorted[0],
        avgPrice: avg,
        listingCount: listings.length,
    };
}

console.log(`Processed ${Object.keys(prices).length} unique items`);

// ── Load existing history and append snapshot ────────────────
// history.json lives one level up in /data/history.json relative
// to this scripts/ folder. The path resolves to the repo root's /data/.
const historyPath = resolve("../data/history.json");

type Snapshot = {
    timestamp: number;
    prices: typeof prices;
};

let history: Snapshot[] = [];

if (existsSync(historyPath)) {
    try {
        history = JSON.parse(readFileSync(historyPath, "utf8"));
    } catch (e) {
        // If the file is corrupted or empty, start fresh. Not ideal but
        // better than crashing the whole pipeline.
        console.warn("Could not parse existing history.json, starting fresh:", e);
        history = [];
    }
}

// Add the new snapshot
history.push({
    timestamp: Date.now(), // milliseconds, easier for JS Date on the frontend
    prices,
});

// Keep the last 2016 snapshots (~6 weeks of 30-min snapshots).
// This keeps the JSON file from growing forever while still giving
// enough history to draw a meaningful chart.
const MAX_SNAPSHOTS = 2016;
if (history.length > MAX_SNAPSHOTS) {
    history = history.slice(-MAX_SNAPSHOTS);
}

writeFileSync(historyPath, JSON.stringify(history));

console.log(`Saved snapshot #${history.length} — ${Object.keys(prices).length} items tracked`);
