
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";


const cookie = process.env.COOKIES;
if (!cookie) {
    throw new Error("Missing COOKIES env var — did you set the GitHub Secret?");
}

console.log("Fetching bazaar listings...");

const response = await fetch("https://blacket.org/worker/bazaar", {
    headers: {
        "Cookie": cookie,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://blacket.org/",
        "Origin": "https://blacket.org",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
    }
});

if (!response.ok) {
    throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
}

const res = await response.json() as {
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
};

if (res.error) {
    throw new Error(`Bazaar fetch failed: ${res.reason ?? "unknown error"}`);
}

console.log(`Got ${res.bazaar.length} listings`);



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