import { state, $, audioEl, idbPut } from "./state.js";
import { tr } from "./i18n.js";
import { escapeHTML, el } from "./utils.js";
import { openModal, closeModal } from "./modal.js";
import { filePathToURL, getTrackArtURL } from "./init.js";
import {
  sanitizeFilename,
  toStoreRecord,
  applyMetadataFields,
  setMetadataFields,
} from "./metadata.js";
import {
  normalizeReaderResult,
  splitArtistCredit,
  METADATA_SCHEMA,
} from "./metadata-normalize.js";
import {
  FIELDS,
  parseInput,
  formatValue,
  isEmptyValue,
  valuesFromTrack,
  validDate,
  resolveEdit,
} from "./metadata-fields.js";
import { renderTab } from "./library-view.js";
import { updateNowPlayingUI } from "./now-playing-ui.js";

const COVER_PLACEHOLDER_SVG = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="10"/><path d="M9.5 8.5l6 3.5-6 3.5z" fill="currentColor" stroke="none"/></svg>`;
const CHEVRON_SVG = `<svg class="edit-section-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`;

const fid = (key) => `editF_${key}`;
const fieldEl = (key) => $(fid(key));
const keyFromId = (id) =>
  id && id.startsWith("editF_") && FIELDS[id.slice(6)] ? id.slice(6) : null;

// Sections that start collapsed unless the track already has data in them.
const COLLAPSIBLE_SECTION_FIELDS = {
  credits: ["artists", "composer", "lyricist", "conductor"],
  advanced: [
    "label",
    "copyright",
    "isrc",
    "bpm",
    "grouping",
    "subtitle",
    "comment",
    "lyrics",
  ],
};
const SECTION_OF_FIELD = {};
for (const [section, keys] of Object.entries(COLLAPSIBLE_SECTION_FIELDS))
  for (const key of keys) SECTION_OF_FIELD[key] = section;

function inputFieldHTML(key, labelKey, opts = {}) {
  const { wide, hintKey, numeric, datalist } = opts;
  const isArea = FIELDS[key].kind === "area";
  const control = isArea
    ? `<textarea class="edit-input${key === "lyrics" ? " edit-lyrics" : ""}" id="${fid(key)}" rows="${key === "lyrics" ? 8 : 3}" spellcheck="false"></textarea>`
    : `<input type="text" class="edit-input" id="${fid(key)}" autocomplete="off"${numeric ? ' inputmode="numeric"' : ""}${datalist ? ` list="${datalist}"` : ""}>`;
  return `
    <div class="edit-field${wide ? " edit-field-wide" : ""}">
      <label class="edit-label" for="${fid(key)}">${escapeHTML(tr(labelKey))}</label>
      ${control}
      ${hintKey ? `<p class="edit-hint">${escapeHTML(tr(hintKey))}</p>` : ""}
      <p class="edit-field-error hidden" id="${fid(key)}Error" role="alert"></p>
    </div>`;
}

function pairFieldHTML(noKey, totalKey, labelKey) {
  const label = tr(labelKey);
  return `
    <div class="edit-field">
      <label class="edit-label" for="${fid(noKey)}">${escapeHTML(label)}</label>
      <div class="edit-pair">
        <input type="text" class="edit-input" id="${fid(noKey)}" inputmode="numeric" autocomplete="off">
        <span class="edit-pair-sep">${escapeHTML(tr("edit.of"))}</span>
        <input type="text" class="edit-input" id="${fid(totalKey)}" inputmode="numeric" autocomplete="off" aria-label="${escapeHTML(label + " " + tr("edit.of"))}">
      </div>
      <p class="edit-field-error hidden" id="${fid(noKey)}Error" role="alert"></p>
      <p class="edit-field-error hidden" id="${fid(totalKey)}Error" role="alert"></p>
    </div>`;
}

function sectionHTML(id, titleKey, bodyHTML, open) {
  return `
    <details class="edit-section" id="editSec_${id}"${open ? " open" : ""}>
      <summary><span>${escapeHTML(tr(titleKey))}</span>${CHEVRON_SVG}</summary>
      <div class="edit-section-body">${bodyHTML}</div>
    </details>`;
}

function libraryGenreOptionsHTML() {
  const byLower = new Map();
  for (const t of state.tracks)
    for (const g of t.genre || [])
      if (g && !byLower.has(g.toLowerCase())) byLower.set(g.toLowerCase(), g);
  return [...byLower.values()]
    .sort((a, b) => a.localeCompare(b))
    .map((g) => `<option value="${escapeHTML(g)}"></option>`)
    .join("");
}

function buildBodyHTML(originalArtURL) {
  const basic = [
    inputFieldHTML("title", "info.rowTitle", { wide: true }),
    inputFieldHTML("artist", "info.rowArtist"),
    inputFieldHTML("album", "info.rowAlbum"),
    inputFieldHTML("genre", "edit.fGenre", {
      hintKey: "edit.hintMulti",
      datalist: "editGenreList",
    }),
    inputFieldHTML("year", "edit.fYear", { numeric: true }),
  ].join("");

  const album = [
    inputFieldHTML("albumArtist", "edit.fAlbumArtist", { wide: true }),
    pairFieldHTML("trackNum", "trackTotal", "edit.fTrackNo"),
    pairFieldHTML("discNumber", "discTotal", "edit.fDiscNo"),
    inputFieldHTML("date", "edit.fReleaseDate", { hintKey: "edit.hintDate" }),
    inputFieldHTML("originalDate", "edit.fOriginalDate"),
    `<label class="edit-check edit-field-wide"><input type="checkbox" id="${fid("compilation")}"><span>${escapeHTML(tr("edit.fCompilation"))}</span></label>`,
  ].join("");

  const credits = [
    inputFieldHTML("artists", "edit.fArtists", {
      wide: true,
      hintKey: "edit.hintArtists",
    }),
    inputFieldHTML("composer", "edit.fComposer", { hintKey: "edit.hintMulti" }),
    inputFieldHTML("lyricist", "edit.fLyricist", { hintKey: "edit.hintMulti" }),
    inputFieldHTML("conductor", "edit.fConductor"),
  ].join("");

  const advanced = [
    inputFieldHTML("label", "edit.fLabel"),
    inputFieldHTML("copyright", "edit.fCopyright"),
    inputFieldHTML("isrc", "edit.fIsrc", { hintKey: "edit.hintIsrc" }),
    inputFieldHTML("bpm", "edit.fBpm", { numeric: true }),
    inputFieldHTML("grouping", "edit.fGrouping"),
    inputFieldHTML("subtitle", "edit.fSubtitle"),
    inputFieldHTML("comment", "edit.fComment", { wide: true }),
    inputFieldHTML("lyrics", "edit.fLyrics", { wide: true }),
  ].join("");

  return `
    <div class="edit-form edit-form-wide" id="editForm">
      <div class="edit-scroll">
        <div class="edit-top">
          <div class="edit-top-cover">
            <div class="edit-cover-row">
              <div class="edit-cover-preview" id="editCoverPreview">
                ${originalArtURL ? `<img id="editCoverImg" src="${originalArtURL}" alt="cover">` : COVER_PLACEHOLDER_SVG}
              </div>
              <div class="edit-cover-actions">
                <button type="button" class="edit-cover-btn" id="editCoverBtn">${escapeHTML(tr("edit.changeCover"))}</button>
                <button type="button" class="edit-cover-btn secondary" id="editCoverRemoveBtn">${escapeHTML(tr("edit.removeCover"))}</button>
                <input type="file" id="editCoverInput" accept="image/*" class="hidden">
              </div>
            </div>
            <div class="edit-cover-gallery hidden" id="editCoverGallery"></div>
          </div>
          <div class="edit-top-identify">
            <div class="edit-autotag-row">
              <div class="edit-autotag-buttons">
                <button type="button" class="edit-autotag-btn" id="editAutoTagFingerprintBtn">${escapeHTML(tr("edit.autoTagFingerprint"))}</button>
                <button type="button" class="edit-autotag-btn" id="editAutoTagTextBtn">${escapeHTML(tr("edit.autoTagText"))}</button>
              </div>
              <p class="edit-autotag-status hidden" id="editAutoTagStatus"></p>
              <div class="edit-autotag-matches hidden" id="editAutoTagMatches"></div>
            </div>
          </div>
        </div>
        ${sectionHTML("basic", "edit.secBasic", basic, true)}
        ${sectionHTML("album", "edit.secAlbum", album, true)}
        ${sectionHTML("credits", "edit.secCredits", credits, false)}
        ${sectionHTML("advanced", "edit.secAdvanced", advanced, false)}
        <datalist id="editGenreList">${libraryGenreOptionsHTML()}</datalist>
      </div>
      <div class="edit-footer">
        <div class="edit-footer-msg">
          <p class="edit-status hidden" id="editStatus"></p>
        </div>
        <div class="edit-actions">
          <button type="button" class="edit-cancel-btn" id="editCancelBtn">${escapeHTML(tr("modal.cancel"))}</button>
          <button type="button" class="edit-save-btn" id="editSaveBtn">${escapeHTML(tr("edit.saveChanges"))}</button>
        </div>
      </div>
    </div>`;
}

// What a match (or its extra details) is allowed to fill in. Values that are
// empty are skipped, so a field the source doesn't know is never blanked.
function matchFormValues(m) {
  return {
    title: m.title,
    artist: m.artist,
    album: m.album,
    albumArtist: m.albumArtist,
    genre: m.genre,
    date: m.date,
    year: m.year,
    trackNum: m.trackNum,
    trackTotal: m.trackTotal,
    discNumber: m.discNumber,
    discTotal: m.discTotal,
    isrc: m.isrc,
  };
}
function detailFormValues(d) {
  return {
    genre: d.genre,
    composer: d.composer,
    lyricist: d.lyricist,
    label: d.label,
    isrc: d.isrc,
    date: d.date,
    originalDate: d.originalDate,
  };
}
// date first, so the year that follows it can stay consistent
const APPLY_ORDER = [
  "title",
  "artist",
  "album",
  "albumArtist",
  "genre",
  "date",
  "year",
  "originalDate",
  "trackNum",
  "trackTotal",
  "discNumber",
  "discTotal",
  "composer",
  "lyricist",
  "label",
  "isrc",
];

function openEditModal(track) {
  const t = track || state.currentTrack;

  if (!t) {
    openModal(
      tr("edit.modalTitleEmpty"),
      `<p class='info-empty'>${escapeHTML(tr("empty.nothingPlayingEdit"))}</p>`,
    );
    return;
  }
  const originalArtURL = getTrackArtURL(t);

  // What the track looked like when the modal opened; every "did this change"
  // question is answered against it.
  const original = valuesFromTrack(t);

  let pendingArtFile = null;
  let removeArt = false;
  let coverCandidates = [];
  let coverCandidateIndex = 0;
  let matchCandidates = [];
  let selectedMatch = -1;
  let matchUndo = {};
  let autoTagFields = null;
  let artistsTouched = false;
  const touched = new Set();

  openModal(tr("edit.modalTitle"), buildBodyHTML(originalArtURL), { wide: true });

  const formEl = $("editForm");

  // ---- form <-> values ---------------------------------------------------

  function setField(key, value) {
    const input = fieldEl(key);
    if (FIELDS[key].kind === "bool") input.checked = !!value;
    else input.value = formatValue(key, value);
  }
  function snapshot(key) {
    const input = fieldEl(key);
    return FIELDS[key].kind === "bool" ? input.checked : input.value;
  }
  function restore(key, snap) {
    const input = fieldEl(key);
    if (FIELDS[key].kind === "bool") input.checked = !!snap;
    else input.value = snap;
  }
  function readForm() {
    const current = {};
    for (const key of Object.keys(FIELDS)) current[key] = parseInput(key, snapshot(key));
    return current;
  }
  function currentResolution() {
    return resolveEdit(original, readForm(), {
      artistsTouched,
      matchFields: autoTagFields,
    });
  }

  function openSectionFor(key) {
    const id = SECTION_OF_FIELD[key];
    if (id) $(`editSec_${id}`).open = true;
  }
  // Contributing Artists almost always just mirrors Artist, which isn't "data"
  // worth expanding a section for -- only a list that says something more is.
  function hasIndependentValue(key) {
    const value = parseInput(key, snapshot(key));
    if (key !== "artists") return !isEmptyValue(value);
    const derived = splitArtistCredit(parseInput("artist", snapshot("artist")));
    return (
      value.length > 0 &&
      (value.length !== derived.length || value.some((v, i) => v !== derived[i]))
    );
  }
  function openSectionsWithData() {
    for (const [id, keys] of Object.entries(COLLAPSIBLE_SECTION_FIELDS))
      if (keys.some(hasIndependentValue)) $(`editSec_${id}`).open = true;
  }

  for (const key of Object.keys(FIELDS)) setField(key, original[key]);
  openSectionsWithData();

  function refreshDirty() {
    const { payload } = currentResolution();
    const dirty =
      Object.keys(payload).length > 0 || !!pendingArtFile || removeArt || !!autoTagFields;
    formEl.dataset.unsaved = dirty ? "1" : "";
  }

  // ---- keeping related fields consistent ---------------------------------

  // The release date is the source of truth; the year is its first 4 digits.
  function syncYearFromDate(set = setField) {
    const date = parseInput("date", snapshot("date"));
    if (date && validDate(date) && snapshot("year") !== date.slice(0, 4))
      set("year", Number(date.slice(0, 4)));
  }
  function syncDateFromYear(set = setField) {
    const year = parseInput("year", snapshot("year"));
    if (!Number.isInteger(year) || year < 1000 || year > 9999) return;
    const date = parseInput("date", snapshot("date"));
    if (!date || date.slice(0, 4) !== String(year)) set("date", String(year));
  }
  function syncArtists(set = setField) {
    if (artistsTouched) return;
    set("artists", splitArtistCredit(parseInput("artist", snapshot("artist"))));
  }

  // ---- inline validation -------------------------------------------------

  function clearError(key) {
    const msg = $(`${fid(key)}Error`);
    if (msg) {
      msg.classList.add("hidden");
      msg.textContent = "";
    }
    fieldEl(key).classList.remove("is-invalid");
  }
  function clearAllErrors() {
    for (const key of Object.keys(FIELDS)) clearError(key);
  }
  function showErrors(errors) {
    clearAllErrors();
    const keys = Object.keys(errors);
    for (const key of keys) {
      const msg = $(`${fid(key)}Error`);
      msg.textContent = tr(errors[key]);
      msg.classList.remove("hidden");
      fieldEl(key).classList.add("is-invalid");
      openSectionFor(key);
    }
    const first = fieldEl(keys[0]);
    if (first) {
      first.focus();
      if (first.scrollIntoView) first.scrollIntoView({ block: "center" });
    }
  }

  formEl.addEventListener("input", (e) => {
    const key = keyFromId(e.target.id);
    if (!key) return;
    touched.add(key);
    clearError(key);
    if (key === "artists") artistsTouched = true;
    else if (key === "artist") syncArtists();
    else if (key === "date") syncYearFromDate();
    refreshDirty();
  });
  formEl.addEventListener("change", (e) => {
    if (e.target.id === fid("year")) {
      syncDateFromYear();
      clearError("date");
    }
    refreshDirty();
  });

  // ---- status line -------------------------------------------------------

  function showStatus(text, isError = false) {
    const status = $("editStatus");
    status.classList.remove("hidden");
    status.classList.toggle("is-error", isError);
    status.textContent = text;
  }
  function resetStatus() {
    const status = $("editStatus");
    status.classList.add("hidden");
    status.classList.remove("is-error");
    status.textContent = "";
    const leftover = $("editSaveLibraryOnlyBtn");
    if (leftover) leftover.closest(".edit-status-actions").remove();
  }

  // ---- cover art ---------------------------------------------------------

  const coverInput = $("editCoverInput");
  const galleryEl = $("editCoverGallery");
  const matchesEl = $("editAutoTagMatches");

  function applyCoverCandidate(idx) {
    if (!coverCandidates.length) return;
    coverCandidateIndex =
      ((idx % coverCandidates.length) + coverCandidates.length) %
      coverCandidates.length;
    const candidate = coverCandidates[coverCandidateIndex];
    const bytes =
      candidate.data instanceof Uint8Array
        ? candidate.data
        : new Uint8Array(candidate.data);
    pendingArtFile = new File([bytes], "cover.jpg", {
      type: candidate.mime || "image/jpeg",
    });
    removeArt = false;
    const previewURL = URL.createObjectURL(pendingArtFile);
    $("editCoverPreview").innerHTML =
      `<img id="editCoverImg" src="${previewURL}" alt="cover">`;
    galleryEl.querySelectorAll(".edit-cover-thumb").forEach((thumb, i) => {
      thumb.classList.toggle("selected", i === coverCandidateIndex);
    });
  }

  function renderCoverGallery(images) {
    coverCandidates = images || [];
    if (coverCandidates.length < 2) {
      galleryEl.classList.add("hidden");
      galleryEl.innerHTML = "";
    } else {
      galleryEl.innerHTML = coverCandidates
        .map((img, i) => {
          const bytes =
            img.data instanceof Uint8Array ? img.data : new Uint8Array(img.data);
          const url = URL.createObjectURL(
            new Blob([bytes], { type: img.mime || "image/jpeg" }),
          );
          const label = img.releaseTitle
            ? `${img.releaseTitle}${img.releaseDate ? " (" + img.releaseDate + ")" : ""}`
            : "";
          return `<button type="button" class="edit-cover-thumb" data-idx="${i}" style="background-image:url('${url}')" title="${escapeHTML(label)}" aria-label="${escapeHTML(label || "cover option " + (i + 1))}"></button>`;
        })
        .join("");
      galleryEl.classList.remove("hidden");
    }
    if (coverCandidates.length) {
      applyCoverCandidate(0);
    } else {
      pendingArtFile = null;
      removeArt = false;
      $("editCoverPreview").innerHTML = originalArtURL
        ? `<img id="editCoverImg" src="${originalArtURL}" alt="cover">`
        : COVER_PLACEHOLDER_SVG;
    }
    refreshDirty();
  }

  galleryEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".edit-cover-thumb");
    if (!btn) return;
    applyCoverCandidate(parseInt(btn.dataset.idx, 10) || 0);
    refreshDirty();
  });

  $("editCoverBtn").addEventListener("click", () => coverInput.click());

  coverInput.addEventListener("change", () => {
    const file = coverInput.files[0];
    if (!file) return;
    pendingArtFile = file;
    removeArt = false;
    coverCandidates = [];
    galleryEl.classList.add("hidden");
    galleryEl.innerHTML = "";
    $("editCoverPreview").innerHTML =
      `<img id="editCoverImg" src="${URL.createObjectURL(file)}" alt="cover">`;
    refreshDirty();
  });

  $("editCoverRemoveBtn").addEventListener("click", () => {
    pendingArtFile = null;
    removeArt = true;
    coverCandidates = [];
    galleryEl.classList.add("hidden");
    galleryEl.innerHTML = "";
    $("editCoverPreview").innerHTML = COVER_PLACEHOLDER_SVG;
    refreshDirty();
  });

  // ---- identify / search: choosing and applying a match ------------------

  const autoTagFingerprintBtn = $("editAutoTagFingerprintBtn");
  const autoTagTextBtn = $("editAutoTagTextBtn");
  const autoTagStatus = $("editAutoTagStatus");
  const AUTOTAG_PROGRESS_KEY = {
    fingerprint: "edit.autoTaggingFingerprint",
    text: "edit.autoTaggingText",
  };

  function setAutoTagStatus(text) {
    autoTagStatus.classList.remove("hidden");
    autoTagStatus.textContent = text;
  }

  // Remembers what a field held before a match overwrote it, so choosing a
  // different match can put back anything the new one doesn't provide --
  // unless the user has edited that field by hand in the meantime.
  function setFromMatch(key, value) {
    const before = snapshot(key);
    setField(key, value);
    const prior = matchUndo[key];
    matchUndo[key] = { before: prior ? prior.before : before, applied: snapshot(key) };
    openSectionFor(key);
  }
  function revertMatchFields() {
    for (const [key, undo] of Object.entries(matchUndo))
      if (snapshot(key) === undo.applied) restore(key, undo.before);
    matchUndo = {};
    autoTagFields = null;
  }

  function applyValuesFromMatch(values) {
    for (const key of APPLY_ORDER) {
      const value = values[key];
      if (isEmptyValue(value)) continue;
      // "2019" must not overwrite a more precise "2019-05-17" already there.
      if (key === "date" || key === "originalDate") {
        const have = snapshot(key).trim();
        if (have.length > String(value).length && have.startsWith(String(value))) continue;
      }
      setFromMatch(key, value);
    }
    if (!isEmptyValue(values.date)) syncYearFromDate(setFromMatch);
    else if (!isEmptyValue(values.year)) syncDateFromYear(setFromMatch);
    if (!isEmptyValue(values.artist)) syncArtists(setFromMatch);
    if (/^various artists$/i.test(values.albumArtist || "") && !snapshot("compilation"))
      setFromMatch("compilation", true);
  }

  function captureAutoTagFields(m) {
    autoTagFields = {
      releaseType: m.releaseType,
      recordingId: m.recordingId,
      releaseId: m.releaseId,
      releaseGroupId: m.releaseGroupId,
      artistIds: m.artistIds,
      albumArtistIds: m.albumArtistIds,
    };
  }

  function matchThumbURL(m) {
    if (m._thumbURL !== undefined) return m._thumbURL;
    const img = m.images && m.images[0];
    if (!img) return (m._thumbURL = null);
    const bytes = img.data instanceof Uint8Array ? img.data : new Uint8Array(img.data);
    return (m._thumbURL = URL.createObjectURL(
      new Blob([bytes], { type: img.mime || "image/jpeg" }),
    ));
  }

  function matchCardHTML(m, i) {
    const selected = i === selectedMatch;
    const thumb = matchThumbURL(m);
    const sub = [m.artist, m.album].filter(Boolean).join(" · ");
    const meta = [];
    if (m.albumArtist && m.albumArtist !== m.artist)
      meta.push(`${tr("edit.fAlbumArtist")}: ${m.albumArtist}`);
    if (m.year) meta.push(String(m.year));
    if (m.genre && m.genre.length) meta.push(m.genre.join(", "));
    if (m.trackNum != null)
      meta.push(
        m.discTotal > 1 && m.discNumber != null
          ? tr("edit.matchTrackDisc", { track: m.trackNum, disc: m.discNumber })
          : tr("edit.matchTrack", { track: m.trackNum }),
      );
    return `
      <button type="button" class="edit-match-card${selected ? " selected" : ""}" data-idx="${i}" role="radio" aria-checked="${selected}">
        <span class="edit-match-art"${thumb ? ` style="background-image:url('${thumb}')"` : ""}></span>
        <span class="edit-match-info">
          <span class="edit-match-title">${escapeHTML(m.title || "?")}</span>
          <span class="edit-match-sub">${escapeHTML(sub)}</span>
          <span class="edit-match-meta">${escapeHTML(meta.join(" · "))}</span>
        </span>
        ${selected ? `<span class="edit-match-badge">${escapeHTML(tr("edit.matchApplied"))}</span>` : ""}
      </button>`;
  }

  function renderMatchCards() {
    if (!matchCandidates.length) {
      matchesEl.classList.add("hidden");
      matchesEl.innerHTML = "";
      return;
    }
    matchesEl.innerHTML = `<div class="edit-match-list" role="radiogroup">${matchCandidates.map(matchCardHTML).join("")}</div>`;
    matchesEl.classList.remove("hidden");
  }

  matchesEl.addEventListener("click", (e) => {
    const card = e.target.closest(".edit-match-card");
    if (card) selectMatch(parseInt(card.dataset.idx, 10) || 0);
  });

  async function selectMatch(idx) {
    const m = matchCandidates[idx];
    if (!m) return;
    revertMatchFields();
    selectedMatch = idx;
    applyValuesFromMatch(matchFormValues(m));
    captureAutoTagFields(m);
    // Swap in this match's artwork if it has any. If it has none, only drop a
    // cover that came from a previous match -- never one picked by hand.
    const images = m.images || [];
    if (images.length || coverCandidates.length) renderCoverGallery(images);
    renderMatchCards();
    refreshDirty();
    setAutoTagStatus(tr("edit.autoTagApplied"));
    await loadMatchDetails(idx);
  }

  // Genre, composer, label and the like need extra lookups, so they're fetched
  // once the user has actually chosen a match.
  async function loadMatchDetails(idx) {
    const m = matchCandidates[idx];
    if (!m || !(m.recordingId || m.releaseId)) return;
    if (!m.details) {
      if (!(window.electronAPI && window.electronAPI.autoTagDetails)) return;
      setAutoTagStatus(tr("edit.autoTagMoreDetails"));
      const res = await window.electronAPI
        .autoTagDetails({
          recordingId: m.recordingId,
          releaseId: m.releaseId,
          releaseGroupId: m.releaseGroupId,
          artistIds: m.artistIds,
        })
        .catch((err) => ({ ok: false, reason: String((err && err.message) || err) }));
      if (selectedMatch !== idx || !formEl.isConnected) return;
      if (!res || !res.ok) {
        setAutoTagStatus(tr("edit.autoTagMoreFailed", { reason: (res && res.reason) || "" }));
        return;
      }
      m.details = res.details || {};
    }
    if (selectedMatch !== idx) return;
    applyValuesFromMatch(detailFormValues(m.details));
    refreshDirty();
    setAutoTagStatus(tr("edit.autoTagMoreDone"));
  }

  async function runAutoTag(mode) {
    if (!(window.electronAPI && window.electronAPI.autoTagTrack && t.filePath)) {
      setAutoTagStatus(tr("edit.autoTagUnavailable"));
      return;
    }

    autoTagFingerprintBtn.disabled = true;
    autoTagTextBtn.disabled = true;
    setAutoTagStatus(tr(AUTOTAG_PROGRESS_KEY[mode]));
    matchCandidates = [];
    selectedMatch = -1;
    renderMatchCards();

    const artistHint = parseInput("artist", snapshot("artist")) || t.artist || "";
    const cleanArtistHint = /^unknown artist$/i.test(artistHint) ? "" : artistHint;

    const result = await window.electronAPI
      .autoTagTrack(
        t.filePath,
        { title: parseInput("title", snapshot("title")) || t.title || "", artist: cleanArtistHint },
        mode,
      )
      .catch((err) => ({ found: false, reason: String((err && err.message) || err) }));

    autoTagFingerprintBtn.disabled = false;
    autoTagTextBtn.disabled = false;
    if (!formEl.isConnected) return;

    if (!result || !result.found) {
      setAutoTagStatus(tr("edit.autoTagNotFound", { reason: (result && result.reason) || "" }));
      return;
    }

    matchCandidates = result.matches && result.matches.length ? result.matches : [result];
    renderMatchCards();
    if (matchCandidates.length === 1) {
      await selectMatch(0);
    } else {
      setAutoTagStatus(tr("edit.autoTagFoundMany", { count: matchCandidates.length }));
    }
  }

  autoTagFingerprintBtn.addEventListener("click", () => runAutoTag("fingerprint"));
  autoTagTextBtn.addEventListener("click", () => runAutoTag("text"));

  // Tracks saved before these fields existed: fill the gaps from the file so
  // the form shows what's really there instead of empty boxes.
  if (
    t.filePath &&
    (t.metadataSchema || 0) < METADATA_SCHEMA &&
    window.electronAPI &&
    window.electronAPI.getAudioMetadata
  ) {
    window.electronAPI
      .getAudioMetadata(t.filePath)
      .then((meta) => {
        if (!meta || !formEl.isConnected) return;
        const fromFile = valuesFromTrack(normalizeReaderResult(meta));
        for (const key of Object.keys(FIELDS)) {
          if (touched.has(key)) continue;
          if (isEmptyValue(original[key]) && !isEmptyValue(fromFile[key])) {
            original[key] = fromFile[key];
            setField(key, fromFile[key]);
          }
        }
        openSectionsWithData();
      })
      .catch(() => {});
  }

  // ---- cancel / save -----------------------------------------------------

  $("editCancelBtn").addEventListener("click", closeModal);

  $("editSaveBtn").addEventListener("click", async () => {
    const saveBtn = $("editSaveBtn");
    resetStatus();

    const edit = currentResolution();
    if (Object.keys(edit.errors).length) {
      showErrors(edit.errors);
      showStatus(tr("edit.errFixFirst"), true);
      return;
    }
    clearAllErrors();

    const coverChanged = !!pendingArtFile || removeArt;
    if (!Object.keys(edit.payload).length && !coverChanged && !autoTagFields) {
      closeModal();
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = tr("edit.saving");

    const newTitle = edit.library.title || t.title;
    const newArtist = edit.library.artist || t.artist;

    async function applyToLibrary(resync) {
      setMetadataFields(t, edit.library);
      if (resync) applyMetadataFields(t, resync, true);
      t.albumArtists = normalizeReaderResult({
        artist: t.artist,
        albumArtist: t.albumArtist,
      }).albumArtists;
      t.metadataBackfilled = true;
      t.metadataSchema = METADATA_SCHEMA;

      if (pendingArtFile) {
        if (t.artURL) URL.revokeObjectURL(t.artURL);
        t.artBlob = pendingArtFile;
        t.artURL = URL.createObjectURL(pendingArtFile);
      } else if (removeArt) {
        if (t.artURL) URL.revokeObjectURL(t.artURL);
        t.artBlob = null;
        t.artURL = null;
      }

      if (t.external) t.external = false;
      await idbPut("tracks", toStoreRecord(t));

      if (state.currentTrack && state.currentTrack.id === t.id) updateNowPlayingUI();
      renderTab();
    }

    function finishModal(message, { keepOpen = false } = {}) {
      showStatus(message);
      formEl.dataset.unsaved = "";
      if (keepOpen) {
        saveBtn.disabled = true;
        saveBtn.textContent = tr("edit.saveChanges");
        $("editCancelBtn").textContent = tr("modal.close");
      } else {
        setTimeout(closeModal, 1400);
      }
    }

    const isRealFileTrack = !!(
      window.electronAPI &&
      window.electronAPI.writeAudioTags &&
      t.filePath
    );

    if (!isRealFileTrack) {
      await applyToLibrary();
      closeModal();
      return;
    }

    let resumePlayback = null;
    const wasCurrentlyLoaded = !!(
      state.currentTrack &&
      state.currentTrack.id === t.id &&
      audioEl.src
    );
    if (wasCurrentlyLoaded) {
      resumePlayback = {
        time: audioEl.currentTime,
        wasPlaying: !audioEl.paused,
      };
      audioEl.pause();
      audioEl.removeAttribute("src");
      audioEl.load();
    }

    let imageData = null;
    if (pendingArtFile) imageData = await pendingArtFile.arrayBuffer();

    const writeFields = {
      ...edit.payload,
      imageData,
      imageMime: pendingArtFile ? pendingArtFile.type : null,
      removeImage: removeArt,
    };

    const result = await window.electronAPI
      .writeAudioTags(t.filePath, writeFields)
      .catch((err) => ({
        written: false,
        reason: String((err && err.message) || err),
      }));

    const resumeIfNeeded = () => {
      if (!wasCurrentlyLoaded) return;
      audioEl.src = t.fileURL;
      audioEl.currentTime = resumePlayback.time;
      if (resumePlayback.wasPlaying) audioEl.play().catch(() => {});
    };

    if (!(result && result.written)) {
      saveBtn.disabled = false;
      saveBtn.textContent = tr("edit.saveChanges");
      resumeIfNeeded();

      showStatus(
        tr("edit.fileWriteFailed", {
          reason: (result && result.reason) || tr("edit.fileNotChanged"),
        }),
        true,
      );

      const actionsRow = el("div", "edit-status-actions");
      const libOnlyBtn = el(
        "button",
        "edit-lib-only-btn",
        escapeHTML(tr("edit.saveLibraryOnly")),
      );
      libOnlyBtn.type = "button";
      libOnlyBtn.id = "editSaveLibraryOnlyBtn";
      libOnlyBtn.addEventListener("click", async () => {
        libOnlyBtn.disabled = true;
        await applyToLibrary();
        actionsRow.remove();
        finishModal(tr("edit.savedLibraryOnlyConfirmed"));
      });
      actionsRow.appendChild(libOnlyBtn);
      $("editStatus").insertAdjacentElement("afterend", actionsRow);
      return;
    }

    let renameFailedReason = null;
    if (window.electronAPI.renameFile) {
      const desiredBase = sanitizeFilename(`${newArtist} - ${newTitle}`);
      const renameResult = await window.electronAPI
        .renameFile(t.filePath, desiredBase)
        .catch((err) => ({
          renamed: false,
          reason: String((err && err.message) || err),
        }));
      if (renameResult && renameResult.renamed && renameResult.newPath) {
        t.filePath = renameResult.newPath;
        t.fileURL = filePathToURL(t.filePath);
      } else {
        renameFailedReason =
          (renameResult && renameResult.reason) || tr("edit.couldntRenameGeneric");
      }
    }

    let resync = null;
    if (window.electronAPI.getAudioMetadata) {
      const rereadMeta = await window.electronAPI
        .getAudioMetadata(t.filePath)
        .catch(() => null);
      if (rereadMeta) resync = normalizeReaderResult(rereadMeta);
    }
    await applyToLibrary(resync);
    resumeIfNeeded();

    // Fields this file format can't hold stay in Playnck only -- say so.
    const skipped = Array.isArray(result.skipped) ? result.skipped : [];
    const format = (t.filePath.split(".").pop() || "").toUpperCase();
    let message;
    if (skipped.length && result.imageIgnored)
      message = tr("edit.savedSkippedAndCover", { format, fields: skipped.join(", ") });
    else if (skipped.length)
      message = tr("edit.savedFieldsSkipped", { format, fields: skipped.join(", ") });
    else if (result.imageIgnored) message = tr("edit.savedButNoCoverArtSupport");
    else if (renameFailedReason)
      message = tr("edit.savedTagsButNotRenamed", { reason: renameFailedReason });
    else message = tr("edit.savedRenamedAndUpdated");

    const needsAttention = skipped.length > 0 || !!result.imageIgnored;
    if (needsAttention && renameFailedReason)
      message += ` ${tr("edit.couldntRenameGeneric")}`;
    finishModal(message, { keepOpen: needsAttention });
  });
}

export { openEditModal };
