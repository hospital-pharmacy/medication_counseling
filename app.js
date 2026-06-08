const GUIDE_PATH = "medication_counseling_guide.txt";

const state = {
  guideText: "",
  entries: [],
  selected: []
};

const els = {
  form: document.getElementById("drugForm"),
  input: document.getElementById("drugInput"),
  options: document.getElementById("drugOptions"),
  status: document.getElementById("statusText"),
  selectedList: document.getElementById("selectedList"),
  results: document.getElementById("results"),
  fullGuide: document.getElementById("fullGuide"),
  printBtn: document.getElementById("printBtn"),
  clearBtn: document.getElementById("clearBtn")
};

init();

async function init() {
  try {
    if (window.COUNSELING_GUIDE_TEXT) {
      state.guideText = typeof window.COUNSELING_GUIDE_TEXT === "string"
        ? window.COUNSELING_GUIDE_TEXT
        : window.COUNSELING_GUIDE_TEXT.value;
    } else {
      const response = await fetch(GUIDE_PATH);
      if (!response.ok) {
        throw new Error(`Guide could not be loaded: ${response.status}`);
      }
      state.guideText = await response.text();
    }

    state.entries = parseGuide(state.guideText);
    els.fullGuide.textContent = state.guideText;
    populateOptions(state.entries);
    setStatus(`Loaded ${state.entries.length} counseling entries. Enter a medication and press Enter.`);
  } catch (error) {
    setStatus("Unable to load the guide. Start this folder with a local web server and refresh.", true);
    els.results.classList.add("empty");
    els.results.innerHTML = "<p>The medication guide file could not be loaded.</p>";
  }
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
  state.selected = [];
  render();
  setStatus("Medication list cleared.");
  els.input.focus();
});

function parseGuide(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const entries = [];
  const contentStart = lines.findIndex((line, index) => index > 100 && line.trim().startsWith("Part 1:"));
  const contentEnd = lines.findIndex((line, index) => index > contentStart && line.trim().startsWith("Part 3:"));
  const startAt = contentStart === -1 ? 0 : contentStart;
  const stopAt = contentEnd === -1 ? lines.length : contentEnd;

  for (let index = startAt; index < stopAt; index += 1) {
    const title = lines[index].trim();
    if (!isEntryTitle(title, lines[index + 1])) continue;

    const start = index;
    let end = stopAt;

    for (let cursor = index + 1; cursor < stopAt; cursor += 1) {
      const candidate = lines[cursor].trim();
      if (candidate && isEntryTitle(candidate, lines[cursor + 1])) {
        end = cursor;
        break;
      }
    }

    const content = trimBlankEdges(lines.slice(start, end)).join("\n");
    const entry = {
      id: slugify(`${title}-${start}`),
      title,
      aliases: buildAliases(title, content),
      content,
      searchText: normalize(`${title}\n${content}`),
      type: /^\d+\.\s/.test(title) ? "category" : "drug"
    };

    entries.push(entry);
    entries.push(...buildExampleMedicationEntries(entry, start));
  }

  return entries;
}

function isEntryTitle(title, nextLine = "") {
  if (!title || title.startsWith("-")) return false;
  if (/^(Examples|Basic counseling points|General pharmacist counseling points|General inpatient counseling points):$/i.test(title)) return false;
  if (/^Part \d+:/i.test(title)) return false;
  if (/^[A-F]\. /.test(title)) return false;
  if (/^\d+\. /.test(title)) return true;

  const next = (nextLine || "").trim();
  return next.startsWith("-");
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

  const appliesMatch = content.match(/^- Applies to:\s*(.+)$/im);
  if (appliesMatch) {
    appliesMatch[1]
      .replace(/\.$/, "")
      .split(/,| and /)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((alias) => aliases.add(alias));
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
  const match = content.match(/^Examples:\n((?:- .+\n?)+)/im);
  if (!match) return [];

  return match[1]
    .split("\n")
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter(Boolean);
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
    .forEach((entry) => entry.aliases.forEach((alias) => names.add(alias)));
  els.options.innerHTML = [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => `<option value="${escapeHtml(name)}"></option>`)
    .join("");
}

function addMedication(query) {
  const matches = findMatches(query);

  state.selected.push({
    id: window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`,
    query,
    matches
  });

  const exact = matches.find((match) => normalize(match.title) === normalize(query));
  if (exact) {
    setStatus(`Added ${exact.title}.`);
  } else if (matches.length) {
    setStatus(`Added ${query}; showing the closest counseling match.`);
  } else {
    setStatus(`Added ${query}; no exact counseling entry was found.`, true);
  }

  render();
}

function findMatches(query) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];

  const exactAlias = state.entries.filter((entry) =>
    entry.aliases.some((alias) => normalize(alias) === normalizedQuery)
  );
  if (exactAlias.length) return exactAlias;

  const titleContains = state.entries.filter((entry) =>
    entry.aliases.some((alias) => normalize(alias).includes(normalizedQuery) || normalizedQuery.includes(normalize(alias)))
  );
  if (titleContains.length) return titleContains.slice(0, 3);

  return state.entries
    .filter((entry) => entry.searchText.includes(normalizedQuery))
    .slice(0, 3);
}

function render() {
  renderSelectedList();
  renderResults();
}

function renderSelectedList() {
  if (!state.selected.length) {
    els.selectedList.innerHTML = "";
    return;
  }

  els.selectedList.innerHTML = state.selected
    .map((item) => `
      <span class="pill">
        <span>${escapeHtml(item.query)}</span>
        <button type="button" aria-label="Remove ${escapeHtml(item.query)}" data-remove="${item.id}">x</button>
      </span>
    `)
    .join("");

  els.selectedList.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selected = state.selected.filter((item) => item.id !== button.dataset.remove);
      render();
    });
  });
}

function renderResults() {
  if (!state.selected.length) {
    els.results.classList.add("empty");
    els.results.innerHTML = "<p>Add a medication to build the counseling handout.</p>";
    return;
  }

  els.results.classList.remove("empty");
  els.results.innerHTML = state.selected
    .map((item) => {
      if (!item.matches.length) {
        return `
          <article class="med-card">
            <h3>${escapeHtml(item.query)}</h3>
            <p class="query">No matching counseling entry found in the guide.</p>
          </article>
        `;
      }

      return item.matches
        .map((match) => `
          <article class="med-card">
            <h3>${escapeHtml(match.title)}</h3>
            <p class="query">Entered medication: ${escapeHtml(item.query)}</p>
            <pre>${escapeHtml(match.content)}</pre>
          </article>
        `)
        .join("");
    })
    .join("");
}

function setStatus(message, warn = false) {
  els.status.textContent = message;
  els.status.classList.toggle("warn", warn);
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
