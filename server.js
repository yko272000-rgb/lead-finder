// server.js
// Lead-gen backend for FOMO Global Marketing / Echoooo sales team.
// Holds the ONE shared Lusha API key server-side so reps never see it or
// need their own key. All Lusha calls go through this server.
//
// FIELD NAMES BELOW are taken directly from the request schema shown in
// your Lusha dashboard (API Docs > Prospecting Companies, V3 Latest) —
// not guessed. Confirmed fields used here: filters.companies.include.
// locations, sizes, keywords, mainIndustriesIds. Everything else in that
// schema (revenues, technologies, intentTopics, foundedYear, businessModel,
// companyType, linkedinUrls, signals) is real too, just not wired into the
// UI yet — easy to add later the same way.

import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const LUSHA_API_KEY = process.env.LUSHA_API_KEY;
const LUSHA_BASE = "https://api.lusha.com";

if (!LUSHA_API_KEY) {
  console.warn(
    "⚠️  LUSHA_API_KEY is not set. Add it to a .env file (see .env.example) before using search."
  );
}

async function lushaFetch(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      api_key: LUSHA_API_KEY,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = new Error(data?.message || `Lusha request failed (${res.status})`);
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

const MARKETING_TITLE_KEYWORDS = [
  "influencer",
  "social media",
  "brand",
  "marketing",
  "digital marketing",
  "communications",
  "pr ",
  "growth",
];

// ---------------------------------------------------------------------
// 1. Search companies by country / keywords / employee size
// ---------------------------------------------------------------------
// The "Business type" dropdown is gone — replaced with a free-text
// "Company Keywords" field (e.g. "coffee", "retail", "marketing agency")
// mapped straight to Lusha's confirmed `keywords` filter. No industry ID
// lookup, no hardcoded classification list — just pass what the rep types.
app.post("/api/search-companies", async (req, res) => {
  const { country, keywords, minSize, maxSize, page = 0, pageSize = 25 } = req.body;

  if (!country) {
    return res.status(400).json({ error: "country is required" });
  }

  const include = {
    locations: [{ country }],
  };

  if (minSize) {
    const sizeFilter = { min: Number(minSize) };
    if (maxSize) sizeFilter.max = Number(maxSize);
    include.sizes = [sizeFilter];
  }

  if (keywords && keywords.trim()) {
    // Split "coffee, retail" -> ["coffee", "retail"] to match the
    // documented array-of-strings shape for `keywords`.
    include.keywords = keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
  }

  const body = {
    pagination: { page, size: Math.min(pageSize, 25) },
    filters: {
      companies: { include },
    },
    options: { includePartialProfiles: false },
  };

  try {
    const data = await lushaFetch(`${LUSHA_BASE}/v3/companies/prospecting`, body);
    const records = data?.data || data?.records || data?.results || [];

    const companies = records.map((c) => ({
      name: c.name || c.companyName || "Unknown Company",
      domain: c.domain || c.fqdn || c.homepageDomain || "",
      industry: c.industry || c.mainIndustry || "",
      size: c.companySize?.name || (c.size?.min ? `${c.size.min}-${c.size.max}` : "Unknown"),
      country: c.location?.country || country || "",
    }));

    res.json({ companies });
  } catch (err) {
    console.error("search-companies error:", err.details || err.message);
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

// ---------------------------------------------------------------------
// 2. Given selected companies (by domain), find the marketing/influencer
//    decision-maker at each one.
//
//    Uses Lusha's dedicated Decision Makers endpoint (confirmed in your
//    API Hub screenshot: "Decision Makers APIs — v3/contacts/decision-makers
//    — Identify the most relevant decision makers at any target company"),
//    which is purpose-built for exactly this — no filter-field guessing.
// ---------------------------------------------------------------------
app.post("/api/find-contacts", async (req, res) => {
  const { domains } = req.body;

  if (!Array.isArray(domains) || domains.length === 0) {
    return res.status(400).json({ error: "domains[] array is required" });
  }

  try {
    // Normalize "www.example.com" -> "example.com". Company-matching
    // endpoints like this one typically match on the bare/apex domain —
    // sending "www.x.com" can silently fail to match even for companies
    // that are definitely in the database.
    const cleanDomains = domains.map((d) => d.replace(/^https?:\/\//, "").replace(/^www\./, ""));

    const body = {
      companies: cleanDomains.map((domain) => ({ domain, clientReferenceId: domain })),
    };

    const data = await lushaFetch(`${LUSHA_BASE}/v3/contacts/decision-makers`, body);
    console.log("decision-makers raw response:", JSON.stringify(data).slice(0, 2000));
    const results = data.results || data.data || [];

    const shaped = results.map((entry) => {
      const candidates = entry.contacts || entry.decisionMakers || [];
      const marketingMatch = candidates.find((c) =>
        MARKETING_TITLE_KEYWORDS.some((kw) => (c.title || "").toLowerCase().includes(kw))
      );
      const best = marketingMatch || candidates[0] || null;

      return {
        companyDomain: entry.clientReferenceId || entry.domain,
        companyName: entry.companyName || entry.name || entry.clientReferenceId,
        contact: best
          ? {
              contactId: best.contactId || best.id,
              name: `${best.firstName || ""} ${best.lastName || ""}`.trim() || best.name || "Someone",
              title: best.title || "",
              phone: best.phone || best.phoneNumbers?.[0]?.number || null,
            }
          : null,
      };
    });

    res.json({ results: shaped });
  } catch (err) {
    console.error("find-contacts error:", err.details || err.message);
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

// ---------------------------------------------------------------------
// 3. Reveal phone/email for a chosen contact ID (costs a credit — only
//    called when a rep clicks "Reveal number" for a specific contact)
// ---------------------------------------------------------------------
app.post("/api/reveal-contact", async (req, res) => {
  const { contactIds } = req.body;

  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    return res.status(400).json({ error: "contactIds[] is required" });
  }

  try {
    const data = await lushaFetch(`${LUSHA_BASE}/v3/contacts/enrich`, { contactIds });
    const contacts = data.contacts || data.data || data.results || [];
    res.json({ contacts });
  } catch (err) {
    console.error("reveal-contact error:", err.details || err.message);
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Lead-gen tool running on http://localhost:${PORT}`));
