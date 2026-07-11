// server.js
// Lead-gen backend for FOMO Global Marketing / Echoooo sales team.
// Holds the ONE shared Lusha API key server-side so reps never see it.

import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const LUSHA_API_KEY = process.env.LUSHA_API_KEY;
const LUSHA_BASE = "https://api.lusha.com";

if (!LUSHA_API_KEY) {
  console.warn(
    "⚠️ LUSHA_API_KEY is not set. Add it to a .env file before running."
  );
}

// Global helper for Lusha API calls using Axios
async function lushaFetch(endpoint, body) {
  try {
    const response = await axios.post(`${LUSHA_BASE}${endpoint}`, body, {
      headers: {
        "Content-Type": "application/json",
        api_key: LUSHA_API_KEY,
      },
    });
    return response.data;
  } catch (error) {
    const status = error.response?.status || 500;
    const data = error.response?.data || {};
    const err = new Error(data?.message || `Lusha request failed (${status})`);
    err.status = status;
    err.details = data;
    throw err;
  }
}

// ---------------------------------------------------------------------
// 1. Search Companies via V3 Prospecting API
// ---------------------------------------------------------------------
app.post("/api/search-companies", async (req, res) => {
  const { country, industry, minSize, maxSize } = req.body;

  // Build compliant V3 structure
  const companyInclude = {};

  if (country) {
    companyInclude.locations = [{ country }];
  }

  if (minSize || maxSize) {
    const sizeObj = {};
    if (minSize) sizeObj.min = parseInt(minSize, 10);
    if (maxSize) sizeObj.max = parseInt(maxSize, 10);
    companyInclude.sizes = [sizeObj];
  }

  // Use compliant keywords matching instead of deprecated string fields
  if (industry) {
    companyInclude.keywords = [industry];
  }

  const requestBody = {
    pagination: {
      page: 1,
      size: 25
    },
    filters: {
      companies: {
        include: companyInclude
      }
    }
  };

  try {
    const data = await lushaFetch("/v3/prospecting/company", requestBody);
    
    // Normalize response rows for the front-end list
    const companies = (data?.data || data?.records || []).map((c) => ({
      name: c.name || "Unknown Company",
      domain: c.domain || "",
      industry: c.industry || industry || "",
      size: c.size?.employeesInCompany || c.companySize?.name || "Unknown Size",
      country: c.location?.country || country || ""
    }));

    res.json({ companies });
  } catch (err) {
    console.error("search-companies error:", err.details || err.message);
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

// ---------------------------------------------------------------------
// 2. Find Decision Makers for Selected Companies
// ---------------------------------------------------------------------
app.post("/api/find-contacts", async (req, res) => {
  const { domains } = req.body;

  if (!Array.isArray(domains) || domains.length === 0) {
    return res.status(400).json({ error: "domains[] array is required" });
  }

  // Target keywords for marketing/influencer leadership roles
  const MARKETING_KEYWORDS = ["marketing", "influencer", "growth", "social media", "pr", "brand", "partnership"];

  const requestBody = {
    pagination: {
      page: 1,
      size: 50
    },
    filters: {
      contacts: {
        include: {
          functions: ["marketing"]
        }
      },
      companies: {
        include: {
          domains: domains
        }
      }
    }
  };

  try {
    const data = await lushaFetch("/v3/prospecting/contact", requestBody);
    const records = data?.data || data?.records || [];

    // Group records matching by unique domain
    const grouped = {};
    domains.forEach(d => {
      grouped[d] = {
        companyDomain: d,
        companyName: "",
        contact: null,
        allCandidates: []
      };
    });

    records.forEach((c) => {
      const d = c.company?.domain || c.companyDomain;
      if (!d || !grouped[d]) return;

      if (!grouped[d].companyName && c.company?.name) {
        grouped[d].companyName = c.company.name;
      }

      const candidate = {
        id: c.id,
        contactId: c.id,
        name: `${c.firstName || ""} ${c.lastName || ""}`.trim() || "Someone",
        title: c.title || "Marketing Representative",
        phone: c.phoneNumbers?.[0]?.number || c.phone || null,
        email: c.emails?.[0]?.email || c.email || null
      };

      grouped[d].allCandidates.push(candidate);
    });

    // Score and select the single best match per company domain
    const shaped = Object.values(grouped).map((entry) => {
      if (entry.allCandidates.length === 0) return entry;

      const marketingMatch = entry.allCandidates.find((c) =>
        MARKETING_KEYWORDS.some((kw) => (c.title || "").toLowerCase().includes(kw))
      );

      entry.contact = marketingMatch || entry.allCandidates[0];
      return entry;
    });

    res.json({ results: shaped });
  } catch (err) {
    console.error("find-contacts error:", err.details || err.message);
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

// ---------------------------------------------------------------------
// 3. Enrich / Reveal Contact (Consumes 1 Credit)
// ---------------------------------------------------------------------
app.post("/api/reveal-contact", async (req, res) => {
  const { contactIds } = req.body;

  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    return res.status(400).json({ error: "contactIds[] is required" });
  }

  try {
    const data = await lushaFetch("/v3/contacts/enrich", { contactIds });
    const revealedArray = data?.data || data?.results || [];
    res.json({ contacts: revealedArray });
  } catch (err) {
    console.error("reveal-contact error:", err.details || err.message);
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Production Lead Finder server running on port ${PORT}`);
});
