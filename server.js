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

// 1. Search Companies via V3 Prospecting Schema
app.post("/api/search-companies", async (req, res) => {
  const { country, keywords, size } = req.body;
  const companyInclude = {};

  // Country filter mapping
  if (country) {
    companyInclude.locations = [{ country: country }];
  }

  // Employee Size mapping
  if (size && size.includes("-")) {
    const [minStr, maxStr] = size.split("-");
    companyInclude.sizes = [{
      min: parseInt(minStr, 10),
      max: parseInt(maxStr, 10)
    }];
  }

  // Classification logic
  if (keywords) {
    const cleanKeyword = keywords.trim().toLowerCase();
    
    // FIXED: Maps to the correct V3 field name 'industries' instead of 'industriesLabels'
    if (["coffee", "restaurant", "food", "fish"].includes(cleanKeyword)) {
      companyInclude.industries = ["Food & Beverages", "Restaurants", "Retail"];
    } else if (["marketing", "advertising", "pr"].includes(cleanKeyword)) {
      companyInclude.industries = ["Marketing and Advertising", "Public Relations and Communications"];
    } else {
      // Fallback to standard free-text search across all company fields
      companyInclude.searchText = keywords.trim();
    }
  }

  const requestBody = {
    pagination: { page: 0, size: 25 },
    filters: {
      companies: {
        include: companyInclude
      }
    }
  };

  try {
    const data = await lushaFetch("/v3/companies/prospecting", requestBody);
    const records = data?.data || data?.records || [];

    const companies = records.map((c) => ({
      name: c.name || "Unknown Company",
      domain: c.domain || c.homepageDomain || "",
      industry: c.industry || "",
      size: c.companySize?.name || (c.size?.min ? `${c.size.min}-${c.size.max}` : "Unknown Size"),
      country: c.location?.country || country || ""
    }));

    res.json({ companies });
  } catch (err) {
    console.error("search-companies error:", err.details || err.message);
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

// 2. Find Decision Makers
app.post("/api/find-contacts", async (req, res) => {
  const { domains } = req.body;
  if (!Array.isArray(domains) || domains.length === 0) {
    return res.status(400).json({ error: "domains[] array is required" });
  }

  const MARKETING_KEYWORDS = ["marketing", "influencer", "growth", "social media", "pr", "brand", "partnership"];

  const requestBody = {
    pagination: { page: 0, size: 50 },
    filters: {
      contacts: {
        include: { functions: ["marketing"] }
      },
      companies: {
        include: { domains: domains }
      }
    }
  };

  try {
    const data = await lushaFetch("/v3/contacts/prospecting", requestBody);
    const records = data?.data || data?.records || [];

    const grouped = {};
    domains.forEach(d => {
      grouped[d] = { companyDomain: d, companyName: "", contact: null, allCandidates: [] };
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
        title: c.title || "Marketing Specialist",
        phone: c.phoneNumbers?.[0]?.number || c.phone || null,
        email: c.emails?.[0]?.email || c.email || null
      };
      grouped[d].allCandidates.push(candidate);
    });

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

// 3. Enrich / Reveal Contact
app.post("/api/reveal-contact", async (req, res) => {
  const { contactIds } = req.body;
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
  console.log("🚀 Production Lead Finder server completely updated.");
});
