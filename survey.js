const EMAIL_TO = "aslater@waldoch.com";
const FORMSUBMIT = `https://formsubmit.co/ajax/${EMAIL_TO}`;
const STORAGE_KEY = "waldoch-seat-color-survey-v1";

const LOCAL_IMAGES = [
  { path: "black-pewter.JPG", label: "black-pewter.JPG" },
  { path: "black-white.JPG", label: "black-white.JPG" },
  { path: "black-white2.JPG", label: "black-white2.JPG" },
  { path: "creme-chamois.JPG", label: "creme-chamois.JPG" },
  { path: "creme-sand.JPG", label: "creme-sand.JPG" },
  { path: "granite-crystal.JPG", label: "granite-crystal.JPG" },
  { path: "leather-sand.jpg", label: "leather-sand.jpg" },
  { path: "pewter-black.JPG", label: "pewter-black.JPG" },
  { path: "sofas/quicksilver.JPG", label: "sofas/quicksilver.JPG" },
];

const SWATCH = {
  BLACK: "#1c1c1c",
  QUICKSILVER: "#6e7278",
  PEWTER: "#8e8e8a",
  "MEDIUM NEUTRAL": "#c4ad8a",
  NEUTRAL: "#d2c2a6",
  CREAM: "#e8d9be",
  CHAMOIS: "#c4a574",
  LATTE: "#b08968",
  "MEDIUM ALABASTER": "#d8d0c4",
  ALABASTER: "#d8d0c4",
  WHITE: "#ece6db",
};

const EXTRA_COLORS = [
  {
    id: "unsure",
    shortName: "Not sure / cannot determine",
    partsLabel: "Needs a closer look",
    detail: "Lighting, crop, or quality is not enough to match a colorway.",
    bodyHex: "#3a3a40",
    pipingHex: "#8a8378",
    extra: true,
  },
  {
    id: "none",
    shortName: "None of these colors",
    partsLabel: "No matching part number",
    detail: "The photo does not match any Shop Seat color listed in the CSV.",
    bodyHex: "#2a1f1f",
    pipingHex: "#d46a6a",
    extra: true,
  },
];

const state = {
  view: "start",
  reviewer: "",
  index: 0,
  answers: {},
  colors: [],
  images: [],
  lightbox: null,
  status: "",
  submitting: false,
};

function $(sel, root = document) {
  return root.querySelector(sel);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function hexFor(name) {
  const key = String(name || "").toUpperCase().trim();
  if (SWATCH[key]) return SWATCH[key];
  const hit = Object.keys(SWATCH).find((k) => key.includes(k));
  return hit ? SWATCH[hit] : "#7a746a";
}

function parseColorFull(full) {
  const normalized = String(full || "")
    .replaceAll(/\s+/g, " ")
    .replaceAll(/W\//gi, " W/ ")
    .replaceAll(/\s+/g, " ")
    .trim();
  const parts = normalized.split(" W/ ").map((p) => p.trim()).filter(Boolean);
  const stripParen = (s) => s.replaceAll(/\s*\([^)]*\)/g, "").replaceAll(/\s*PIPING/gi, "").trim();
  const body = stripParen(parts[0] || normalized);
  const piping = stripParen(parts[1] || "");
  const inserts = stripParen(parts[2] || "");
  const title = (s) =>
    s
      .toLowerCase()
      .replaceAll(/\b\w/g, (c) => c.toUpperCase());
  const shortName = piping ? `${title(body)} w/ ${title(piping)} piping` : title(body);
  return {
    colorFull: full,
    body,
    piping,
    inserts,
    shortName,
    bodyHex: hexFor(body),
    pipingHex: hexFor(piping || body),
    detail: [
      body && `Body: ${title(body)}`,
      piping && `Piping: ${title(piping)}`,
      inserts && `Inserts: ${title(inserts)}`,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const next = src[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.some((c) => c && c.trim()))
    .map((r) => {
      const obj = {};
      header.forEach((h, i) => {
        obj[h] = (r[i] || "").trim();
      });
      return obj;
    });
}

function colorsFromCsvRows(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const sku = row.Name || row.name || "";
    const display = row["Display Name"] || row.display || "";
    if (!sku || !display) continue;
    const colorMatch = display.match(/COLOR:\s*(.+)$/i);
    const colorFull = (colorMatch ? colorMatch[1] : display).trim();
    const side = display.includes(" - DS - ") ? "DS" : display.includes(" - PS - ") ? "PS" : "";
    if (!grouped.has(colorFull)) {
      grouped.set(colorFull, {
        id: `color-${grouped.size + 1}`,
        skuDs: "",
        skuPs: "",
        skus: [],
        ...parseColorFull(colorFull),
      });
    }
    const item = grouped.get(colorFull);
    item.skus.push(sku);
    if (side === "DS") item.skuDs = sku;
    if (side === "PS") item.skuPs = sku;
  }
  return [...grouped.values()].map((c) => {
    const ds = c.skuDs || c.skus[0] || "";
    const ps = c.skuPs || "";
    c.partsLabel = ps ? `${ds} (DS)  ·  ${ps} (PS)` : ds;
    return c;
  });
}

function parseUsableFiles(text) {
  const images = [];
  for (const raw of text.split(/\n/)) {
    const line = raw.trim();
    if (!line || /^potential usable files$/i.test(line)) continue;
    const match = line.match(/https?:\/\/\S+/i);
    if (!match) continue;
    const url = match[0];
    const label = line.replace(url, "").trim() || url.split("/").pop();
    images.push({
      id: `url-${images.length + 1}`,
      src: url,
      path: url,
      label,
      kind: "url",
      hint: label,
    });
  }
  return images;
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved) return;
    state.reviewer = saved.reviewer || "";
    state.answers = saved.answers || {};
    state.index = saved.index || 0;
  } catch {
    /* ignore */
  }
}

function persist() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      reviewer: state.reviewer,
      answers: state.answers,
      index: state.index,
    }),
  );
}

async function loadCatalog() {
  try {
    const res = await fetch("/api/catalog", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (data.colors?.length && data.images?.length) return data;
    }
  } catch {
    /* fall through to client parse */
  }

  const [csvText, usableText] = await Promise.all([
    fetch("Shop Seats - Add.csv").then((r) => r.text()),
    fetch("potential-usable-files.txt").then((r) => r.text()),
  ]);

  const colors = colorsFromCsvRows(parseCsv(csvText));
  const local = LOCAL_IMAGES.map((img, i) => ({
    id: `local-${i + 1}`,
    src: img.path,
    path: img.path,
    label: img.label,
    kind: "local",
    hint: img.label,
  }));
  const remote = parseUsableFiles(usableText);
  return { colors: [...colors, ...EXTRA_COLORS], images: [...local, ...remote] };
}

function answeredCount() {
  return state.images.filter((img) => state.answers[img.id]?.colorId).length;
}

function currentImage() {
  return state.images[state.index];
}

function colorById(id) {
  return state.colors.find((c) => c.id === id);
}

function render() {
  const app = $("#app");
  if (state.view === "start") app.innerHTML = renderStart();
  else if (state.view === "survey") app.innerHTML = renderSurvey();
  else if (state.view === "review") app.innerHTML = renderReview();
  else app.innerHTML = renderDone();
  bind();
}

function topbar(extra = "") {
  const total = state.images.length;
  const n = answeredCount();
  const pct = total ? Math.round((n / total) * 100) : 0;
  return `
    <header class="topbar">
      <div class="brand">
        <div class="brand-kicker">Waldoch Custom</div>
        <h1>Maybach Seat Color Survey</h1>
      </div>
      <div class="top-meta">
        ${extra}
        <div>${n} of ${total} matched · answers go to ${EMAIL_TO}</div>
        <div class="progress-wrap">
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>
      </div>
    </header>
  `;
}

function renderStart() {
  return `
    ${topbar()}
    <section class="hero-card">
      <h2>Match each photo to a Shop Seat color</h2>
      <p>
        Each image is shown with the official colorways from
        <strong>Shop Seats - Add.csv</strong>. Pick the color / part number
        the photo is referring to so the library can be sorted.
      </p>
      <ul>
        <li>Local studio JPGs and every URL in potential-usable-files.txt are included.</li>
        <li>Driver-side and passenger-side SKUs that share a color are grouped together.</li>
        <li>When you submit, a formatted report is emailed to ${EMAIL_TO}.</li>
      </ul>
      <div class="field">
        <label for="reviewer">Your name</label>
        <input id="reviewer" type="text" value="${escapeHtml(state.reviewer)}" placeholder="Who is filling this out?" autocomplete="name">
      </div>
      <div class="btn-row">
        <button class="btn btn-primary" data-action="begin">Start survey</button>
        ${answeredCount() ? `<button class="btn btn-ghost" data-action="review">Resume · ${answeredCount()} saved</button>` : ""}
      </div>
    </section>
  `;
}

function renderSurvey() {
  const img = currentImage();
  const total = state.images.length;
  const answer = state.answers[img.id] || {};
  const options = state.colors
    .map((color, i) => {
      const selected = answer.colorId === color.id ? "selected" : "";
      const key = color.extra ? "" : `<span class="kbd">${i + 1}</span>`;
      const swatch = color.extra
        ? ""
        : `<span class="swatch" aria-hidden="true">
             <span class="swatch-body" style="background:${color.bodyHex}"></span>
             <span class="swatch-piping" style="background:${color.pipingHex}"></span>
           </span>`;
      return `
        <button type="button" class="color-option ${color.extra ? "alt" : ""} ${selected}" data-select="${color.id}">
          ${swatch}
          <span class="color-copy">
            <div class="color-name">${escapeHtml(color.shortName)}</div>
            <div class="color-parts">${escapeHtml(color.partsLabel)}</div>
            <div class="color-detail">${escapeHtml(color.detail)}</div>
          </span>
          ${key}
        </button>
      `;
    })
    .join("");

  return `
    ${topbar(`<div>Image ${state.index + 1} of ${total}</div>`)}
    <div class="layout">
      <article class="photo-card">
        <div class="photo-meta">
          <div>
            <strong>${escapeHtml(img.label)}</strong>
            <div>${img.kind === "url" ? "From potential-usable-files.txt" : "Local JPG"}</div>
          </div>
          <div>${img.kind === "url" ? "Remote photo" : "Studio file"}</div>
        </div>
        <div class="photo-stage" data-action="zoom" title="Click to enlarge">
          <img src="${escapeHtml(img.src)}" alt="${escapeHtml(img.label)}">
        </div>
        <div class="photo-hint">
          Click the photo to enlarge. Source:
          ${img.kind === "url" ? `<a href="${escapeHtml(img.src)}" target="_blank" rel="noreferrer">${escapeHtml(img.src)}</a>` : escapeHtml(img.path)}
        </div>
      </article>
      <aside class="options-card">
        <h2>Select the matching color</h2>
        <p class="lede">Choose the Shop Seat color / part number this photo refers to. Selecting a color saves it and opens the next photo.</p>
        <div class="color-list">${options}</div>
        <div class="field notes">
          <label for="notes">Notes (optional)</label>
          <textarea id="notes" placeholder="Lighting, piping, or anything uncertain…">${escapeHtml(answer.notes || "")}</textarea>
        </div>
        <div class="nav-row">
          <button class="btn btn-ghost" data-action="prev" ${state.index === 0 ? "disabled" : ""}>Back</button>
          <button class="btn btn-ghost" data-action="review">Review answers</button>
        </div>
      </aside>
    </div>
    ${state.lightbox ? renderLightbox(state.lightbox) : ""}
  `;
}

function renderLightbox(src) {
  return `<div class="lightbox" data-action="close-zoom"><img src="${escapeHtml(src)}" alt="Enlarged seat photo"></div>`;
}

function buckets() {
  const map = new Map();
  for (const color of state.colors) map.set(color.id, []);
  map.set("unanswered", []);
  for (const img of state.images) {
    const colorId = state.answers[img.id]?.colorId;
    if (!colorId) map.get("unanswered").push(img);
    else map.get(colorId)?.push(img);
  }
  return map;
}

function renderReview() {
  const grouped = buckets();
  const missing = grouped.get("unanswered") || [];
  const sections = state.colors
    .map((color) => {
      const items = grouped.get(color.id) || [];
      const thumbs = items.length
        ? `<div class="thumb-row">${items
            .map(
              (img) => `
            <figure class="thumb" data-jump="${img.id}">
              <img src="${escapeHtml(img.src)}" alt="${escapeHtml(img.label)}">
              <figcaption>${escapeHtml(img.label)}${state.answers[img.id]?.notes ? " · noted" : ""}</figcaption>
            </figure>`,
            )
            .join("")}</div>`
        : `<p class="empty-bucket">No photos assigned yet.</p>`;
      return `
        <section class="bucket">
          <h3>${escapeHtml(color.shortName)} · ${items.length}</h3>
          <div class="parts">${escapeHtml(color.partsLabel)}</div>
          ${thumbs}
        </section>
      `;
    })
    .join("");

  return `
    ${topbar("<div>Review before sending</div>")}
    ${missing.length ? `<p class="unanswered">${missing.length} photo${missing.length === 1 ? "" : "s"} still need a color. You can submit a partial survey, or jump back to finish.</p>` : ""}
    <div class="review-grid">${sections}</div>
    <div class="hero-card" style="margin-top:22px;max-width:none">
      <h2>Submit to ${EMAIL_TO}</h2>
      <p>This opens your email client with a complete report, also tries a direct send, and saves a CSV copy.</p>
      <div class="field">
        <label for="reviewer">Your name on the report</label>
        <input id="reviewer" type="text" value="${escapeHtml(state.reviewer)}">
      </div>
      <div class="btn-row">
        <button class="btn btn-ghost" data-action="begin">Back to photos</button>
        <button class="btn btn-ghost" data-action="csv">Download CSV</button>
        <button class="btn btn-primary" data-action="submit" ${state.submitting ? "disabled" : ""}>
          ${state.submitting ? "Sending…" : "Email results"}
        </button>
      </div>
      ${state.status ? `<p class="status ${state.status.ok ? "ok" : "err"}">${escapeHtml(state.status.text)}</p>` : ""}
    </div>
  `;
}

function renderDone() {
  return `
    ${topbar()}
    <section class="hero-card">
      <h2>Survey submitted</h2>
      <p>${escapeHtml(state.status?.text || "Results were prepared for email.")}</p>
      <div class="btn-row">
        <button class="btn btn-ghost" data-action="csv">Download CSV</button>
        <button class="btn btn-primary" data-action="review">Back to review</button>
      </div>
    </section>
  `;
}

function bind() {
  document.querySelectorAll("[data-action]").forEach((el) => {
    el.addEventListener("click", (ev) => {
      const action = el.getAttribute("data-action");
      handleAction(action, ev);
    });
  });
  document.querySelectorAll("[data-select]").forEach((el) => {
    el.addEventListener("click", () => selectColor(el.getAttribute("data-select")));
  });
  document.querySelectorAll("[data-jump]").forEach((el) => {
    el.addEventListener("click", () => jumpTo(el.getAttribute("data-jump")));
  });
  const reviewer = $("#reviewer");
  if (reviewer) {
    reviewer.addEventListener("input", () => {
      state.reviewer = reviewer.value;
      persist();
    });
  }
  const notes = $("#notes");
  if (notes) {
    notes.addEventListener("input", () => {
      const img = currentImage();
      state.answers[img.id] = { ...(state.answers[img.id] || {}), notes: notes.value };
      persist();
    });
  }
  const broken = document.querySelector(".photo-stage img");
  if (broken) {
    broken.addEventListener("error", () => {
      broken.replaceWith(Object.assign(document.createElement("div"), {
        className: "photo-error",
        textContent: "This image could not be loaded. You can still assign a color from the filename or URL.",
      }));
    });
  }
}

function handleAction(action, ev) {
  if (action === "begin") {
    state.reviewer = $("#reviewer")?.value.trim() || state.reviewer;
    if (!state.reviewer) {
      alert("Please enter your name before starting.");
      return;
    }
    state.view = "survey";
    persist();
    render();
  } else if (action === "prev") {
    state.index = Math.max(0, state.index - 1);
    persist();
    render();
  } else if (action === "review") {
    state.view = "review";
    render();
  } else if (action === "zoom") {
    state.lightbox = currentImage().src;
    render();
  } else if (action === "close-zoom") {
    state.lightbox = null;
    render();
  } else if (action === "csv") {
    downloadCsv();
  } else if (action === "submit") {
    submitSurvey();
  }
}

function selectColor(colorId) {
  const img = currentImage();
  const notes = $("#notes")?.value || state.answers[img.id]?.notes || "";
  state.answers[img.id] = { colorId, notes };
  if (state.index >= state.images.length - 1) {
    state.view = "review";
  } else {
    state.index += 1;
  }
  persist();
  render();
}

function jumpTo(imageId) {
  const idx = state.images.findIndex((img) => img.id === imageId);
  if (idx >= 0) {
    state.index = idx;
    state.view = "survey";
    persist();
    render();
  }
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function buildRows() {
  return state.images.map((img, i) => {
    const answer = state.answers[img.id] || {};
    const color = colorById(answer.colorId);
    return {
      n: i + 1,
      image: img.label,
      source: img.kind,
      path: img.path,
      color: color?.shortName || "",
      skuDs: color?.skuDs || "",
      skuPs: color?.skuPs || "",
      parts: color?.partsLabel || "",
      notes: answer.notes || "",
      colorId: answer.colorId || "",
    };
  });
}

function csvText() {
  const header = ["#", "image", "source", "path_or_url", "color", "sku_ds", "sku_ps", "part_numbers", "notes"];
  const lines = [header.join(",")];
  for (const row of buildRows()) {
    lines.push(
      [row.n, row.image, row.source, row.path, row.color, row.skuDs, row.skuPs, row.parts, row.notes]
        .map(csvEscape)
        .join(","),
    );
  }
  return lines.join("\n");
}

function downloadCsv() {
  const blob = new Blob([csvText()], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `waldoch-seat-color-survey-${stamp()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

function emailBody() {
  const rows = buildRows();
  const grouped = buckets();
  const lines = [
    "WALDOCH MAYBACH SEAT COLOR SURVEY",
    "================================",
    `Reviewer: ${state.reviewer || "(not provided)"}`,
    `Submitted: ${new Date().toLocaleString()}`,
    `Matched: ${answeredCount()} / ${state.images.length}`,
    "",
    "SORTED BY COLOR / PART NUMBER",
    "-----------------------------",
  ];
  for (const color of state.colors) {
    const items = grouped.get(color.id) || [];
    lines.push("");
    lines.push(`${color.shortName}  [${color.partsLabel}]  — ${items.length} photo(s)`);
    if (!items.length) {
      lines.push("  (none)");
      continue;
    }
    for (const img of items) {
      const note = state.answers[img.id]?.notes;
      lines.push(`  - ${img.label}`);
      lines.push(`    ${img.path}`);
      if (note) lines.push(`    Notes: ${note}`);
    }
  }
  const missing = grouped.get("unanswered") || [];
  if (missing.length) {
    lines.push("");
    lines.push(`UNANSWERED — ${missing.length} photo(s)`);
    for (const img of missing) lines.push(`  - ${img.label}  ${img.path}`);
  }
  lines.push("", "FLAT LIST", "---------");
  for (const row of rows) {
    lines.push(`${row.n}. ${row.image}`);
    lines.push(`   Color: ${row.color || "(none)"}`);
    lines.push(`   Parts: ${row.parts || "(none)"}`);
    if (row.notes) lines.push(`   Notes: ${row.notes}`);
  }
  return lines.join("\n");
}

async function submitSurvey() {
  state.reviewer = $("#reviewer")?.value.trim() || state.reviewer;
  if (!state.reviewer) {
    alert("Please enter your name so the report can be attributed.");
    return;
  }
  persist();
  state.submitting = true;
  state.status = { ok: true, text: "Preparing email…" };
  render();

  const subject = `Maybach Seat Color Survey — ${state.reviewer} — ${new Date().toLocaleDateString()}`;
  const body = emailBody();
  const csv = csvText();
  const payload = {
    reviewer: state.reviewer,
    subject,
    body,
    csv,
    answers: buildRows(),
  };

  let serverOk = false;
  let formOk = false;
  try {
    const res = await fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = await res.json();
      serverOk = true;
      formOk = Boolean(data.emailed);
    }
  } catch {
    /* local save is optional */
  }

  try {
    const res = await fetch(FORMSUBMIT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        name: state.reviewer,
        _subject: subject,
        _template: "box",
        _captcha: "false",
        message: body,
        results_csv: csv,
      }),
    });
    formOk = formOk || res.ok;
  } catch {
    /* FormSubmit may be blocked; mailto still works */
  }

  const mailto = `mailto:${EMAIL_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = mailto;
  downloadCsv();

  state.submitting = false;
  state.view = "done";
  state.status = {
    ok: true,
    text: formOk
      ? `Results sent toward ${EMAIL_TO}. Your email client should also open with the same report, and a CSV was downloaded.`
      : `Your email client should open a message to ${EMAIL_TO}. A CSV copy was downloaded${serverOk ? " and a local copy was saved on this machine." : "."} If the message is blank, attach the CSV.`,
  };
  render();
}

document.addEventListener("keydown", (ev) => {
  if (state.view !== "survey") {
    if (ev.key === "Escape" && state.lightbox) {
      state.lightbox = null;
      render();
    }
    return;
  }
  if (ev.key === "Escape" && state.lightbox) {
    state.lightbox = null;
    render();
    return;
  }
  if (ev.target.matches("input, textarea")) return;
  if (ev.key === "ArrowLeft") handleAction("prev");
  const num = Number(ev.key);
  if (num >= 1 && num <= 8) {
    const color = state.colors.filter((c) => !c.extra)[num - 1];
    if (color) selectColor(color.id);
  }
});

async function init() {
  restore();
  try {
    const catalog = await loadCatalog();
    state.colors = catalog.colors;
    state.images = catalog.images;
    if (state.index >= state.images.length) state.index = 0;
    render();
  } catch (err) {
    $("#app").innerHTML = `
      <section class="hero-card">
        <h2>Could not load the survey</h2>
        <p>Make sure you are running the local survey server so the CSV, photos, and usable-files list can be read.</p>
        <p class="status err">${escapeHtml(err.message || err)}</p>
      </section>`;
  }
}

init();
