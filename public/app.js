let searchResults = [];   
let selectedDomains = new Set();
let contactsByDomain = {};

// Pagination state
const PAGE_SIZE = 25;
let currentPage = 0;
let lastSearchBody = null;   // remembers the filters used, so "Find More" reuses them
let seenDomains = new Set(); // avoids showing the same company twice across pages
let noMoreResults = false;

const templateEl = document.getElementById("template");
const savedTemplate = localStorage.getItem("fomo_wa_template");
if (savedTemplate) templateEl.value = savedTemplate;

document.getElementById("save-template-btn").addEventListener("click", () => {
  localStorage.setItem("fomo_wa_template", templateEl.value);
  const msg = document.getElementById("template-saved-msg");
  msg.textContent = "Saved ✓";
  setTimeout(() => (msg.textContent = ""), 2000);
});

function fillTemplate(company, contact) {
  const t = templateEl.value || "";
  return t
    .replaceAll("{company_name}", company || "")
    .replaceAll("{contact_first_name}", (contact?.name || "").split(" ")[0] || "there")
    .replaceAll("{contact_title}", contact?.title || "");
}

// Step 1: search via V3 endpoint
document.getElementById("search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const country = document.getElementById("country").value;
  const industryValue = document.getElementById("industry").value; // e.g. "sub:1,2" or "main:16" or "main:7,sub:5"
  const keywords = document.getElementById("keywords").value;
  const size = document.getElementById("size").value;
  const [minSizeRaw, maxSizeRaw] = size.split("-");

  // Parse "main:7,sub:5" style value into { mainIndustriesIds:[7], subIndustriesIds:[5] }
  const mainIndustriesIds = [];
  const subIndustriesIds = [];
  industryValue.split(",").forEach((part) => {
    const [kind, ids] = part.split(":");
    if (!ids) return;
    const nums = ids.split(",").map(Number).filter((n) => !Number.isNaN(n));
    if (kind === "main") mainIndustriesIds.push(...nums);
    if (kind === "sub") subIndustriesIds.push(...nums);
  });

  // New filters chosen → this is a fresh search, not a "find more". Reset pagination.
  lastSearchBody = {
    country,
    mainIndustriesIds,
    subIndustriesIds,
    keywords,
    minSize: minSizeRaw ? minSizeRaw.trim() : null,
    maxSize: maxSizeRaw ? maxSizeRaw.trim() : null,
  };
  currentPage = 0;
  seenDomains = new Set();
  noMoreResults = false;
  searchResults = [];

  const btn = e.target.querySelector("button[type='submit']");
  await runSearch(btn, "Searching V3 API...", { append: false });
});

document.getElementById("load-more-btn").addEventListener("click", async (e) => {
  if (!lastSearchBody) return;
  currentPage += 1;
  await runSearch(e.target, "Finding more…", { append: true });
});

// Shared search call — reused by both the initial search and "Find More Companies"
async function runSearch(btn, loadingText, { append }) {
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = loadingText;

  try {
    const res = await fetch("/api/search-companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...lastSearchBody,
        page: currentPage,
        pageSize: PAGE_SIZE,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Search call failed");

    const newCompanies = (data.companies || []).filter(
      (c) => c.domain && !seenDomains.has(c.domain)
    );
    newCompanies.forEach((c) => seenDomains.add(c.domain));

    // Fewer than a full page (or nothing new) means we've hit the end of results.
    noMoreResults = (data.companies || []).length < PAGE_SIZE;

    if (append) {
      searchResults = searchResults.concat(newCompanies);
    } else {
      searchResults = newCompanies;
    }

    renderCompanies({ append });
  } catch (err) {
    alert("Error searching: " + err.message);
    if (append) currentPage -= 1; // let them retry the same page
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function renderCompanies({ append = false } = {}) {
  const card = document.getElementById("results-card");
  const list = document.getElementById("results-list");
  const countEl = document.getElementById("results-count");
  const loadMoreBtn = document.getElementById("load-more-btn");

  if (!append) {
    list.innerHTML = "";
    selectedDomains.clear();
  }

  if (searchResults.length === 0) {
    list.innerHTML = `<div class="hint" style="padding:12px;">No companies found matching these criteria.</div>`;
    countEl.textContent = "";
    loadMoreBtn.hidden = true;
    card.hidden = false;
    return;
  }

  // Only append rows for companies not already shown on screen.
  const existingDomains = new Set(
    Array.from(list.querySelectorAll("[data-domain]")).map((el) => el.dataset.domain)
  );

  searchResults.forEach((c) => {
    if (!c.domain || existingDomains.has(c.domain)) return;
    const row = document.createElement("div");
    row.className = "result-row";
    row.innerHTML = `
      <input type="checkbox" data-domain="${c.domain}" data-name="${c.name.replace(/"/g, '&quot;')}">
      <div class="name">
        ${c.name}
        <div class="meta">${c.domain} · ${c.size} employees · ${c.country}</div>
      </div>
    `;

    row.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked) {
        selectedDomains.add(e.target.dataset.domain);
      } else {
        selectedDomains.delete(e.target.dataset.domain);
      }
    });

    list.appendChild(row);
  });

  countEl.textContent = `${searchResults.length} compan${searchResults.length === 1 ? "y" : "ies"} loaded`;
  loadMoreBtn.hidden = noMoreResults;
  loadMoreBtn.textContent = "Find More Companies";
  if (noMoreResults) {
    countEl.textContent += " — that's all the matches for these filters.";
  }

  card.hidden = false;
  document.getElementById("contacts-card").hidden = true;
}

// Step 2: find decision makers
document.getElementById("find-contacts-btn").addEventListener("click", async () => {
  if (selectedDomains.size === 0) {
    alert("Please select at least one company first.");
    return;
  }

  const statusEl = document.getElementById("contacts-status");
  statusEl.textContent = `Fetching decision makers for ${selectedDomains.size} companies...`;
  
  try {
    const res = await fetch("/api/find-contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domains: Array.from(selectedDomains) }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to find contacts");

    contactsByDomain = {};
    (data.results || []).forEach((item) => {
      contactsByDomain[item.companyDomain] = item;
    });

    renderContacts();
    statusEl.textContent = "";
  } catch (err) {
    statusEl.textContent = "Error loading contacts: " + err.message;
  }
});

function renderContacts() {
  const card = document.getElementById("contacts-card");
  const list = document.getElementById("contacts-list");
  list.innerHTML = "";

  const entries = Object.values(contactsByDomain);
  if (entries.length === 0) {
    list.innerHTML = `<p class="hint">No contacts identified.</p>`;
    card.hidden = false;
    return;
  }

  entries.forEach((entry) => {
    const domain = entry.companyDomain;
    const companyName = entry.companyName || domain;
    const contact = entry.contact;

    const row = document.createElement("div");
    row.className = "contact-row";

    if (!contact) {
      row.innerHTML = `
        <div class="name" style="color:var(--text-dim);">
          ${companyName}
          <div class="meta">No marketing profile indexed by Lusha for this domain.</div>
        </div>
      `;
      list.appendChild(row);
      return;
    }

    const hasPhone = !!contact.phone;
    row.innerHTML = `
      <div class="name">
        ${contact.name}
        <div class="meta">${contact.title} at <strong>${companyName}</strong> ${hasPhone ? " · " + contact.phone : ""}</div>
      </div>
      ${
        hasPhone
          ? `<a class="wa-btn" target="_blank" href="${buildWaLink(contact.phone, fillTemplate(companyName, contact))}">Send WhatsApp</a>`
          : `<button class="reveal-btn" data-id="${contact.contactId || contact.id}" data-domain="${domain}">Reveal number</button>`
      }
    `;

    const revealBtn = row.querySelector(".reveal-btn");
    if (revealBtn) {
      revealBtn.addEventListener("click", () => revealContact(revealBtn, domain));
    }

    list.appendChild(row);
  });

  card.hidden = false;
}

async function revealContact(btn, domain) {
  btn.disabled = true;
  btn.textContent = "Revealing…";
  const entry = contactsByDomain[domain];
  const contactId = entry.contact.contactId || entry.contact.id;

  try {
    const res = await fetch("/api/reveal-contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactIds: [contactId] }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Reveal failed");

    const revealed = (data.contacts || [])[0];
    const newPhone = revealed?.phoneNumbers?.[0]?.number || revealed?.phone || null;
    
    if (newPhone) {
      entry.contact.phone = newPhone;
    } else {
      alert("No verified phone number found on profile.");
    }
    renderContacts();
  } catch (err) {
    btn.textContent = "Failed — retry";
    btn.disabled = false;
  }
}

function buildWaLink(phone, message) {
  const cleanPhone = phone.replace(/[+\s()--]/g, "");
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
}
