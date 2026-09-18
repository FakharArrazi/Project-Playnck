import { state, idbGet, idbPut } from "./state.js";
import { tr } from "./i18n.js";
import { escapeHTML } from "./utils.js";
import { openModal } from "./modal.js";
import { CHANGELOG } from "./whats-new-data.js";

const CHANGELOG_SEEN_KEY = "lastSeenChangelogVersion";
const MAX_OLDER_GROUPS = 3;

function findChangelogEntry(version) {
  if (!version) return null;
  return CHANGELOG.find((entry) => entry.version === version) || null;
}

function latestChangelogEntry() {
  return CHANGELOG[0] || null;
}

function highlightsListHTML(highlights) {
  if (!Array.isArray(highlights) || !highlights.length) return "";
  return `<ul class="whats-new-list">${highlights.map((h) => `<li>${escapeHTML(h)}</li>`).join("")}</ul>`;
}

function primaryGroupHTML(entry) {
  const dateHTML = entry.date
    ? `<p class="theme-note whats-new-date">${escapeHTML(entry.date)}</p>`
    : "";
  return `<div class="whats-new-group">${dateHTML}${highlightsListHTML(entry.highlights)}</div>`;
}

function olderGroupHTML(entry) {
  const heading =
    "v" + entry.version + (entry.date ? " \u2014 " + entry.date : "");
  return `<div class="whats-new-group">
    <div class="home-section-title">${escapeHTML(heading)}</div>
    ${highlightsListHTML(entry.highlights)}
  </div>`;
}

function whatsNewBodyHTML(primaryEntry) {
  if (!primaryEntry)
    return `<p class="info-empty">${escapeHTML(tr("whatsNew.empty"))}</p>`;
  const older = CHANGELOG.filter(
    (entry) => entry.version !== primaryEntry.version,
  ).slice(0, MAX_OLDER_GROUPS);
  return `<div class="whats-new-body">${primaryGroupHTML(primaryEntry)}${older.map(olderGroupHTML).join("")}</div>`;
}

function openWhatsNewModal(entry) {
  const title = entry
    ? tr("whatsNew.titlePrefix", { version: "v" + entry.version })
    : tr("whatsNew.btn");
  openModal(title, whatsNewBodyHTML(entry));
}

function showWhatsNewManually() {
  openWhatsNewModal(
    findChangelogEntry(state.appVersion) || latestChangelogEntry(),
  );
}

async function checkAutoShowWhatsNew() {
  const version = state.appVersion;
  const entry = findChangelogEntry(version);
  if (!entry) return;

  const seen = await idbGet("settings", CHANGELOG_SEEN_KEY);
  if (seen && seen.value === version) return;

  openWhatsNewModal(entry);
  idbPut("settings", { key: CHANGELOG_SEEN_KEY, value: version }).catch(
    () => {},
  );
}

export { checkAutoShowWhatsNew, showWhatsNewManually };
