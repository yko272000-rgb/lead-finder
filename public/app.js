// ---- state ----
let searchResults = [];   // companies returned from Lusha
let selectedDomains = new Set();
let contactsByDomain = {}; // domain -> { companyName, contact, allCandidates }

// ---- template (saved per-device in localStorage, per rep) ----
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

// ---- Step 1: search ----
document.getElementById("search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const country = document.getElementById("country").value;
  const industry = document.getElementById("industry").value;
  const size = document.getElementById("size").value; // e.g. "51-100" or "1001-" (open-ended, 1000+)
  const [minSizeRaw, maxSizeRaw] = size.split("-");
  const minSize = minSizeRaw;
  const maxSize = maxSizeRaw || undefined; // "1001-" -> no upper bound

  const status = document.getElementById("search-status");
  const btn = document.getElementById("search-btn");
  btn.disabled = true;
  status.innerHTML = `<p class="loading">Searching…</p>`;

  try {
    const res = await fetch("/api/search-companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country, industry, minSize, maxSize, pageSize: 10 }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || "Search failed");

    searchResults = data.results || data.data || data.companies || [];
    renderResults();
    status.innerHTML = searchResults.length
      ? ""
      : `<p class="loading">No companies matched — try widening the search.</p>`;
  } catch (err) {
    status.innerHTML = `<p class="error">${err.message}</p>`;
  } finally {
    btn.disabled = false;
  }
});

function renderResults() {
  const card = document.getElementById("results-card");
  const list = document.getElementById("results-list");
  card.hidden = searchResults.length === 0;
  list.innerHTML = "";

  searchResults.forEach((c) => {
    const domain = c.domain || c.website;
    const name = c.companyName || c.name;
    const row = document.createElement("div");
    row.className = "result-row";
    row.innerHTML = `
      <input type="checkbox" data-domain="${domain}" />
      <div class="name">${name} <div class="meta">${domain || ""} · ${c.employeeCount || c.size || ""} employees</div></div>
    `;
    row.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked) selectedDomains.add(domain);
      else selectedDomains.delete(domain);
    });
    list.appendChild(row);
  });
}

// ---- Step 2: find marketing contacts for selected companies ----
document.getElementById("find-contacts-btn").addEventListener("click", async () => {
  const status = document.getElementById("contacts-status");
  if (selectedDomains.size === 0) {
    status.innerHTML = `<p class="error">Select at least one company first.</p>`;
    return;
  }

  status.innerHTML = `<p class="loading">Finding decision makers…</p>`;

  const companies = searchResults
    .filter((c) => selectedDomains.has(c.domain || c.website))
    .map((c) => ({ domain: c.domain || c.website, name: c.companyName || c.name }));

  try {
    const res = await fetch("/api/find-contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companies }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Lookup failed");

    (data.results || []).forEach((r) => {
      contactsByDomain[r.companyDomain] = r;
    });

    renderContacts();
    status.innerHTML = "";
  } catch (err) {
    status.innerHTML = `<p class="error">${err.message}</p>`;
  }
});

function renderContacts() {
  const card = document.getElementById("contacts-card");
  const list = document.getElementById("contacts-list");
  card.hidden = Object.keys(contactsByDomain).length === 0;
  list.innerHTML = "";

  Object.entries(contactsByDomain).forEach(([domain, entry]) => {
    const { companyName, contact } = entry;
    const row = document.createElement("div");
    row.className = "contact-row";

    if (!contact) {
      row.innerHTML = `<div class="name">${companyName}<div class="meta">No marketing contact found</div></div>`;
      list.appendChild(row);
      return;
    }

    const hasPhone = !!contact.phone;
    row.innerHTML = `
      <div class="name">${contact.name || "Unknown"} — ${contact.title || ""}
        <div class="meta">${companyName}${hasPhone ? " · " + contact.phone : ""}</div>
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

    const revealed = (data.contacts || data.results || [])[0];
    entry.contact.phone = revealed?.phone || revealed?.phoneNumbers?.[0]?.number;
    renderContacts();
  } catch (err) {
    btn.textContent = "Failed — retry";
    btn.disabled = false;
  }
}

function buildWaLink(phone, message) {
  const digits = (phone || "").replace(/[^\d]/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
