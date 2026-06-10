const GUIDE_SOURCES = {
  patient: {
    path: "medication_counseling_guide.txt",
    fallback: (window.GUIDE_TEXTS && window.GUIDE_TEXTS.patient) || window.COUNSELING_GUIDE_TEXT || ""
  },
  detailed: {
    path: "medication_detailed_reference.txt",
    fallback: (window.GUIDE_TEXTS && window.GUIDE_TEXTS.detailed) || window.COUNSELING_GUIDE_TEXT || ""
  }
};

const TEXT = {
  eyebrow: "Hospital Pharmacy",
  title: "Medication Counseling",
  entryTitle: "Patient Medication List",
  patientMode: "Patient counseling",
  detailedMode: "Detailed reference",
  drugLabel: "Drug name",
  placeholder: "Enter a drug, then press Enter",
  add: "Add",
  loading: "Loading counseling guide...",
  loaded: (count) => `Loaded ${count} counseling entries. Enter a medication and press Enter.`,
  loadError: "Unable to load the guide. Start this folder with a local web server and refresh.",
  loadErrorBody: "The medication guide file could not be loaded.",
  resultsTitle: "Counseling Information",
  clear: "Clear",
  empty: "Add a medication to build the counseling handout.",
  sourceTitle: "Full Guide Source",
  print: "Print",
  cleared: "Medication list cleared.",
  addedExact: (name) => `Added ${name}.`,
  addedClosest: (name) => `Added ${name}; showing the closest counseling match.`,
  addedMissing: (name) => `Added ${name}; no exact counseling entry was found.`,
  entered: "Entered medication:",
  noMatch: "No matching counseling entry found in this guide.",
  remove: "Remove"
};

const state = {
  activeGuide: "patient",
  guides: {
    patient: { text: "", entries: [], selected: [] },
    detailed: { text: "", entries: [], selected: [] }
  }
};

const els = {
  eyebrow: document.getElementById("appEyebrow"),
  title: document.getElementById("appTitle"),
  entryTitle: document.getElementById("entryTitle"),
  patientModeBtn: document.getElementById("patientModeBtn"),
  detailedModeBtn: document.getElementById("detailedModeBtn"),
  form: document.getElementById("drugForm"),
  label: document.querySelector("label[for='drugInput']"),
  input: document.getElementById("drugInput"),
  options: document.getElementById("drugOptions"),
  status: document.getElementById("statusText"),
  selectedList: document.getElementById("selectedList"),
  resultsTitle: document.getElementById("resultsTitle"),
  results: document.getElementById("results"),
  guideTitle: document.getElementById("guideTitle"),
  fullGuide: document.getElementById("fullGuide"),
  printBtn: document.getElementById("printBtn"),
  printLabel: document.getElementById("printLabel"),
  clearBtn: document.getElementById("clearBtn"),
  guideButtons: document.querySelectorAll("[data-guide]")
};

init();

async function init() {
  applyStaticText();

  try {
    await Promise.all(Object.keys(GUIDE_SOURCES).map(loadGuide));
    setActiveGuide("patient", false);
  } catch (error) {
    setStatus(t("loadError"), true);
    els.results.classList.add("empty");
    els.results.innerHTML = `<p>${escapeHtml(t("loadErrorBody"))}</p>`;
  }
}

async function loadGuide(key) {
  const source = GUIDE_SOURCES[key];
  let text = "";

  try {
    const response = await fetch(source.path);
    if (!response.ok) throw new Error(`Guide could not be loaded: ${response.status}`);
    text = await response.text();
  } catch (error) {
    text = typeof source.fallback === "string" ? source.fallback : source.fallback.value || "";
  }

  if (!text.trim()) throw new Error(`No guide text for ${key}`);

  state.guides[key].text = text;
  state.guides[key].entries = parseGuide(text);
}

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = els.input.value.trim();
  if (!query) return;

  addMedication(query);
  els.input.value = "";
  els.input.focus();
});

els.printBtn.addEventListener("click", () => {
  window.print();
});

els.clearBtn.addEventListener("click", () => {
  currentGuide().selected = [];
  render();
  setStatus(t("cleared"));
  els.input.focus();
});

els.guideButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveGuide(button.dataset.guide);
  });
});

function setActiveGuide(key, announce = true) {
  state.activeGuide = key;
  els.guideButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.guide === key);
  });
  populateOptions(currentGuide().entries);
  render();

  if (announce) {
    setStatus(t("loaded", currentGuide().entries.length));
  }
}

function applyStaticText() {
  els.eyebrow.textContent = t("eyebrow");
  els.title.textContent = t("title");
  els.entryTitle.textContent = t("entryTitle");
  els.patientModeBtn.textContent = t("patientMode");
  els.detailedModeBtn.textContent = t("detailedMode");
  els.label.textContent = t("drugLabel");
  els.input.placeholder = t("placeholder");
  els.form.querySelector("button[type='submit']").textContent = t("add");
  els.resultsTitle.textContent = t("resultsTitle");
  els.clearBtn.textContent = t("clear");
  els.guideTitle.textContent = `${t("sourceTitle")} - ${state.activeGuide === "patient" ? t("patientMode") : t("detailedMode")}`;
  els.printLabel.textContent = t("print");
  els.printBtn.setAttribute("aria-label", t("print"));
  els.printBtn.title = t("print");

  if (!currentGuide().text) {
    setStatus(t("loading"));
  }
}

function parseGuide(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const entries = [];
  const start = findContentStart(lines);
  const end = findContentEnd(lines, start);

  for (let index = start; index < end; index += 1) {
    const title = lines[index].trim();
    if (!isEntryTitle(title, lines[index + 1])) continue;

    let nextIndex = end;
    for (let cursor = index + 1; cursor < end; cursor += 1) {
      const candidate = lines[cursor].trim();
      if (candidate && isEntryTitle(candidate, lines[cursor + 1])) {
        nextIndex = cursor;
        break;
      }
    }

    const content = trimBlankEdges(lines.slice(index, nextIndex)).join("\n");
    const entry = {
      id: slugify(`${title}-${index}`),
      title,
      aliases: buildAliases(title, content),
      content,
      searchText: normalize(`${title}\n${content}`),
      type: /^\d+\.\s/.test(title) ? "category" : "drug"
    };

    entries.push(entry);
    entries.push(...buildExampleMedicationEntries(entry, index));
  }

  return entries;
}

function findContentStart(lines) {
  const markers = ["Common Medication Groups", "Medication Groups", "Part 1:"];
  for (const marker of markers) {
    const found = lines.findIndex((line) => line.trim().startsWith(marker));
    if (found !== -1) return found;
  }
  return 0;
}

function findContentEnd(lines, start) {
  const markers = ["Documentation Prompts", "Source Notes", "Part 3:"];
  for (const marker of markers) {
    const found = lines.findIndex((line, index) => index > start && line.trim().startsWith(marker));
    if (found !== -1) return found;
  }
  return lines.length;
}

function isEntryTitle(title, nextLine = "") {
  if (!title || title.startsWith("-")) return false;
  if (/^(Examples|Simple purpose|Common side effects|Common or expected side effects|Less common but important warning signs|Monitoring or escalation|Tell the nurse|Pharmacy safety check|Patient-controlled safety point|Medication history point|Practical tip|Basic counseling points|General pharmacist counseling points|General inpatient counseling points):$/i.test(title)) return false;
  if (/^Part \d+:/i.test(title)) return false;
  if (/^[A-F]\. /.test(title)) return false;
  if (/^\d+\. /.test(title)) return true;

  const next = (nextLine || "").trim();
  return next.startsWith("-") && title.length < 80;
}

function trimBlankEdges(lines) {
  const copy = [...lines];
  while (copy.length && !copy[0].trim()) copy.shift();
  while (copy.length && !copy[copy.length - 1].trim()) copy.pop();
  return copy;
}

function buildAliases(title, content) {
  const aliases = new Set([title]);
  aliases.add(title.replace(/^\d+\.\s*/, ""));
  splitAliasTitle(title).forEach((alias) => aliases.add(alias));

  extractExamples(content).forEach((example) => aliases.add(example));

  const appliesMatch = content.match(/^- Applies to:\s*(.+)$/im);
  if (appliesMatch) {
    splitExamples(appliesMatch[1].replace(/\.$/, "")).forEach((alias) => aliases.add(alias));
  }

  return [...aliases];
}

function buildExampleMedicationEntries(entry, start) {
  if (!/^\d+\.\s/.test(entry.title)) return [];

  const examples = extractExamples(entry.content);
  if (!examples.length) return [];

  const category = entry.title.replace(/^\d+\.\s*/, "");
  const counselingText = entry.content
    .split("\n")
    .slice(1)
    .join("\n")
    .replace(/^Examples:\n(?:- .+\n?)+\n?/im, "")
    .replace(/^Examples:\n(?:.+\n?)+?\n\n/im, "")
    .trim();

  return examples.map((drug) => ({
    id: slugify(`${drug}-${start}`),
    title: drug,
    aliases: buildAliases(drug, counselingText),
    content: `${drug}\nCategory: ${category}\n\n${counselingText}`,
    searchText: normalize(`${drug}\n${category}\n${counselingText}`),
    category,
    type: "drug"
  }));
}

function extractExamples(content) {
  const blockMatch = content.match(/^Examples:\n([\s\S]*?)(?:\n\n|$)/im);
  if (!blockMatch) return [];

  return blockMatch[1]
    .split("\n")
    .flatMap((line) => splitExamples(line.replace(/^-\s*/, "")))
    .map((item) => item.replace(/\.$/, "").trim())
    .filter(Boolean);
}

function splitExamples(value) {
  return value
    .split(/,|;|\s+and\s+/i)
    .map((item) => item.trim())
    .filter((item) => item.length > 1);
}

function splitAliasTitle(title) {
  return title
    .split(/\s*\/\s*|\s+or\s+|\s+and\s+/i)
    .map((item) => item.trim())
    .filter((item) => item.length > 2);
}

function populateOptions(entries) {
  const names = new Set();
  entries
    .filter((entry) => entry.type === "drug")
    .forEach((entry) => getDrugOptionNames(entry).forEach((name) => names.add(name)));
  els.options.innerHTML = [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => `<option value="${escapeHtml(name)}"></option>`)
    .join("");
}

function getDrugOptionNames(entry) {
  if (entry.category) return [entry.title];

  const parentheticalNames = [...entry.title.matchAll(/\(([^)]+)\)/g)]
    .flatMap((match) => splitAliasTitle(match[1]));
  const titleWithoutParentheticals = entry.title.replace(/\s*\([^)]*\)\s*/g, " ").trim();

  return parentheticalNames
    .concat(splitAliasTitle(titleWithoutParentheticals), titleWithoutParentheticals, extractExamples(entry.content))
    .map((name) => name.replace(/\s*\([^)]*\)\s*/g, " ").trim())
    .filter(isDrugOptionName);
}

function isDrugOptionName(name) {
  if (!name || name.length > 60) return false;
  return !/^(additional|antibiotics|anticoagulants|antiplatelets|antivirals|antifungals|basic|blood pressure|bowel|common|corticosteroids|diabetes|diuretics|examples|general|heart failure|infection|inhalers|medications|pain|part|psychiatric|rejection|seizure|source|table|transplant)/i.test(name)
    && !/\b(category|counseling|focus|guide|medications|note|section|shared|subcutaneous)\b/i.test(name);
}

function addMedication(query) {
  const matches = findMatches(query);

  currentGuide().selected.push({
    id: window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`,
    query,
    matches
  });

  const exact = matches.find((match) => normalize(match.title) === normalize(query));
  if (exact) {
    setStatus(t("addedExact", exact.title));
  } else if (matches.length) {
    setStatus(t("addedClosest", query));
  } else {
    setStatus(t("addedMissing", query), true);
  }

  render();
}

function findMatches(query) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];

  const exactAlias = currentGuide().entries.filter((entry) =>
    entry.aliases.some((alias) => normalize(alias) === normalizedQuery)
  );
  if (exactAlias.length) return exactAlias;

  const titleContains = currentGuide().entries.filter((entry) =>
    entry.aliases.some((alias) => normalize(alias).includes(normalizedQuery) || normalizedQuery.includes(normalize(alias)))
  );
  if (titleContains.length) return titleContains.slice(0, 3);

  return currentGuide().entries
    .filter((entry) => entry.searchText.includes(normalizedQuery))
    .slice(0, 3);
}

function render() {
  applyStaticText();
  renderSelectedList();
  renderResults();
  renderFullGuide();
}

function renderSelectedList() {
  if (!currentGuide().selected.length) {
    els.selectedList.innerHTML = "";
    return;
  }

  els.selectedList.innerHTML = currentGuide().selected
    .map((item) => `
      <span class="pill">
        <span>${escapeHtml(item.query)}</span>
        <button type="button" aria-label="${escapeHtml(t("remove"))} ${escapeHtml(item.query)}" data-remove="${item.id}">x</button>
      </span>
    `)
    .join("");

  els.selectedList.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      currentGuide().selected = currentGuide().selected.filter((item) => item.id !== button.dataset.remove);
      render();
    });
  });
}

function renderResults() {
  if (!currentGuide().selected.length) {
    els.results.classList.add("empty");
    els.results.innerHTML = `<p>${escapeHtml(t("empty"))}</p>`;
    return;
  }

  els.results.classList.remove("empty");
  els.results.innerHTML = currentGuide().selected
    .map((item) => {
      if (!item.matches.length) {
        return `
          <article class="med-card">
            <h3>${escapeHtml(item.query)}</h3>
            <p class="query">${escapeHtml(t("noMatch"))}</p>
          </article>
        `;
      }

      return item.matches
        .map((match) => `
          <article class="med-card">
            <h3>${escapeHtml(match.title)}</h3>
            <p class="query">${escapeHtml(t("entered"))} ${escapeHtml(item.query)}</p>
            <pre>${escapeHtml(match.content)}</pre>
          </article>
        `)
        .join("");
    })
    .join("");
}

function renderFullGuide() {
  els.guideTitle.textContent = `${t("sourceTitle")} - ${state.activeGuide === "patient" ? t("patientMode") : t("detailedMode")}`;
  els.fullGuide.textContent = currentGuide().text;
}

function setStatus(message, warn = false) {
  els.status.textContent = message;
  els.status.classList.toggle("warn", warn);
}

function currentGuide() {
  return state.guides[state.activeGuide];
}

function t(key, ...args) {
  const value = TEXT[key];
  return typeof value === "function" ? value(...args) : value;
}

function normalize(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugify(value) {
  return normalize(value).replace(/\s+/g, "-");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
