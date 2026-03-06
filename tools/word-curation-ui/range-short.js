const API = {
  videos: "/api/videos",
  manualClip: "/api/manual-clip",
  video: (file) => `/api/video?file=${encodeURIComponent(file)}`,
  jobs: "/api/jobs",
  job: (id) => `/api/jobs/${encodeURIComponent(id)}`,
};

const MAX_RANGE_SEC = 180;

const state = {
  videos: [],
  currentJobId: null,
  history: [],
  durationSec: 0,
  currentSec: 0,
  startSec: 0,
  endSec: 0,
  dragMode: null,
};

const el = {
  statusMsg: document.getElementById("statusMsg"),
  queueMeta: document.getElementById("queueMeta"),
  loadVideosBtn: document.getElementById("loadVideosBtn"),
  videoSelect: document.getElementById("videoSelect"),
  previewVideo: document.getElementById("previewVideo"),
  previewMeta: document.getElementById("previewMeta"),
  timeline: document.getElementById("timeline"),
  timelineSelection: document.getElementById("timelineSelection"),
  timelineCurrent: document.getElementById("timelineCurrent"),
  timelineStartHandle: document.getElementById("timelineStartHandle"),
  timelineEndHandle: document.getElementById("timelineEndHandle"),
  setStartFromPlayheadBtn: document.getElementById("setStartFromPlayheadBtn"),
  setEndFromPlayheadBtn: document.getElementById("setEndFromPlayheadBtn"),
  seekStartBtn: document.getElementById("seekStartBtn"),
  seekEndBtn: document.getElementById("seekEndBtn"),
  startInput: document.getElementById("startInput"),
  endInput: document.getElementById("endInput"),
  outputDirInput: document.getElementById("outputDirInput"),
  createBtn: document.getElementById("createBtn"),
  jobMeta: document.getElementById("jobMeta"),
  jobLog: document.getElementById("jobLog"),
  history: document.getElementById("history"),
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

function clamp(n, min, max) {
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function pad2(n) {
  return String(Math.trunc(n)).padStart(2, "0");
}

function formatClock(sec) {
  const total = Math.max(0, Math.floor(Number(sec) || 0));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
}

function formatUserTime(sec) {
  const total = Math.max(0, Math.floor(Number(sec) || 0));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  if (hh > 0) return `${hh}:${pad2(mm)}:${pad2(ss)}`;
  return `${mm}:${pad2(ss)}`;
}

function parseUserTimeToSec(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const parts = s.split(":").map((x) => x.trim());
  if (parts.length !== 2 && parts.length !== 3) return null;

  const nums = parts.map(Number);
  if (nums.some((x) => !Number.isFinite(x) || x < 0)) return null;

  if (parts.length === 2) {
    return nums[0] * 60 + nums[1];
  }
  return nums[0] * 3600 + nums[1] * 60 + nums[2];
}

function setRange(startSec, endSec, anchor = "end") {
  const dur = Math.max(0, Number(state.durationSec) || 0);
  if (dur <= 0) {
    state.startSec = 0;
    state.endSec = 0;
    return;
  }

  let s = clamp(Number(startSec), 0, dur);
  let e = clamp(Number(endSec), 0, dur);

  if (e <= s) {
    if (anchor === "start") {
      e = clamp(s + 1, 0, dur);
    } else {
      s = clamp(e - 1, 0, dur);
    }
  }

  if (e - s > MAX_RANGE_SEC) {
    if (anchor === "start") {
      e = clamp(s + MAX_RANGE_SEC, 0, dur);
    } else {
      s = clamp(e - MAX_RANGE_SEC, 0, dur);
    }
  }

  if (e <= s) {
    e = clamp(s + 1, 0, dur);
  }

  state.startSec = s;
  state.endSec = e;
}

function syncInputsFromRange() {
  el.startInput.value = formatUserTime(state.startSec);
  el.endInput.value = formatUserTime(state.endSec);
}

function syncRangeFromInputs(changed = "end") {
  const parsedStart = parseUserTimeToSec(el.startInput.value);
  const parsedEnd = parseUserTimeToSec(el.endInput.value);

  const nextStart = parsedStart == null ? state.startSec : parsedStart;
  const nextEnd = parsedEnd == null ? state.endSec : parsedEnd;
  setRange(nextStart, nextEnd, changed);
  syncInputsFromRange();
  renderTimeline();
}

function pct(sec) {
  if (!state.durationSec) return 0;
  return (clamp(sec, 0, state.durationSec) / state.durationSec) * 100;
}

function renderPreviewMeta() {
  if (!state.durationSec) {
    el.previewMeta.textContent = "Select a video to load preview.";
    return;
  }
  const windowSec = Math.max(0, state.endSec - state.startSec);
  el.previewMeta.textContent = `Duration ${formatClock(state.durationSec)} | Playhead ${formatClock(state.currentSec)} | Range ${formatClock(state.startSec)} -> ${formatClock(state.endSec)} (${windowSec.toFixed(1)}s)`;
}

function renderTimeline() {
  const s = pct(state.startSec);
  const e = pct(state.endSec);
  const c = pct(state.currentSec);

  el.timelineSelection.style.left = `${s}%`;
  el.timelineSelection.style.width = `${Math.max(0, e - s)}%`;
  el.timelineCurrent.style.left = `${c}%`;
  el.timelineStartHandle.style.left = `${s}%`;
  el.timelineEndHandle.style.left = `${e}%`;

  renderPreviewMeta();
}

function secondsAtClientX(clientX) {
  const rect = el.timeline.getBoundingClientRect();
  const x = clamp(clientX - rect.left, 0, rect.width);
  const ratio = rect.width > 0 ? x / rect.width : 0;
  return ratio * state.durationSec;
}

function applyPointerToRange(clientX) {
  if (!state.durationSec) return;
  const sec = secondsAtClientX(clientX);
  if (state.dragMode === "start") {
    setRange(sec, state.endSec, "start");
  } else if (state.dragMode === "end") {
    setRange(state.startSec, sec, "end");
  }
  syncInputsFromRange();
  renderTimeline();
}

function onTimelinePointerMove(ev) {
  if (!state.dragMode) return;
  ev.preventDefault();
  applyPointerToRange(ev.clientX);
}

function onTimelinePointerUp() {
  state.dragMode = null;
  window.removeEventListener("pointermove", onTimelinePointerMove);
  window.removeEventListener("pointerup", onTimelinePointerUp);
}

function beginTimelineDrag(mode, ev) {
  if (!state.durationSec) return;
  state.dragMode = mode;
  window.addEventListener("pointermove", onTimelinePointerMove);
  window.addEventListener("pointerup", onTimelinePointerUp);
  applyPointerToRange(ev.clientX);
}

function onTimelineClick(ev) {
  if (!state.durationSec) return;
  const sec = secondsAtClientX(ev.clientX);
  const distStart = Math.abs(sec - state.startSec);
  const distEnd = Math.abs(sec - state.endSec);
  if (distStart <= distEnd) {
    setRange(sec, state.endSec, "start");
  } else {
    setRange(state.startSec, sec, "end");
  }
  syncInputsFromRange();
  renderTimeline();
}

function setVideoSelection(videoFile) {
  const file = String(videoFile || "").trim();
  if (!file) {
    el.previewVideo.removeAttribute("src");
    el.previewVideo.load();
    state.durationSec = 0;
    state.currentSec = 0;
    state.startSec = 0;
    state.endSec = 0;
    renderTimeline();
    return;
  }
  el.previewVideo.src = API.video(file);
  el.previewVideo.load();
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

function renderVideoSelect() {
  el.videoSelect.innerHTML = '<option value="">Select a video...</option>';
  for (const v of state.videos) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    el.videoSelect.appendChild(opt);
  }
}

function renderHistory() {
  el.history.innerHTML = "";
  if (state.history.length === 0) {
    el.history.innerHTML = '<p class="muted">No renders yet.</p>';
    return;
  }
  for (const row of state.history.slice(0, 12)) {
    const div = document.createElement("div");
    div.className = "note";
    const url = row.outputFile
      ? `/${String(row.outputFile).replaceAll("\\", "/").replace(/^\/+/, "")}`
      : "";
    const t = new Date(row.timestamp).toLocaleTimeString();
    div.innerHTML = `
      <strong>${escapeHtml(row.videoFile)}</strong><br>
      ${escapeHtml(row.startTime)} - ${escapeHtml(row.endTime)}<br>
      ${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open output</a><br>` : ""}
      <span class="muted">${escapeHtml(t)}</span>
    `;
    el.history.appendChild(div);
  }
}

async function loadVideos() {
  try {
    el.loadVideosBtn.disabled = true;
    el.loadVideosBtn.textContent = "Loading...";
    const data = await getJson(API.videos);
    state.videos = Array.isArray(data.videos) ? data.videos : [];
    renderVideoSelect();
    if (state.videos.length > 0 && !el.videoSelect.value) {
      el.videoSelect.value = state.videos[0];
      setVideoSelection(state.videos[0]);
    }
    setStatus(`Loaded ${state.videos.length} videos.`);
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    el.loadVideosBtn.disabled = false;
    el.loadVideosBtn.textContent = "Load Videos";
  }
}

async function refreshQueueMeta() {
  try {
    const data = await getJson(API.jobs);
    el.queueMeta.textContent = `active=${data.activeJobId || "none"} | queued=${data.queueLength || 0}`;
    if (!state.currentJobId && data.activeJobId) {
      state.currentJobId = data.activeJobId;
      pollJob(state.currentJobId);
    }
  } catch {
    el.queueMeta.textContent = "";
  }
}

async function pollJob(jobId) {
  if (!jobId) return;

  const tick = async () => {
    try {
      const job = await getJson(API.job(jobId));
      el.jobMeta.textContent = `${job.name} | ${job.status} | created=${job.createdAt}`;
      el.jobLog.textContent = (job.logs || []).join("\n");
      el.jobLog.scrollTop = el.jobLog.scrollHeight;

      if (job.status === "queued" || job.status === "running") {
        setTimeout(tick, 1200);
        return;
      }

      if (job.status === "done") {
        const outputFile = String(job?.payload?.outputFile || "").trim();
        state.history.unshift({
          videoFile: String(job?.payload?.videoFile || ""),
          startTime: String(job?.payload?.startTime || ""),
          endTime: String(job?.payload?.endTime || ""),
          outputFile,
          timestamp: new Date().toISOString(),
        });
        renderHistory();
        setStatus(`Job ${jobId} done.`);
      } else {
        setStatus(`Job ${jobId} failed: ${job.error || "unknown"}`, true);
      }
      state.currentJobId = null;
      await refreshQueueMeta();
    } catch (err) {
      setStatus(`Job poll failed: ${err.message || err}`, true);
      state.currentJobId = null;
    }
  };

  tick();
}

async function createRangeShort() {
  const videoFile = String(el.videoSelect.value || "").trim();
  const outputDir = String(el.outputDirInput.value || "").trim();

  if (!videoFile) {
    setStatus("Select a video file.", true);
    return;
  }
  if (!state.durationSec) {
    setStatus("Wait for preview metadata to load.", true);
    return;
  }

  const startTime = formatClock(state.startSec);
  const endTime = formatClock(state.endSec);

  try {
    el.createBtn.disabled = true;
    const res = await postJson(API.manualClip, {
      videoFile,
      startTime,
      endTime,
      outputDir,
    });
    const jobId = String(res.jobId || "").trim();
    if (!jobId) throw new Error("No jobId returned");
    state.currentJobId = jobId;
    setStatus(`Queued range short (job ${jobId})`);
    await pollJob(jobId);
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    el.createBtn.disabled = false;
  }
}

function bind() {
  el.loadVideosBtn.addEventListener("click", loadVideos);
  el.createBtn.addEventListener("click", createRangeShort);

  el.videoSelect.addEventListener("change", () => {
    setVideoSelection(el.videoSelect.value);
  });

  el.previewVideo.addEventListener("loadedmetadata", () => {
    state.durationSec = Number(el.previewVideo.duration) || 0;
    state.currentSec = 0;

    const parsedStart = parseUserTimeToSec(el.startInput.value);
    const parsedEnd = parseUserTimeToSec(el.endInput.value);

    const initStart = parsedStart == null ? 0 : parsedStart;
    const defaultEnd = Math.min(state.durationSec, Math.min(MAX_RANGE_SEC, Math.max(8, state.durationSec)));
    const initEnd = parsedEnd == null ? defaultEnd : parsedEnd;

    setRange(initStart, initEnd, "end");
    syncInputsFromRange();
    renderTimeline();
  });

  el.previewVideo.addEventListener("timeupdate", () => {
    state.currentSec = Number(el.previewVideo.currentTime) || 0;
    renderTimeline();
  });

  el.previewVideo.addEventListener("seeking", () => {
    state.currentSec = Number(el.previewVideo.currentTime) || 0;
    renderTimeline();
  });

  el.previewVideo.addEventListener("emptied", () => {
    state.durationSec = 0;
    state.currentSec = 0;
    state.startSec = 0;
    state.endSec = 0;
    renderTimeline();
  });

  el.startInput.addEventListener("change", () => syncRangeFromInputs("start"));
  el.endInput.addEventListener("change", () => syncRangeFromInputs("end"));

  el.setStartFromPlayheadBtn.addEventListener("click", () => {
    setRange(state.currentSec, state.endSec, "start");
    syncInputsFromRange();
    renderTimeline();
  });

  el.setEndFromPlayheadBtn.addEventListener("click", () => {
    setRange(state.startSec, state.currentSec, "end");
    syncInputsFromRange();
    renderTimeline();
  });

  el.seekStartBtn.addEventListener("click", () => {
    if (!state.durationSec) return;
    el.previewVideo.currentTime = state.startSec;
    state.currentSec = state.startSec;
    renderTimeline();
  });

  el.seekEndBtn.addEventListener("click", () => {
    if (!state.durationSec) return;
    el.previewVideo.currentTime = state.endSec;
    state.currentSec = state.endSec;
    renderTimeline();
  });

  el.timelineStartHandle.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    beginTimelineDrag("start", ev);
  });

  el.timelineEndHandle.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    beginTimelineDrag("end", ev);
  });

  el.timeline.addEventListener("click", (ev) => {
    if (ev.target === el.timelineStartHandle || ev.target === el.timelineEndHandle) {
      return;
    }
    onTimelineClick(ev);
  });
}

bind();
renderHistory();
renderTimeline();
loadVideos();
refreshQueueMeta();
setInterval(refreshQueueMeta, 3000);
