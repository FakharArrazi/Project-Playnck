import { state } from "./state.js";
import { el, replayMotion, escapeHTML } from "./utils.js";
import { tr } from "./i18n.js";
import {
  currentSortKey,
  SORT_OPTIONS,
  renderTab,
  saveSortPrefs,
} from "./library-view.js";
import {
  openAddToPlaylistModal,
  removeFromPlaylist,
  isInFavorites,
  toggleFavorite,
  deleteTrack,
} from "./playlists.js";
import { openInfoModal } from "./side-menu.js";

let openMenuEl = null;

function closeMenu() {
  if (openMenuEl) {
    openMenuEl.remove();
    openMenuEl = null;
  }
}

function positionMenu(menu, anchorEl, { edge = "right", offset = 150 } = {}) {
  document.body.appendChild(menu);
  replayMotion(menu);
  const rect = anchorEl.getBoundingClientRect();
  let top = rect.bottom + 6,
    left = edge === "left" ? rect.left - offset : rect.right - offset;
  if (left < 8) left = 8;
  if (top + menu.offsetHeight > window.innerHeight)
    top = rect.top - menu.offsetHeight - 6;
  menu.style.top = top + "px";
  menu.style.left = left + "px";
  openMenuEl = menu;
  setTimeout(
    () => document.addEventListener("click", closeMenu, { once: true }),
    0,
  );
}

function openTrackMenu(e, track, currentPlaylistId) {
  closeMenu();
  const menu = el("div", "ctx-menu");
  const favBtn = el(
    "button",
    "",
    "&#9829; " +
      (isInFavorites(track)
        ? tr("track.removeFromFavorites")
        : tr("track.addToFavorites")),
  );
  favBtn.addEventListener("click", () => {
    toggleFavorite(track);
    closeMenu();
    renderTab();
  });
  menu.appendChild(favBtn);
  const infoBtn = el("button", "", "&#9432; " + tr("track.info"));
  infoBtn.addEventListener("click", () => {
    closeMenu();
    openInfoModal(track);
  });
  menu.appendChild(infoBtn);
  menu.appendChild(el("div", "divider"));
  const addToPlaylistBtn = el("button", "", tr("track.addToPlaylist"));
  addToPlaylistBtn.addEventListener("click", () => {
    closeMenu();
    openAddToPlaylistModal(track);
  });
  menu.appendChild(addToPlaylistBtn);
  if (currentPlaylistId) {
    menu.appendChild(el("div", "divider"));
    const rem = el("button", "", tr("track.removeFromThisPlaylist"));
    rem.addEventListener("click", () => {
      removeFromPlaylist(currentPlaylistId, track.id);
      closeMenu();
    });
    menu.appendChild(rem);
  }
  menu.appendChild(el("div", "divider"));
  const delBtn = el("button", "danger", tr("track.deleteTrack"));
  delBtn.addEventListener("click", () => {
    closeMenu();
    deleteTrack(track);
  });
  menu.appendChild(delBtn);
  positionMenu(menu, e.target, { edge: "left", offset: 150 });
}

function openSortMenu(e) {
  closeMenu();

  const menu = el("div", "ctx-menu");
  menu.appendChild(el("div", "submenu-label", tr("sort.sortSongsBy")));

  SORT_OPTIONS.forEach((opt) => {
    const isActive = state[currentSortKey()] === opt.value;
    const btn = el(
      "button",
      "",
      (isActive ? "✓ " : "") + escapeHTML(tr(opt.key)),
    );
    if (isActive) btn.classList.add("selected");
    btn.addEventListener("click", () => {
      setSortBy(opt.value);
      closeMenu();
    });
    menu.appendChild(btn);
  });

  positionMenu(menu, e.currentTarget, { offset: 190 });
}

function setSortBy(value) {
  const key = currentSortKey();
  state[key] = value;
  if (key === "songsSortBy") saveSortPrefs();
  renderTab();
}

export { closeMenu, positionMenu, openTrackMenu, openSortMenu };
