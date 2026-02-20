const API = {
  words: "/api/words",
  word: (w, family = "") => {
    const f = String(family || "").trim();
    return `/api/word?word=${encodeURIComponent(w)}${f ? `&family=${encodeURIComponent(f)}` : ""}`;
  },
  preview: (w, candidate, family = "") => {
    const f = String(family || "").trim();
    return `/api/preview?word=${encodeURIComponent(w)}&candidate=${encodeURIComponent(candidate)}${f ? `&family=${encodeURIComponent(f)}` : ""}`;
  },
  jobs: "/api/jobs",
  job: (id) => `/api/jobs/${encodeURIComponent(id)}`,
  regenerateWord: "/api/jobs/regenerate-word",
  renderWord: "/api/jobs/render-word",
  renderMany: "/api/jobs/render-many",
  pick: "/api/jobs/pick",
  replace: "/api/jobs/replace",
  deleteWord: "/api/words/delete",
  updateMeaning: "/api/words/update-meaning",
  cutClips: "/api/jobs/cut-clips",
};

const TOP_K = 5;

const state = {
  words: [],
  selectedWords: new Set(),
  selectedWord: null,
  wordDetail: null,
  reviewRows: [],
  reviewClipReady: {},
  basePicks: [],
  draftPicks: [],
  slotSelected: [false, false, false, false, false],
  slotReasons: ["", "", "", "", ""],
  previewCache: {},
  currentJobId: null,
  currentJob: null,
  queueMeta: null,
};

const el = {
  refreshBtn: document.getElementById("refreshBtn"),
  renderSelectedBtn: document.getElementById("renderSelectedBtn"),
  statusMsg: document.getElementById("statusMsg"),
  queueMeta: document.getElementById("queueMeta"),

  searchInput: document.getElementById("searchInput"),
  statusFilter: document.getElementById("statusFilter"),
  wordCount: document.getElementById("wordCount"),
  selectVisibleBtn: document.getElementById("selectVisibleBtn"),
  clearSelectionBtn: document.getElementById("clearSelectionBtn"),
  rangeStartInput: document.getElementById("rangeStartInput"),
  rangeEndInput: document.getElementById("rangeEndInput"),
  renderRangeBtn: document.getElementById("renderRangeBtn"),
  wordList: document.getElementById("wordList"),

  reviewStartInput: document.getElementById("reviewStartInput"),
  reviewCountSelect: document.getElementById("reviewCountSelect"),
  loadReviewBtn: document.getElementById("loadReviewBtn"),
  reviewMeta: document.getElementById("reviewMeta"),
  reviewGrid: document.getElementById("reviewGrid"),

  emptyState: document.getElementById("emptyState"),
  wordPanel: document.getElementById("wordPanel"),
  wordTitle: document.getElementById("wordTitle"),
  wordMeta: document.getElementById("wordMeta"),
  regenWordBtn: document.getElementById("regenWordBtn"),
  renderWordBtn: document.getElementById("renderWordBtn"),
  openOutputBtn: document.getElementById("openOutputBtn"),
  deleteWordBtn: document.getElementById("deleteWordBtn"),

  slotRow: document.getElementById("slotRow"),
  slotSelectionInfo: document.getElementById("slotSelectionInfo"),
  selectAllSlotsBtn: document.getElementById("selectAllSlotsBtn"),
  clearSlotSelectionBtn: document.getElementById("clearSlotSelectionBtn"),
  resetPicksBtn: document.getElementById("resetPicksBtn"),
  applyPickBtn: document.getElementById("applyPickBtn"),
  applyReplaceBtn: document.getElementById("applyReplaceBtn"),
  pickCmd: document.getElementById("pickCmd"),
  replaceCmd: document.getElementById("replaceCmd"),

  outputPath: document.getElementById("outputPath"),
  outputPreview: document.getElementById("outputPreview"),

  candidateLimit: document.getElementById("candidateLimit"),
  candidateGrid: document.getElementById("candidateGrid"),
  notesList: document.getElementById("notesList"),

  jobMeta: document.getElementById("jobMeta"),
  jobLog: document.getElementById("jobLog"),
};

function setStatus(msg, isError = false) {
  el.statusMsg.textContent = msg;
  el.statusMsg.style.color = isError ? "#b42318" : "";
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function uniquePositiveInts(values) {
  const out = [];
  const seen = new Set();
  for (const raw of values || []) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function fillToTopK(picks, pool = []) {
  const out = uniquePositiveInts(picks);
  for (const n of uniquePositiveInts(pool)) {
    if (out.length >= TOP_K) break;
    if (!out.includes(n)) out.push(n);
  }
  let k = 1;
  while (out.length < TOP_K) {
    if (!out.includes(k)) out.push(k);
    k++;
  }
  return out.slice(0, TOP_K);
}

function clampInt(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  const v = Math.trunc(x);
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function wordsSortedByIndex() {
  return state.words.slice().sort((a, b) => Number(a.idx || 0) - Number(b.idx || 0));
}

function wordsInIndexRange(startIdx, endIdx) {
  const start = Math.min(startIdx, endIdx);
  const end = Math.max(startIdx, endIdx);
  return wordsSortedByIndex().filter((w) => {
    const idx = Number(w.idx || 0);
    return idx >= start && idx <= end;
  });
}

function shellQuoteSingle(s) {
  return `'${String(s || "").replace(/'/g, `'"'"'`)}'`;
}

async function getJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return await res.json();
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

function statusPillClass(status) {
  const s = String(status || "");
  if (s.includes("rendered") || s === "rank:ok") return "ok";
  if (s.includes("failed") || s.includes("error")) return "bad";
  return "mid";
}

function filterWords() {
  const q = el.searchInput.value.trim().toLowerCase();
  const sf = el.statusFilter.value;
  return state.words.filter((w) => {
    const qOk = !q || String(w.word).toLowerCase().includes(q);
    const ws = String(w.status || "");
    const sOk =
      sf === "all" ||
      ws === sf ||
      (sf === "rank:error" && ws.startsWith("rank:error"));
    return qOk && sOk;
  });
}

function renderWordList() {
  const rows = filterWords();
  el.wordCount.textContent = `${rows.length} shown / ${state.words.length} total`;
  el.wordList.innerHTML = "";

  for (const row of rows) {
    const li = document.createElement("li");
    li.className = `word-item${row.word === state.selectedWord ? " active" : ""}`;

    const checked = state.selectedWords.has(row.word) ? "checked" : "";
    li.innerHTML = `
      <div class="word-row">
        <div class="word-left">
          <input type="checkbox" data-checkword="${escapeHtml(row.word)}" ${checked} />
          <span class="word">${escapeHtml(row.word)}</span>
        </div>
        <span class="pill ${statusPillClass(row.status)}">${escapeHtml(row.status)}</span>
      </div>
      <div class="word-row muted">
        <span>${escapeHtml(row.reading || "-")}</span>
        <span>${escapeHtml(row.romaji || "-")}</span>
      </div>
      <div class="word-row muted">
        <span title="${escapeHtml(row.meaning || "-")}">${escapeHtml(row.meaning || "-")}</span>
      </div>
      <div class="word-row muted">
        <span>#${row.idx}</span>
        <span>picks ${row.picks.join(",")}</span>
      </div>
    `;

    li.addEventListener("click", (e) => {
      if (e.target && e.target.matches('input[type="checkbox"]')) return;
      state.selectedWord = row.word;
      loadWordDetail(row.word);
    });

    const c = li.querySelector('input[type="checkbox"]');
    c.addEventListener("change", () => {
      if (c.checked) state.selectedWords.add(row.word);
      else state.selectedWords.delete(row.word);
      updateTopButtons();
      // Checkbox selection also opens the word so render controls are visible immediately.
      state.selectedWord = row.word;
      loadWordDetail(row.word);
    });

    el.wordList.appendChild(li);
  }
}

function clipMetaText(c) {
  if (!c) return "candidate metadata unavailable";
  return `${c.episode || ""} ${c.clipStart || ""}-${c.clipEnd || ""}`.trim() || "candidate metadata unavailable";
}

function slotReasonWithTags(slot) {
  const tagText = Array.isArray(slot?.badTags) && slot.badTags.length > 0
    ? slot.badTags.map((x) => `bad:${x}`).join(",")
    : "";
  const reason = String(slot?.reason || "").trim();
  if (reason && tagText) return `${reason} | ${tagText}`;
  return reason || tagText;
}

function reviewRowCombinedReason(row) {
  const parts = [];
  for (const slot of Array.isArray(row?.slots) ? row.slots : []) {
    const text = slotReasonWithTags(slot);
    if (!text) continue;
    parts.push(`S${slot.slot}:${text}`);
  }
  return parts.join(" | ");
}

function reviewCandidateSummary(row) {
  const stats = row?.candidateStats || {};
  const eff = Number(stats.effectiveCount || 0);
  const live = Number(stats.livePoolCount || 0);
  const db = Number(stats.dbCandidateCount || 0);
  const rr = Number(stats.rerankCandidateCount || 0);
  const source = String(stats.source || "");
  const clipsReady = Boolean(stats.clipsReady);
  return `candidates=${eff} source=${source || "unknown"} live=${live} db=${db} rerank=${rr} clips=${clipsReady ? "ready" : "not-cut"}`;
}

function numOr(raw, fallback = 0) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function reviewRowKey(word, family = "") {
  return `${String(word || "").trim()}::${String(family || "").trim()}`;
}

function uniqueRowPicks(row) {
  const map = row?.candidateMap instanceof Map ? row.candidateMap : null;
  const values = uniquePositiveInts((row?.slots || []).map((s) => Number(s?.candidateIndex || 0)));
  const valid = values.filter((n) => {
    if (map) return map.has(n);
    const max = Number(row?.candidateMax || 0);
    return max > 0 ? n <= max : true;
  });
  return valid.slice(0, TOP_K);
}

function nextReviewRowPicks(row, previousPicks = []) {
  const map = row?.candidateMap instanceof Map ? row.candidateMap : null;
  const indexes = uniquePositiveInts(Array.from(map ? map.keys() : []))
    .sort((a, b) => a - b);
  if (indexes.length === 0) return [];
  const need = Math.max(1, Math.min(TOP_K, indexes.length));
  if (indexes.length <= need) return indexes.slice(0, need);

  const prev = uniquePositiveInts(previousPicks).filter((n) => indexes.includes(n));
  const anchor = prev[0];
  const basePos = anchor ? indexes.indexOf(anchor) : -1;
  let pos = basePos >= 0 ? (basePos + 1) % indexes.length : 0;

  const out = [];
  const seen = new Set();
  while (out.length < need && seen.size < indexes.length) {
    const n = indexes[pos];
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
    pos = (pos + 1) % indexes.length;
  }
  return out;
}

function applyReviewRowPicks(row, picks) {
  const finalPicks = uniquePositiveInts(picks).slice(0, TOP_K);
  if (finalPicks.length === 0) return;
  const prevSlots = Array.isArray(row?.slots) ? row.slots : [];
  row.basePicks = [...finalPicks];
  row.slots = finalPicks.map((candidateIndex, i) => {
    const prev = prevSlots[i] || null;
    return {
      slot: i + 1,
      candidateIndex: Number(candidateIndex) || i + 1,
      reason: String(prev?.reason || ""),
      badTags: Array.isArray(prev?.badTags) ? [...prev.badTags] : [],
      locked: Boolean(prev?.locked),
      prePadMs: String(prev?.prePadMs ?? ""),
      postPadMs: String(prev?.postPadMs ?? ""),
    };
  });
}

function normalizeFamilyForms(forms, word) {
  const out = [];
  const seen = new Set();
  const push = (v) => {
    const s = String(v || "").trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  push(word);
  for (const f of Array.isArray(forms) ? forms : []) push(f);
  return out.slice(0, 80);
}

function buildReviewRows(baseRows, details, familyPref = new Map(), clipReadyPref = {}) {
  return baseRows.map((r, i) => {
    const d = details[i] || {};
    const map = candidateMapFromDetail(d);
    const mapIndexes = uniquePositiveInts(Array.from(map.keys()));
    const forms = normalizeFamilyForms(d?.meta?.matchForms || r.matchForms || [], r.word);
    const savedFamily = String(familyPref.get(r.word) || "").trim();
    const family = forms.includes(savedFamily) ? savedFamily : "";
    const familyMode = Boolean(family);
    const picks = familyMode
      ? mapIndexes.slice(0, TOP_K)
      : fillToTopK(Array.isArray(d.picks) ? d.picks : r.picks || [], mapIndexes);
    const dbLen = Array.isArray(d?.db?.candidates) ? d.db.candidates.length : 0;
    const liveLen = Array.isArray(d?.livePool) ? d.livePool.length : 0;
    const candMax = familyMode
      ? Math.max(...mapIndexes, 0)
      : Math.max(
          dbLen,
          liveLen,
          ...picks.map((x) => Number(x) || 0),
          1,
        );
    const key = reviewRowKey(r.word, family);
    const clipsReady =
      Boolean(clipReadyPref[key]) || Boolean(d?.candidateStats?.clipsReady);
    return {
      idx: r.idx,
      word: r.word,
      reading: r.reading,
      romaji: r.romaji,
      meaning: String(d?.meta?.meaning || r.meaning || ""),
      status: d.status || r.status || "new",
      family,
      familyForms: forms,
      meaningDraft: String(d?.meta?.meaning || r.meaning || ""),
      prePadMs: "",
      postPadMs: "",
      candidateStats: {
        effectiveCount: numOr(d?.candidateStats?.effectiveCount, candMax),
        livePoolCount: numOr(d?.candidateStats?.livePoolCount, liveLen || 0),
        dbCandidateCount: numOr(d?.candidateStats?.dbCandidateCount, dbLen || 0),
        rerankCandidateCount: numOr(d?.candidateStats?.rerankCandidateCount, 0),
        clipsReady,
        source: String(d?.candidateStats?.source || ""),
      },
      output: d.output || "",
      candidateMap: map,
      candidateMax: candMax,
      basePicks: [...picks],
      slots: picks.map((candidateIndex, slotIdx) => ({
        slot: slotIdx + 1,
        candidateIndex: Number(candidateIndex) || slotIdx + 1,
        reason: "",
        badTags: [],
        locked: false,
        prePadMs: "",
        postPadMs: "",
      })),
    };
  });
}

function renderReviewSlotCard(row, slot) {
  const wrap = document.createElement("article");
  wrap.className = "review-slot";

  const c = row.candidateMap.get(Number(slot.candidateIndex)) || null;
  const headText = String(c?.matchText || c?.jpText || "").trim().slice(0, 42);
  const clipsReady = Boolean(row?.candidateStats?.clipsReady);
  wrap.innerHTML = `
    <div class="review-slot-head">
      <strong>S${slot.slot}</strong>
      <span class="mono">#${Number(slot.candidateIndex) || slot.slot}</span>
    </div>
    <div class="muted review-slot-headtext">${escapeHtml(headText || "-")}</div>
    <div class="review-slot-preview">
      <video controls preload="metadata" playsinline></video>
      <div class="slot-preview-hint"></div>
    </div>
    <div class="slot-meta">${escapeHtml(clipMetaText(c))}</div>
    <div class="review-slot-inputs">
      <button class="btn btn-small" data-prev="1">Prev</button>
      <input type="number" min="1" step="1" value="${Number(slot.candidateIndex) || slot.slot}" />
      <button class="btn btn-small" data-next="1">Next</button>
    </div>
    <div class="review-slot-pad-inputs">
      <span class="muted">pad</span>
      <input type="number" min="0" step="10" placeholder="pre" value="${escapeHtml(String(slot.prePadMs ?? ""))}" data-slot-prepad="1" />
      <input type="number" min="0" step="10" placeholder="post" value="${escapeHtml(String(slot.postPadMs ?? ""))}" data-slot-postpad="1" />
    </div>
    <label class="slot-toggle"><input type="checkbox" ${slot.locked ? "checked" : ""}/> Lock</label>
    <div class="review-slot-tags"></div>
    <textarea rows="2" placeholder="why bad / why replace?"></textarea>
  `;

  const video = wrap.querySelector("video");
  const hint = wrap.querySelector(".slot-preview-hint");
  if (clipsReady) {
    applySlotPreview(video, hint, row.word, Number(slot.candidateIndex) || slot.slot, row.family);
  } else {
    hint.textContent = "text-only (click Cut Clips)";
  }

  const metaEl = wrap.querySelector(".slot-meta");
  const idxBadge = wrap.querySelector(".mono");
  const input = wrap.querySelector('input[type="number"]');
  const reasonBox = wrap.querySelector("textarea");
  reasonBox.value = String(slot.reason || "");
  reasonBox.addEventListener("input", () => {
    slot.reason = reasonBox.value;
  });

  const lockCb = wrap.querySelector('.slot-toggle input[type="checkbox"]');
  lockCb.addEventListener("change", () => {
    slot.locked = lockCb.checked;
  });

  const slotPrePadInput = wrap.querySelector('input[data-slot-prepad]');
  if (slotPrePadInput) {
    slotPrePadInput.addEventListener("input", () => {
      slot.prePadMs = slotPrePadInput.value;
    });
  }
  const slotPostPadInput = wrap.querySelector('input[data-slot-postpad]');
  if (slotPostPadInput) {
    slotPostPadInput.addEventListener("input", () => {
      slot.postPadMs = slotPostPadInput.value;
    });
  }

  const setCandidate = (value) => {
    let n = clampInt(value, 1, Math.max(row.candidateMax, Number(value) || 1));
    if (n > row.candidateMax) row.candidateMax = n;
    slot.candidateIndex = n;
    input.value = String(n);
    if (idxBadge) idxBadge.textContent = `#${n}`;
    const nextMeta = row.candidateMap.get(n) || null;
    metaEl.textContent = clipMetaText(nextMeta);
    const nextHead = wrap.querySelector(".review-slot-headtext");
    if (nextHead) {
      nextHead.textContent = String(nextMeta?.matchText || nextMeta?.jpText || "").trim().slice(0, 42) || "-";
    }
    if (Boolean(row?.candidateStats?.clipsReady)) {
      applySlotPreview(video, hint, row.word, n, row.family);
    } else {
      video.removeAttribute("src");
      hint.textContent = "text-only (click Cut Clips)";
    }
    if (typeof row._onSlotsChanged === "function") {
      row._onSlotsChanged();
    }
  };

  input.addEventListener("change", () => {
    setCandidate(input.value);
  });

  const prevBtn = wrap.querySelector("button[data-prev]");
  prevBtn.addEventListener("click", () => {
    setCandidate((Number(slot.candidateIndex) || 1) - 1);
  });

  const nextBtn = wrap.querySelector("button[data-next]");
  nextBtn.addEventListener("click", () => {
    setCandidate((Number(slot.candidateIndex) || 1) + 1);
  });

  const tagWrap = wrap.querySelector(".review-slot-tags");
  const tags = [
    { id: "wrong_sense", label: "Wrong Sense" },
    { id: "fragment", label: "Fragment" },
    { id: "trailing", label: "Trailing" },
  ];
  for (const t of tags) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-small";
    b.textContent = t.label;
    const syncTagClass = () => {
      const on = Array.isArray(slot.badTags) && slot.badTags.includes(t.id);
      b.classList.toggle("active", on);
    };
    b.addEventListener("click", () => {
      if (!Array.isArray(slot.badTags)) slot.badTags = [];
      if (slot.badTags.includes(t.id)) {
        slot.badTags = slot.badTags.filter((x) => x !== t.id);
      } else {
        slot.badTags.push(t.id);
      }
      syncTagClass();
    });
    syncTagClass();
    tagWrap.appendChild(b);
  }

  return wrap;
}

async function reloadReviewRowForFamily(row) {
  const family = String(row.family || "").trim();
  const d = await getJson(API.word(row.word, family));
  row.meaning = String(d?.meta?.meaning || row.meaning || "");
  row.meaningDraft = row.meaning;
  const map = candidateMapFromDetail(d);
  const mapIndexes = uniquePositiveInts(Array.from(map.keys()));
  const familyMode = Boolean(family);
  const picks = familyMode
    ? mapIndexes.slice(0, TOP_K)
    : fillToTopK(Array.isArray(d.picks) ? d.picks : row.basePicks || [], mapIndexes);
  row.candidateMap = map;
  const dbLen = Array.isArray(d?.db?.candidates) ? d.db.candidates.length : 0;
  const liveLen = Array.isArray(d?.livePool) ? d.livePool.length : 0;
  row.candidateMax = familyMode
    ? Math.max(...mapIndexes, 0)
    : Math.max(dbLen, liveLen, ...picks.map((x) => Number(x) || 0), 1);
  const key = reviewRowKey(row.word, family);
  const clipsReady =
    Boolean(state.reviewClipReady[key]) || Boolean(d?.candidateStats?.clipsReady);
  row.candidateStats = {
    effectiveCount: numOr(d?.candidateStats?.effectiveCount, row.candidateMax),
    livePoolCount: numOr(d?.candidateStats?.livePoolCount, liveLen || 0),
    dbCandidateCount: numOr(d?.candidateStats?.dbCandidateCount, dbLen || 0),
    rerankCandidateCount: numOr(d?.candidateStats?.rerankCandidateCount, 0),
    clipsReady,
    source: String(d?.candidateStats?.source || ""),
  };
  row.basePicks = [...picks];
  row.slots = picks.map((candidateIndex, slotIdx) => {
    const prev = Array.isArray(row.slots) ? row.slots[slotIdx] : null;
    return {
      slot: slotIdx + 1,
      candidateIndex: Number(candidateIndex) || slotIdx + 1,
      reason: String(prev?.reason || ""),
      badTags: Array.isArray(prev?.badTags) ? [...prev.badTags] : [],
      locked: Boolean(prev?.locked),
      prePadMs: String(prev?.prePadMs ?? ""),
      postPadMs: String(prev?.postPadMs ?? ""),
    };
  });
}

async function saveRowMeaningIfNeeded(row) {
  const family = String(row?.family || "").trim();
  if (!family) return false;

  const nextMeaning = String(row?.meaningDraft ?? row?.meaning ?? "").trim();
  const prevMeaning = String(row?.meaning || "").trim();
  if (nextMeaning === prevMeaning) return false;

  await postJson(API.updateMeaning, { word: row.word, family, meaning: nextMeaning });
  row.meaning = nextMeaning;

  return true;
}

function rowMeaningForRender(row) {
  const draft = String(row?.meaningDraft ?? "").trim();
  if (draft) return draft;
  return String(row?.meaning ?? "").trim();
}

function rowPadMsForRender(row) {
  const preRaw = String(row?.prePadMs ?? "").trim();
  const postRaw = String(row?.postPadMs ?? "").trim();
  const pre = preRaw === "" ? null : Math.max(0, Math.trunc(Number(preRaw) || 0));
  const post = postRaw === "" ? null : Math.max(0, Math.trunc(Number(postRaw) || 0));
  return { prePadMs: pre, postPadMs: post };
}

function rowSlotPadsForRender(row, picks) {
  const pickSet = new Set(uniquePositiveInts(picks || []));
  const slots = Array.isArray(row?.slots) ? row.slots : [];
  const out = [];
  for (const slot of slots) {
    const idx = Number(slot?.candidateIndex || 0);
    if (!pickSet.has(idx)) continue;
    const preRaw = String(slot?.prePadMs ?? "").trim();
    const postRaw = String(slot?.postPadMs ?? "").trim();
    if (preRaw === "" && postRaw === "") continue;
    out.push({
      candidateIndex: idx,
      prePadMs: preRaw === "" ? null : Math.max(0, Math.trunc(Number(preRaw) || 0)),
      postPadMs: postRaw === "" ? null : Math.max(0, Math.trunc(Number(postRaw) || 0)),
    });
  }
  return out;
}

function renderReviewGrid() {
  const rows = Array.isArray(state.reviewRows) ? state.reviewRows : [];
  el.reviewGrid.innerHTML = "";

  if (rows.length === 0) {
    el.reviewMeta.textContent = "Load 5-10 words. You will see all 5 clip picks for each word.";
    return;
  }

  const first = rows[0]?.idx || "?";
  const last = rows[rows.length - 1]?.idx || "?";
  el.reviewMeta.textContent = `Loaded ${rows.length} words (#${first}-${last}) | showing 5 clips per word`;

  for (const row of rows) {
    const card = document.createElement("article");
    card.className = "review-card review-card-audit";
    card.innerHTML = `
      <div class="review-top">
        <strong>#${row.idx} ${escapeHtml(row.word)}</strong>
        <span class="pill ${statusPillClass(row.status)}">${escapeHtml(row.status || "new")}</span>
      </div>
      <div class="muted review-meta-line">${escapeHtml(row.reading || "-")} | ${escapeHtml(row.romaji || "-")} | ${escapeHtml(row.meaning || "-")}</div>
      <div class="muted review-meta-line">picks ${escapeHtml((row.slots || []).map((s) => s.candidateIndex).join(","))}${row.family ? ` | family=${escapeHtml(row.family)}` : ""}</div>
      <div class="muted review-meta-line">${escapeHtml(reviewCandidateSummary(row))}</div>
      <div class="review-family-row"></div>
      <div class="review-meaning-row"></div>
      <div class="review-slot-grid"></div>
      <div class="review-actions"></div>
    `;

    const familyRow = card.querySelector(".review-family-row");
    const familySelect = document.createElement("select");
    const allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent = "All Forms (Mix)";
    familySelect.appendChild(allOpt);
    for (const f of Array.isArray(row.familyForms) ? row.familyForms : []) {
      if (f === row.word) continue;
      const opt = document.createElement("option");
      opt.value = f;
      opt.textContent = f;
      familySelect.appendChild(opt);
    }
    familySelect.value = String(row.family || "");
    const familyBtn = document.createElement("button");
    familyBtn.className = "btn btn-small";
    familyBtn.textContent = "Load Family";
    familyBtn.addEventListener("click", async () => {
      row.family = String(familySelect.value || "").trim();
      setStatus(`Loading ${row.word}${row.family ? ` family=${row.family}` : ""}...`);
      try {
        await reloadReviewRowForFamily(row);
        renderReviewGrid();
        const n = Number(row?.candidateStats?.effectiveCount || row?.candidateMax || 0);
        const clips = Boolean(row?.candidateStats?.clipsReady) ? "ready" : "not-cut";
        setStatus(
          `Loaded ${row.word}${row.family ? ` family=${row.family}` : ""} (candidates=${n}, clips=${clips}).`,
        );
      } catch (err) {
        setStatus(err?.message || String(err), true);
      }
    });
    const familyLabel = document.createElement("span");
    familyLabel.className = "muted";
    familyLabel.textContent = "family";
    familyRow.appendChild(familyLabel);
    familyRow.appendChild(familySelect);
    familyRow.appendChild(familyBtn);

    const meaningRow = card.querySelector(".review-meaning-row");
    const meaningLabel = document.createElement("span");
    meaningLabel.className = "muted";
    meaningLabel.textContent = "meaning";
    const meaningInput = document.createElement("input");
    meaningInput.type = "text";
    meaningInput.value = String(row.meaningDraft ?? row.meaning ?? "");
    meaningInput.placeholder = "edit meaning";
    meaningInput.addEventListener("input", () => {
      row.meaningDraft = meaningInput.value;
    });
    const saveMeaningBtn = document.createElement("button");
    saveMeaningBtn.className = "btn btn-small";
    const familyMode = Boolean(String(row.family || "").trim());
    saveMeaningBtn.textContent = familyMode ? "Save Family Meaning" : "Family Meaning (Select Family)";
    saveMeaningBtn.disabled = !familyMode;
    saveMeaningBtn.addEventListener("click", async () => {
      try {
        const changed = await saveRowMeaningIfNeeded(row);
        setStatus(changed ? `Saved family meaning for ${row.word} (${row.family}).` : `Meaning unchanged for ${row.word}.`);
        renderReviewGrid();
      } catch (err) {
        setStatus(err?.message || String(err), true);
      }
    });
    meaningRow.appendChild(meaningLabel);
    meaningRow.appendChild(meaningInput);
    meaningRow.appendChild(saveMeaningBtn);
    const padLabel = document.createElement("span");
    padLabel.className = "muted";
    padLabel.textContent = "pad ms";
    const prePadInput = document.createElement("input");
    prePadInput.type = "number";
    prePadInput.min = "0";
    prePadInput.step = "10";
    prePadInput.placeholder = "pre";
    prePadInput.value = String(row.prePadMs ?? "");
    prePadInput.className = "pad-input";
    prePadInput.addEventListener("input", () => {
      row.prePadMs = prePadInput.value;
    });
    const postPadInput = document.createElement("input");
    postPadInput.type = "number";
    postPadInput.min = "0";
    postPadInput.step = "10";
    postPadInput.placeholder = "post";
    postPadInput.value = String(row.postPadMs ?? "");
    postPadInput.className = "pad-input";
    postPadInput.addEventListener("input", () => {
      row.postPadMs = postPadInput.value;
    });
    meaningRow.appendChild(padLabel);
    meaningRow.appendChild(prePadInput);
    meaningRow.appendChild(postPadInput);

    const slotGrid = card.querySelector(".review-slot-grid");
    const familyModeSlots = Boolean(String(row.family || "").trim());
    const slotLimit = familyModeSlots
      ? Math.max(0, Math.min(TOP_K, numOr(row?.candidateStats?.effectiveCount, row?.slots?.length || 0)))
      : TOP_K;
    if (familyModeSlots && slotLimit === 0) {
      const none = document.createElement("div");
      none.className = "muted";
      none.textContent = "No candidates found for this family form in subtitle text.";
      slotGrid.appendChild(none);
    }
    for (let i = 0; i < slotLimit; i++) {
      const slot = row.slots[i] || {
        slot: i + 1,
        candidateIndex: i + 1,
        reason: "",
        badTags: [],
        locked: false,
        prePadMs: "",
        postPadMs: "",
      };
      row.slots[i] = slot;
      slotGrid.appendChild(renderReviewSlotCard(row, slot));
    }

    const actions = card.querySelector(".review-actions");
    const openBtn = document.createElement("button");
    openBtn.className = "btn btn-small";
    openBtn.textContent = "Open In Editor";
    openBtn.addEventListener("click", () => {
      state.selectedWord = row.word;
      loadWordDetail(row.word);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    const renderOneBtn = document.createElement("button");
    renderOneBtn.className = "btn btn-small";
    renderOneBtn.textContent = "Render This";
    renderOneBtn.addEventListener("click", async () => {
      const picks = uniqueRowPicks(row);
      try {
        await saveRowMeaningIfNeeded(row);
      } catch (err) {
        setStatus(err?.message || String(err), true);
        return;
      }
      const reason = reviewRowCombinedReason(row);
      if (picks.length < 3) {
        setStatus(`Need at least 3 unique clips for ${row.word}.`, true);
        return;
      }
      await enqueueAndPoll(
        API.pick,
        {
          word: row.word,
          family: row.family || "",
          meaning: rowMeaningForRender(row),
          ...rowPadMsForRender(row),
          slotPads: rowSlotPadsForRender(row, picks),
          picks: picks.slice(0, TOP_K),
          reason,
        },
        `Queued render ${row.word}${row.family ? ` family=${row.family}` : ""}`,
      );
      await loadReviewRange();
    });

    const cutClipsBtn = document.createElement("button");
    cutClipsBtn.className = "btn btn-small";
    cutClipsBtn.textContent = "Cut Clips";
    cutClipsBtn.addEventListener("click", async () => {
      const picks = uniquePositiveInts((row.slots || []).map((s) => Number(s.candidateIndex)));
      if (picks.length === 0) {
        setStatus(`No candidate picks to cut for ${row.word}.`, true);
        return;
      }
      await enqueueAndPoll(
        API.cutClips,
        { word: row.word, family: row.family || "", picks: picks.slice(0, TOP_K) },
        `Queued cut clips ${row.word}${row.family ? ` family=${row.family}` : ""}`,
      );
      state.reviewClipReady[reviewRowKey(row.word, row.family || "")] = true;
      await loadReviewRange();
    });

    const regenRowBtn = document.createElement("button");
    regenRowBtn.className = "btn btn-small";
    regenRowBtn.textContent = "Regenerate Row";
    regenRowBtn.addEventListener("click", async () => {
      const prevPicks = uniqueRowPicks(row);
      await enqueueAndPoll(
        API.regenerateWord,
        { word: row.word, family: row.family || "" },
        `Queued candidate regeneration for ${row.word}${row.family ? ` family=${row.family}` : ""}`,
      );
      state.reviewClipReady[reviewRowKey(row.word, row.family || "")] = true;
      await loadReviewRange();
      const refreshed =
        getReviewRowByIdx(Number(row.idx || 0)) || getReviewRowByWord(row.word);
      if (refreshed) {
        const next = nextReviewRowPicks(refreshed, prevPicks);
        if (next.length > 0) {
          applyReviewRowPicks(refreshed, next);
          renderReviewGrid();
        }
      }
    });

    const applyRowBtn = document.createElement("button");
    applyRowBtn.className = "btn btn-small btn-primary";
    applyRowBtn.textContent = "Apply Picks + Stitch";
    applyRowBtn.addEventListener("click", async () => {
      const picks = uniqueRowPicks(row);
      if (picks.length < 3) {
        setStatus(`Need at least 3 unique clips for ${row.word}.`, true);
        return;
      }
      try {
        await saveRowMeaningIfNeeded(row);
      } catch (err) {
        setStatus(err?.message || String(err), true);
        return;
      }
      const reason = reviewRowCombinedReason(row);
      await enqueueAndPoll(
        API.pick,
        {
          word: row.word,
          family: row.family || "",
          meaning: rowMeaningForRender(row),
          ...rowPadMsForRender(row),
          slotPads: rowSlotPadsForRender(row, picks),
          picks: picks.slice(0, TOP_K),
          reason,
        },
        `Queued pick ${row.word}${row.family ? ` family=${row.family}` : ""}`,
      );
      await loadReviewRange();
    });

    const refreshActionLabels = () => {
      const picks = uniqueRowPicks(row);
      const n = picks.length;
      applyRowBtn.textContent = `Apply ${Math.max(0, Math.min(n, TOP_K))} Picks + Stitch`;
      applyRowBtn.disabled = n < 3;
      cutClipsBtn.textContent = `Cut ${Math.max(0, Math.min(n, TOP_K))} Clips`;
      cutClipsBtn.disabled = n < 1;
    };
    row._onSlotsChanged = refreshActionLabels;
    refreshActionLabels();

    actions.appendChild(applyRowBtn);
    actions.appendChild(cutClipsBtn);
    actions.appendChild(regenRowBtn);
    actions.appendChild(renderOneBtn);
    actions.appendChild(openBtn);
    el.reviewGrid.appendChild(card);
  }
}

async function loadReviewRange() {
  if (state.words.length === 0) {
    state.reviewRows = [];
    renderReviewGrid();
    return;
  }

  const maxIdx = Math.max(...state.words.map((w) => Number(w.idx || 0)), 1);
  const start = clampInt(el.reviewStartInput?.value || 1, 1, maxIdx);
  const count = clampInt(el.reviewCountSelect?.value || 10, 1, 20);
  if (el.reviewStartInput) el.reviewStartInput.value = String(start);
  if (el.reviewCountSelect) el.reviewCountSelect.value = String(count);

  const end = Math.min(maxIdx, start + count - 1);
  const baseRows = wordsInIndexRange(start, end).slice(0, count);
  if (baseRows.length === 0) {
    state.reviewRows = [];
    renderReviewGrid();
    return;
  }

  setStatus(`Loading review range #${start}-${end} with 5-clip audit...`);
  try {
    const familyPref = new Map(
      (Array.isArray(state.reviewRows) ? state.reviewRows : []).map((r) => [
        String(r.word || ""),
        String(r.family || ""),
      ]),
    );
    const clipReadyPref = { ...(state.reviewClipReady || {}) };
    const details = await Promise.all(
      baseRows.map((r) => getJson(API.word(r.word, String(familyPref.get(r.word) || "").trim()))),
    );
    state.reviewRows = buildReviewRows(baseRows, details, familyPref, clipReadyPref);
    renderReviewGrid();
    setStatus(`Loaded review range #${start}-${end}.`);
  } catch (err) {
    setStatus(err?.message || String(err), true);
  }
}

function updateTopButtons() {
  if (!el.renderSelectedBtn) return;
  const n = state.selectedWords.size;
  el.renderSelectedBtn.textContent =
    n > 0 ? `Auto Render Checked (${n})` : "Auto Render Checked";
}

function toPreviewPath(absOrRel) {
  const p = String(absOrRel || "").trim();
  if (!p) return "";
  if (p.startsWith("/out/")) return p;
  if (p.startsWith("out/")) return `/${p}`;
  const i = p.lastIndexOf("/out/");
  if (i >= 0) return p.slice(i);
  return "";
}

function getChangedSlots() {
  const changed = [];
  for (let i = 0; i < TOP_K; i++) {
    const from = Number(state.basePicks[i]);
    const to = Number(state.draftPicks[i]);
    if (from !== to) changed.push({ slot: i + 1, from, to });
  }
  return changed;
}

function getSelectedSlotIndexes0() {
  const out = [];
  for (let i = 0; i < TOP_K; i++) {
    if (state.slotSelected[i]) out.push(i);
  }
  return out;
}

function forceUnmuted(videoEl) {
  if (!videoEl) return;
  videoEl.defaultMuted = false;
  videoEl.muted = false;
  videoEl.volume = 1;
  videoEl.removeAttribute("muted");
}

function reasonForSlot(slot1) {
  return String(state.slotReasons[slot1 - 1] || "").trim();
}

function appendReasonTag(reasonText, tag) {
  const token = `bad:${tag}`;
  const base = String(reasonText || "").trim();
  if (!base) return token;
  if (base.includes(token)) return base;
  return `${base} | ${token}`;
}

function getRenderPicksFromDraft() {
  const selected = getSelectedSlotIndexes0().sort((a, b) => a - b);
  if (selected.length === 0) {
    return { picks: fillToTopK(state.draftPicks), usingSelectedSlots: false, selectedCount: 0 };
  }
  if (selected.length < 3) {
    return {
      picks: [],
      usingSelectedSlots: true,
      selectedCount: selected.length,
      error: "Select 3-5 slots to render selected clips, or clear slot selection to render all 5.",
    };
  }

  const picks = [];
  for (const idx0 of selected) {
    const n = Number(state.draftPicks[idx0]);
    if (!Number.isInteger(n) || n <= 0) continue;
    if (!picks.includes(n)) picks.push(n);
    if (picks.length >= TOP_K) break;
  }

  if (picks.length < 3) {
    return {
      picks: [],
      usingSelectedSlots: true,
      selectedCount: selected.length,
      error: "Selected slots map to fewer than 3 unique clips. Pick different slots/candidates.",
    };
  }

  return { picks, usingSelectedSlots: true, selectedCount: selected.length };
}

function combinedReasons() {
  const parts = [];
  for (let i = 0; i < TOP_K; i++) {
    const msg = String(state.slotReasons[i] || "").trim();
    if (!msg) continue;
    parts.push(`S${i + 1}:${msg}`);
  }
  return parts.join(" | ");
}

function renderCommands() {
  if (!state.wordDetail) {
    el.pickCmd.textContent = "";
    el.replaceCmd.textContent = "";
    return;
  }

  const word = state.wordDetail.word;
  const renderSelection = getRenderPicksFromDraft();
  const picks = renderSelection.error ? "" : renderSelection.picks.join(",");
  const reason = combinedReasons();

  if (renderSelection.error) {
    el.pickCmd.textContent = `(render blocked) ${renderSelection.error}`;
  } else {
    const pickCmd = [
      "npm run -s word:pick --",
      shellQuoteSingle(word),
      picks,
      reason ? shellQuoteSingle(reason) : null,
    ]
      .filter(Boolean)
      .join(" ");
    el.pickCmd.textContent = pickCmd;
  }

  const changed = getChangedSlots();
  if (changed.length === 1) {
    const c = changed[0];
    const replaceReason = reasonForSlot(c.slot) || reason;
    const replaceCmd = [
      "npm run -s word:replace --",
      shellQuoteSingle(word),
      `${c.slot}=${c.to}`,
      replaceReason ? shellQuoteSingle(replaceReason) : null,
    ]
      .filter(Boolean)
      .join(" ");
    el.replaceCmd.textContent = replaceCmd;
  } else {
    el.replaceCmd.textContent = "(single replace command available only when exactly one slot changed)";
  }
}

async function fetchPreviewUrl(word, candidateIndex, family = "") {
  const fam = String(family || "").trim();
  const key = `${word}:${candidateIndex}:${fam}`;
  if (state.previewCache[key]) return state.previewCache[key];
  const data = await getJson(API.preview(word, candidateIndex, fam));
  const url = String(data?.url || "").trim();
  state.previewCache[key] = url;
  return url;
}

function candidateMapFromDetail(detail) {
  const map = new Map();
  const familyMode = Boolean(String(detail?.family || "").trim());
  if (familyMode) {
    const pool = Array.isArray(detail?.textPool) && detail.textPool.length > 0
      ? detail.textPool
      : Array.isArray(detail?.livePool)
        ? detail.livePool
        : [];
    pool.forEach((c, i) => {
      map.set(i + 1, { ...c, candidateIndex: i + 1 });
    });
    return map;
  }

  // Non-family mode must stay on DB/rerank candidateIndex semantics.
  const dbCands = Array.isArray(detail?.db?.candidates)
    ? detail.db.candidates
    : [];

  dbCands.forEach((c, i) => {
    map.set(i + 1, { ...c, candidateIndex: i + 1 });
  });

  for (const t of Array.isArray(detail?.rerank?.top)
    ? detail.rerank.top
    : []) {
    const idx = Number(t?.candidateIndex);
    if (!Number.isInteger(idx) || idx <= 0 || map.has(idx)) continue;
    map.set(idx, {
      candidateIndex: idx,
      rank: idx,
      score: t?.heuristicScore ?? t?.llmScore ?? 0,
      episode: t?.episode || "",
      clipStart: t?.clipStart || "",
      clipEnd: t?.clipEnd || "",
      jpText: t?.jpText || "",
      enText: t?.enText || "",
    });
  }

  // Fallback only when DB/rerank are unavailable.
  if (map.size === 0) {
    const livePool = Array.isArray(detail?.livePool) ? detail.livePool : [];
    livePool.forEach((c, i) => {
      map.set(i + 1, { ...c, candidateIndex: i + 1 });
    });
  }

  return map;
}

function candidateMap() {
  return candidateMapFromDetail(state.wordDetail);
}

function applySlotPreview(videoEl, hintEl, word, candidateIndex, family = "") {
  const fam = String(family || "").trim();
  const key = `${word}:${candidateIndex}:${fam}`;
  videoEl.dataset.previewKey = key;
  videoEl.removeAttribute("src");
  forceUnmuted(videoEl);
  hintEl.textContent = `preview #${candidateIndex}...`;

  fetchPreviewUrl(word, candidateIndex, fam)
    .then((url) => {
      if (videoEl.dataset.previewKey !== key) return;
      if (!url) {
        hintEl.textContent = `no preview (#${candidateIndex})`;
        return;
      }
      videoEl.src = url;
      forceUnmuted(videoEl);
      hintEl.textContent = "";
    })
    .catch(() => {
      if (videoEl.dataset.previewKey !== key) return;
      hintEl.textContent = `preview failed (#${candidateIndex})`;
    });
}

function renderSlotSelectionState() {
  const selectedCount = getSelectedSlotIndexes0().length;
  if (el.slotSelectionInfo) {
    el.slotSelectionInfo.textContent =
      selectedCount > 0
        ? `${selectedCount} slot${selectedCount === 1 ? "" : "s"} selected`
        : "No slots selected";
  }
}

function renderSlots() {
  el.slotRow.innerHTML = "";
  state.draftPicks = fillToTopK(state.draftPicks);
  const map = candidateMap();
  const hasCandidates = map.size > 0;

  for (let i = 0; i < TOP_K; i++) {
    const slotNum = i + 1;
    const candidateIndex = Number(state.draftPicks[i]) || slotNum;
    const c = map.get(candidateIndex) || null;

    const wrap = document.createElement("div");
    wrap.className = "slot";

    const titleRow = document.createElement("div");
    titleRow.className = "slot-title-row";
    const title = document.createElement("h4");
    title.textContent = `Slot ${slotNum}`;
    const pickToggle = document.createElement("label");
    pickToggle.className = "slot-toggle";
    pickToggle.innerHTML = `<input type="checkbox" ${state.slotSelected[i] ? "checked" : ""}/> Select`;
    const cb = pickToggle.querySelector("input");
    cb.addEventListener("change", () => {
      state.slotSelected[i] = cb.checked;
      renderSlotSelectionState();
      renderCandidates();
    });
    titleRow.appendChild(title);
    titleRow.appendChild(pickToggle);
    wrap.appendChild(titleRow);

    const previewWrap = document.createElement("div");
    previewWrap.className = "slot-preview";
    const video = document.createElement("video");
    video.controls = true;
    video.preload = "metadata";
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    forceUnmuted(video);
    const hint = document.createElement("div");
    hint.className = "slot-preview-hint";
    previewWrap.appendChild(video);
    previewWrap.appendChild(hint);
    wrap.appendChild(previewWrap);

    if (hasCandidates && c) {
      applySlotPreview(
        video,
        hint,
        state.wordDetail.word,
        candidateIndex,
        state.wordDetail?.family || "",
      );
    } else {
      hint.textContent = "click Regenerate Candidates";
    }

    const input = document.createElement("input");
    input.type = "number";
    input.min = "1";
    input.step = "1";
    input.value = String(candidateIndex);
    input.addEventListener("change", () => {
      state.draftPicks[i] = Number(input.value);
      state.draftPicks = fillToTopK(state.draftPicks);
      renderSlots();
      renderCandidates();
      renderCommands();
    });
    wrap.appendChild(input);

    const meta = document.createElement("div");
    meta.className = "slot-meta";
    meta.textContent = c
      ? `${c.episode || ""} ${c.clipStart || ""}-${c.clipEnd || ""}`.trim()
      : "candidate metadata unavailable";
    wrap.appendChild(meta);

    const note = document.createElement("textarea");
    note.rows = 2;
    note.placeholder = `why replacement in S${slotNum}?`;
    note.value = String(state.slotReasons[i] || "");
    note.addEventListener("input", () => {
      state.slotReasons[i] = note.value;
      renderCommands();
    });
    wrap.appendChild(note);

    const quickTags = document.createElement("div");
    quickTags.className = "slot-quick-tags";
    const tags = [
      { id: "wrong_sense", label: "Wrong Sense" },
      { id: "fragment", label: "Fragment" },
      { id: "trailing", label: "Trailing" },
    ];
    for (const t of tags) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-small";
      btn.textContent = t.label;
      btn.addEventListener("click", () => {
        const next = appendReasonTag(state.slotReasons[i], t.id);
        state.slotReasons[i] = next;
        note.value = next;
        renderCommands();
      });
      quickTags.appendChild(btn);
    }
    wrap.appendChild(quickTags);

    el.slotRow.appendChild(wrap);
  }

  renderSlotSelectionState();
}

function renderCandidates() {
  const map = candidateMap();
  let rows = Array.from(map.values());
  const limit = Math.max(5, Number(el.candidateLimit.value) || 40);

  rows.sort((a, b) => Number(b?.score || 0) - Number(a?.score || 0));
  rows = rows.slice(0, limit);

  const picks = fillToTopK(state.draftPicks);
  const selectedCount = getSelectedSlotIndexes0().length;
  el.candidateGrid.innerHTML = "";
  if (rows.length === 0) {
    el.candidateGrid.innerHTML =
      '<div class="muted">No candidates yet. Click "Regenerate Candidates".</div>';
    return;
  }

  for (const c of rows) {
    const idx = Number(c.candidateIndex);
    const picked = picks.includes(idx);

    const card = document.createElement("article");
    card.className = "candidate";
    card.innerHTML = `
      <div class="top">
        <strong>#${idx}</strong>
        <span class="pill ${picked ? "ok" : ""}">${picked ? "picked" : "candidate"}</span>
      </div>
      <div class="muted">${escapeHtml(c.episode || "")} ${escapeHtml(c.clipStart || "")} - ${escapeHtml(c.clipEnd || "")}</div>
      <div class="jp">${escapeHtml(c.jpText || "")}</div>
      <div class="en">${escapeHtml(c.enText || "")}</div>
      <div class="muted">score=${Number(c.score || 0).toFixed(1)}</div>
      <div class="slot-actions">
        <button class="btn btn-small" data-apply-selected="1">${
          selectedCount > 0
            ? `Use In ${selectedCount} Selected Slot${selectedCount === 1 ? "" : "s"}`
            : "Use In Selected Slots"
        }</button>
        <button class="btn btn-small" data-use-next="1">Use In Next Slot</button>
      </div>
    `;

    for (const b of card.querySelectorAll("button[data-apply-selected]")) {
      b.addEventListener("click", () => {
        const targets = getSelectedSlotIndexes0();
        if (targets.length === 0) {
          setStatus("Select one or more slots first.", true);
          return;
        }
        for (const slot of targets) {
          state.draftPicks[slot] = idx;
        }
        state.draftPicks = fillToTopK(state.draftPicks);
        renderSlots();
        renderCandidates();
        renderCommands();
      });
    }

    for (const b of card.querySelectorAll("button[data-use-next]")) {
      b.addEventListener("click", () => {
        let slot = state.draftPicks.findIndex((x) => !Number.isInteger(Number(x)));
        if (slot < 0) slot = 0;
        state.draftPicks[slot] = idx;
        state.draftPicks = fillToTopK(state.draftPicks);
        renderSlots();
        renderCandidates();
        renderCommands();
      });
    }

    el.candidateGrid.appendChild(card);
  }
}

function renderNotes() {
  const notes = Array.isArray(state.wordDetail?.notes) ? state.wordDetail.notes : [];
  el.notesList.innerHTML = "";
  if (notes.length === 0) {
    el.notesList.innerHTML = `<div class="muted">No history yet.</div>`;
    return;
  }

  for (const n of notes.slice().reverse().slice(0, 30)) {
    const div = document.createElement("div");
    div.className = "note";
    div.textContent = JSON.stringify(n);
    el.notesList.appendChild(div);
  }
}

function renderWordPanel() {
  if (!state.wordDetail) {
    el.emptyState.hidden = false;
    el.wordPanel.hidden = true;
    return;
  }

  el.emptyState.hidden = true;
  el.wordPanel.hidden = false;

  const d = state.wordDetail;
  el.wordTitle.textContent = d.word;
  el.wordMeta.textContent = `status=${d.status} | reading=${d.meta?.reading || "-"} | romaji=${d.meta?.romaji || "-"} | meaning=${d.meta?.meaning || "-"}`;

  const previewPath = toPreviewPath(d.output);
  el.outputPath.textContent = previewPath || d.output || "";
  if (previewPath) {
    el.outputPreview.src = previewPath;
    forceUnmuted(el.outputPreview);
    el.outputPreview.style.display = "block";
  } else {
    el.outputPreview.removeAttribute("src");
    el.outputPreview.style.display = "none";
  }

  renderSlots();
  renderCandidates();
  renderCommands();
  renderNotes();
}

function renderAll() {
  renderWordList();
  renderReviewGrid();
  updateTopButtons();
  renderWordPanel();
}

async function loadWords() {
  const data = await getJson(API.words);
  state.words = Array.isArray(data.words) ? data.words : [];

  if (!state.selectedWord && state.words.length > 0) {
    state.selectedWord = state.words[0].word;
  }

  if (state.selectedWord && !state.words.some((x) => x.word === state.selectedWord)) {
    state.selectedWord = state.words[0]?.word || null;
  }
}

async function loadWordDetail(word) {
  if (!word) return;
  setStatus(`Loading ${word}...`);
  try {
    const d = await getJson(API.word(word));
    state.wordDetail = d;
    state.basePicks = fillToTopK(d.picks || []);
    state.draftPicks = [...state.basePicks];
    state.slotSelected = [false, false, false, false, false];
    state.slotReasons = ["", "", "", "", ""];
    state.selectedWord = word;
    renderAll();
    setStatus(`Loaded ${word}`);
  } catch (err) {
    setStatus(err?.message || String(err), true);
  }
}

async function refreshAll() {
  try {
    setStatus("Refreshing...");
    await loadWords();
    renderAll();
    if (state.selectedWord) await loadWordDetail(state.selectedWord);
    await refreshQueueMeta();
    setStatus(`Ready. ${state.words.length} words loaded.`);
  } catch (err) {
    setStatus(err?.message || String(err), true);
  }
}

async function refreshQueueMeta() {
  try {
    const data = await getJson(API.jobs);
    state.queueMeta = data;
    el.queueMeta.textContent = `active=${data.activeJobId || "none"} | queued=${data.queueLength || 0}`;
    if (!state.currentJobId && data.activeJobId) {
      state.currentJobId = data.activeJobId;
      pollJob();
    }
  } catch {
    el.queueMeta.textContent = "";
  }
}

async function enqueueAndPoll(url, body, okMsg) {
  try {
    const res = await postJson(url, body);
    state.currentJobId = res.jobId;
    setStatus(`${okMsg} (job ${res.jobId})`);
    await pollJob();
  } catch (err) {
    setStatus(err?.message || String(err), true);
  }
}

async function deleteCurrentWord() {
  const word = String(state.selectedWord || "").trim();
  if (!word) return;
  const ok = window.confirm(
    `Delete "${word}" from the source 2000-word list?\n\nThis edits source_content/all_anime_top_2000.match.first2000.json`,
  );
  if (!ok) return;

  try {
    setStatus(`Deleting ${word} from word list...`);
    const res = await postJson(API.deleteWord, { word });
    state.selectedWords.delete(word);
    const rows = wordsSortedByIndex();
    const idx = rows.findIndex((r) => r.word === word);
    const fallback = rows[idx + 1]?.word || rows[idx - 1]?.word || null;
    state.selectedWord = fallback;
    state.wordDetail = null;
    state.basePicks = [];
    state.draftPicks = [];
    state.slotSelected = [false, false, false, false, false];
    state.slotReasons = ["", "", "", "", ""];
    await refreshAll();
    state.reviewRows = [];
    renderReviewGrid();
    setStatus(`Deleted "${word}" (removed ${Number(res?.removed || 0)}).`);
    window.setTimeout(() => {
      window.location.reload();
    }, 120);
  } catch (err) {
    setStatus(err?.message || String(err), true);
  }
}

async function pollJob() {
  if (!state.currentJobId) return;
  const id = state.currentJobId;

  const tick = async () => {
    try {
      const job = await getJson(API.job(id));
      state.currentJob = job;
      el.jobMeta.textContent = `${job.name} | ${job.status} | created=${job.createdAt}`;
      el.jobLog.textContent = (job.logs || []).join("\n");
      el.jobLog.scrollTop = el.jobLog.scrollHeight;

      if (job.status === "queued" || job.status === "running") {
        setTimeout(tick, 1200);
        return;
      }

      await refreshAll();
      if (job.status === "done") setStatus(`Job ${id} done.`);
      else setStatus(`Job ${id} failed: ${job.error || "unknown"}`, true);
      state.currentJobId = null;
    } catch (err) {
      setStatus(`job poll failed: ${err?.message || err}`, true);
    }
  };

  tick();
}

async function renderWordRange() {
  if (state.words.length === 0) {
    setStatus("No words loaded yet.", true);
    return;
  }

  const maxIdx = Math.max(...state.words.map((w) => Number(w.idx || 0)), 1);
  let start = clampInt(el.rangeStartInput?.value || 1, 1, maxIdx);
  let end = clampInt(el.rangeEndInput?.value || start, 1, maxIdx);

  if (start > end) {
    const tmp = start;
    start = end;
    end = tmp;
  }
  if (el.rangeStartInput) el.rangeStartInput.value = String(start);
  if (el.rangeEndInput) el.rangeEndInput.value = String(end);

  const rows = wordsInIndexRange(start, end);
  if (rows.length === 0) {
    setStatus(`No words found in range ${start}-${end}.`, true);
    return;
  }

  const words = rows.map((r) => r.word);
  await enqueueAndPoll(
    API.renderMany,
    { words },
    `Queued render range #${start}-${end} (${words.length} words)`,
  );
}

function bindEvents() {
  document.addEventListener(
    "play",
    (ev) => {
      const t = ev?.target;
      if (!t || t.tagName !== "VIDEO") return;
      for (const v of document.querySelectorAll("video")) {
        if (v !== t && !v.paused) v.pause();
      }
    },
    true,
  );

  el.refreshBtn.addEventListener("click", refreshAll);

  el.searchInput.addEventListener("input", renderWordList);
  el.statusFilter.addEventListener("change", renderWordList);

  el.selectVisibleBtn.addEventListener("click", () => {
    for (const row of filterWords()) {
      state.selectedWords.add(row.word);
    }
    renderWordList();
    updateTopButtons();
  });

  el.clearSelectionBtn.addEventListener("click", () => {
    state.selectedWords.clear();
    renderWordList();
    updateTopButtons();
  });

  el.renderRangeBtn?.addEventListener("click", () => {
    renderWordRange();
  });

  el.loadReviewBtn?.addEventListener("click", () => {
    loadReviewRange();
  });

  if (el.renderSelectedBtn) {
    el.renderSelectedBtn.addEventListener("click", async () => {
      const words = Array.from(state.selectedWords);
      if (words.length === 0) {
        setStatus("Select at least one word.", true);
        return;
      }
      await enqueueAndPoll(API.renderMany, { words }, `Queued render-many (${words.length})`);
    });
  }

  el.renderWordBtn.addEventListener("click", async () => {
    const word = state.selectedWord;
    if (!word) return;
    const selection = getRenderPicksFromDraft();
    if (selection.error) {
      setStatus(selection.error, true);
      return;
    }
    const reason = combinedReasons();
    await enqueueAndPoll(
      API.pick,
      { word, picks: selection.picks, reason },
      `Queued render ${word} (${selection.picks.length} clip${selection.picks.length === 1 ? "" : "s"})`,
    );
  });

  el.regenWordBtn?.addEventListener("click", async () => {
    const word = state.selectedWord;
    if (!word) return;
    await enqueueAndPoll(
      API.regenerateWord,
      { word },
      `Queued candidate regeneration for ${word}`,
    );
    await loadWordDetail(word);
    if (state.reviewRows && state.reviewRows.length > 0) {
      await loadReviewRange();
    }
  });

  el.openOutputBtn.addEventListener("click", () => {
    const p = toPreviewPath(state.wordDetail?.output || "");
    if (!p) {
      setStatus("No output file path available yet.", true);
      return;
    }
    window.open(p, "_blank", "noopener,noreferrer");
  });

  el.deleteWordBtn?.addEventListener("click", () => {
    deleteCurrentWord();
  });

  el.resetPicksBtn.addEventListener("click", () => {
    state.draftPicks = [...state.basePicks];
    state.slotSelected = [false, false, false, false, false];
    state.slotReasons = ["", "", "", "", ""];
    renderSlots();
    renderCandidates();
    renderCommands();
  });

  el.selectAllSlotsBtn?.addEventListener("click", () => {
    state.slotSelected = [true, true, true, true, true];
    renderSlots();
    renderCandidates();
  });

  el.clearSlotSelectionBtn?.addEventListener("click", () => {
    state.slotSelected = [false, false, false, false, false];
    renderSlots();
    renderCandidates();
  });

  el.candidateLimit.addEventListener("change", () => {
    renderCandidates();
  });

  el.applyPickBtn.addEventListener("click", async () => {
    const word = state.selectedWord;
    if (!word) return;
    const selection = getRenderPicksFromDraft();
    if (selection.error) {
      setStatus(selection.error, true);
      return;
    }
    const reason = combinedReasons();
    await enqueueAndPoll(
      API.pick,
      { word, picks: selection.picks, reason },
      `Queued pick ${word} (${selection.picks.length} clip${selection.picks.length === 1 ? "" : "s"})`,
    );
  });

  el.applyReplaceBtn.addEventListener("click", async () => {
    const word = state.selectedWord;
    if (!word) return;
    const changed = getChangedSlots();
    if (changed.length !== 1) {
      setStatus("Change exactly one slot to use replace.", true);
      return;
    }
    const c = changed[0];
    const spec = `${c.slot}=${c.to}`;
    const reason = reasonForSlot(c.slot) || combinedReasons();
    await enqueueAndPoll(API.replace, { word, spec, reason }, `Queued replace ${word} ${spec}`);
  });
}

bindEvents();
refreshAll();
setInterval(refreshQueueMeta, 3000);
