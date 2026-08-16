// server.js
// Lead-gen backend for FOMO Global Marketing / Echoooo sales team.
// Holds the ONE shared Lusha API key server-side so reps never see it or
// need their own key. All Lusha calls go through this server.
//
// ---------------------------------------------------------------------
// LOGIN / OTP LAYER
// The whole site sits behind a login page. There's no fixed password —
// instead, clicking "Send code" on the login page emails a fresh 6-digit
// code to OTP_RECIPIENT_EMAIL (set in Render's env vars). Typing that
// code in within 5 minutes logs you in for the browser session.
// ---------------------------------------------------------------------

import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import session from "express-session";
import nodemailer from "nodemailer";
import crypto from "crypto";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Render sits behind a proxy — needed so secure cookies work correctly.
app.set("trust proxy", 1);

app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-me-in-render-env-vars",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 12, // 12 hours
    },
  })
);

// ---------------------------------------------------------------------
// OTP mailer setup
// ---------------------------------------------------------------------
const EMAIL_USER = process.env.EMAIL_USER; // the account sending the code
const EMAIL_PASS = process.env.EMAIL_PASS; // Gmail/Workspace App Password
const OTP_RECIPIENT_EMAIL = process.env.OTP_RECIPIENT_EMAIL || EMAIL_USER; // where codes are sent

if (!EMAIL_USER || !EMAIL_PASS) {
  console.warn(
    "⚠️  EMAIL_USER / EMAIL_PASS not set. Add them to Render's env vars before login codes can be sent."
  );
}

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true, // SSL
  auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  connectionTimeout: 15000, // 15s instead of the default (often too short on Render)
  greetingTimeout: 15000,
  socketTimeout: 15000,
});

// In-memory OTP store — fine for a single small internal instance.
let pendingOtp = null; // { code, expiresAt }
let lastSentAt = 0;
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RESEND_COOLDOWN_MS = 45 * 1000; // 45 seconds between sends

function generateCode() {
  return crypto.randomInt(100000, 999999).toString();
}

app.post("/api/request-otp", async (req, res) => {
  if (!EMAIL_USER || !EMAIL_PASS) {
    return res.status(500).json({ error: "Email sending isn't configured yet." });
  }

  const now = Date.now();
  if (now - lastSentAt < RESEND_COOLDOWN_MS) {
    const waitSec = Math.ceil((RESEND_COOLDOWN_MS - (now - lastSentAt)) / 1000);
    return res.status(429).json({ error: `Please wait ${waitSec}s before requesting another code.` });
  }

  const code = generateCode();
  pendingOtp = { code, expiresAt: now + OTP_TTL_MS };
  lastSentAt = now;

  try {
    await transporter.sendMail({
      from: `"LeadG by Echo" <${EMAIL_USER}>`,
      to: OTP_RECIPIENT_EMAIL,
      subject: `Your LeadG login code: ${code}`,
      text: `Your login code is ${code}. It expires in 5 minutes.`,
      html: `<p>Your login code is:</p><h2 style="letter-spacing:4px">${code}</h2><p>This expires in 5 minutes.</p>`,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("send-otp error:", err.code || "", err.message);
    pendingOtp = null;
    res.status(500).json({ error: "Couldn't send the code. Check email settings." });
  }
});

app.post("/api/verify-otp", (req, res) => {
  const { code } = req.body;

  if (!pendingOtp) {
    return res.status(400).json({ error: "No code was requested. Click 'Send code' first." });
  }
  if (Date.now() > pendingOtp.expiresAt) {
    pendingOtp = null;
    return res.status(400).json({ error: "That code expired. Request a new one." });
  }
  if (code !== pendingOtp.code) {
    return res.status(401).json({ error: "Wrong code." });
  }

  pendingOtp = null;
  req.session.authenticated = true;
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Paths reachable without being logged in.
const OPEN_PATHS = new Set([
  "/login.html",
  "/login.js",
  "/style.css",
  "/api/request-otp",
  "/api/verify-otp",
]);

function requireAuth(req, res, next) {
  if (OPEN_PATHS.has(req.path)) return next();
  if (req.session && req.session.authenticated) return next();
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  return res.redirect("/login.html");
}

app.use(requireAuth);
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------
// Everything below is unchanged — the original Lusha-powered app
// ---------------------------------------------------------------------

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

// ---------------------------------------------------------------------
// 1. Search companies by country / industry / employee size
// ---------------------------------------------------------------------
app.post("/api/search-companies", async (req, res) => {
  const {
    country,
    mainIndustriesIds,
    subIndustriesIds,
    keywords,
    minSize,
    maxSize,
    page = 0,
    pageSize = 25,
  } = req.body;

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

  if (Array.isArray(mainIndustriesIds) && mainIndustriesIds.length) {
    include.mainIndustriesIds = mainIndustriesIds;
  }
  if (Array.isArray(subIndustriesIds) && subIndustriesIds.length) {
    include.subIndustriesIds = subIndustriesIds;
  }

  if (keywords && keywords.trim()) {
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
//    contact at each one.
// ---------------------------------------------------------------------
app.post("/api/find-contacts", async (req, res) => {
  const { domains } = req.body;

  if (!Array.isArray(domains) || domains.length === 0) {
    return res.status(400).json({ error: "domains[] array is required" });
  }

  const cleanDomains = domains.map((d) => d.replace(/^https?:\/\//, "").replace(/^www\./, ""));

  const body = {
    pagination: { page: 0, size: 20 },
    filters: {
      contacts: {
        include: {
          jobTitles: [
            "Marketing",
            "Social Media",
            "Brand",
            "Influencer",
            "Communications",
            "Growth",
            "PR",
          ],
        },
      },
      companies: {
        include: {
          domains: cleanDomains,
        },
      },
    },
  };

  try {
    const data = await lushaFetch(`${LUSHA_BASE}/v3/contacts/prospecting`, body);
    console.log("contact-search raw response:", JSON.stringify(data).slice(0, 2000));

    const records = data.results || data.data || [];

    const byDomain = {};
    for (const c of records) {
      const domain = c.company?.domain || c.companyDomain;
      if (!domain || byDomain[domain]) continue;
      byDomain[domain] = {
        companyDomain: domain,
        companyName: c.company?.name || domain,
        contact: {
          contactId: c.id || c.contactId,
          name: `${c.firstName || ""} ${c.lastName || ""}`.trim() || "Someone",
          title: c.jobTitle?.title || c.title || "",
          phone: null,
        },
      };
    }

    res.json({ results: Object.values(byDomain) });
  } catch (err) {
    console.error("find-contacts error:", err.details || err.message);
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

// ---------------------------------------------------------------------
// 3. Reveal phone/email for a chosen contact ID
// ---------------------------------------------------------------------
app.post("/api/reveal-contact", async (req, res) => {
  const { contactIds } = req.body;

  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    return res.status(400).json({ error: "contactIds[] is required" });
  }

  try {
    const data = await lushaFetch(`${LUSHA_BASE}/v3/contacts/enrich`, {
      ids: contactIds,
      reveal: ["phones"],
    });

    const contacts = (data.results || []).map((r) => ({
      contactId: r.id,
      phone: r.phones?.[0]?.number || null,
    }));

    res.json({ contacts });
  } catch (err) {
    console.error("reveal-contact error:", err.details || err.message);
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Lead-gen tool running on http://localhost:${PORT}`));
