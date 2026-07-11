// server.js
// Lead-gen backend for FOMO Global Marketing / Echoooo sales team.
// Holds the ONE shared Lusha API key server-side so reps never see it or
// need their own key. All Lusha calls go through this server.

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

async function lushaFetch(endpoint, body) {
  const res = await fetch(`${LUSHA_BASE}${endpoint}`, {
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

// Titles we consider "responsible for influencer/social/brand marketing".
// Edit this list any time — it's just a client-side-ish keyword filter
// applied to whatever Lusha's Decision Makers endpoint returns.
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
// 1. Search companies by country / industry / employee size
// ---------------------------------------------------------------------
app.post("/api/search-companies", async (req, res) => {
  const { country, industry, minSize, maxSize, page = 0, pageSize = 10 } = req.body;

  if (!country || !industry) {
    return res.status(400).json({ error: "country and industry are required" });
  }

  try {
    // NOTE: Verify this filter shape against your Lusha API Hub / Postman
    // playground before going live — Lusha's prospecting filter field
    // names have shifted between API versions (v2 -> v3).
    const body = {
      filters: {
        companies: {
          include: {
            locations: [{ country }],
            mainIndustries: [industry],
            sizes: [{ min: Number(minSize) || undefined, max: Number(maxSize) || undefined }],
          },
        },
      },
      pages: { page, size: Math.min(pageSize, 10) }, // capped small on purpose (light usage)
    };

    const data = await lushaFetch("/prospecting/company/search", body);
    res.json(data);
  } catch (err) {
    console.error("search-companies error:", err.details || err.message);
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

// ---------------------------------------------------------------------
// 2. Given selected companies (by domain), find the marketing/influencer
//    decision-maker at each one
// ---------------------------------------------------------------------
app.post("/api/find-contacts", async (req, res) => {
  const { companies } = req.body; // [{ domain, name }]

  if (!Array.isArray(companies) || companies.length === 0) {
    return res.status(400).json({ error: "companies[] is required" });
  }

  try {
    const body = {
      companies: companies.map((c) => ({
        domain: c.domain,
        clientReferenceId: c.domain,
      })),
    };

    const data = await lushaFetch("/v3/contacts/decision-makers", body);

    // Filter/rank each company's decision makers to ones that look like
    // marketing/influencer/brand roles. Fall back to the top-ranked
    // decision maker if nothing matches the keywords.
    const shaped = (data.results || data.data || []).map((entry) => {
      const candidates = entry.contacts || entry.decisionMakers || [];
      const marketingMatch = candidates.find((c) =>
        MARKETING_TITLE_KEYWORDS.some((kw) =>
          (c.title || "").toLowerCase().includes(kw)
        )
      );
      return {
        companyDomain: entry.clientReferenceId || entry.domain,
        companyName: entry.companyName || entry.name,
        contact: marketingMatch || candidates[0] || null,
        allCandidates: candidates,
      };
    });

    res.json({ results: shaped, raw: data });
  } catch (err) {
    console.error("find-contacts error:", err.details || err.message);
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

// ---------------------------------------------------------------------
// 3. Reveal phone/email for chosen contact IDs (costs a credit per reveal —
//    only call this for contacts the rep actually selected)
// ---------------------------------------------------------------------
app.post("/api/reveal-contact", async (req, res) => {
  const { contactIds } = req.body;

  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    return res.status(400).json({ error: "contactIds[] is required" });
  }

  try {
    const data = await lushaFetch("/v3/contacts/enrich", { contactIds });
    res.json(data);
  } catch (err) {
    console.error("reveal-contact error:", err.details || err.message);
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Lead-gen tool running on http://localhost:${PORT}`));
