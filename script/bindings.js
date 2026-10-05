import {
  $,
  state,
  searchInput,
  searchRow,
  playerPanel,
  backBtn,
  searchToggle,
  locatePlayingToggle,
  addMusicToggle,
  selectToggle,
  volumeBtn,
  volumeSlider,
} from "./state.js";
import { ingestFiles } from "./metadata.js";
import { pulseCtrlBtn, debounce } from "./utils.js";
import {
  renderTab,
  toggleSelectMode,
  scrollToNowPlaying,
} from "./library-view.js";
import {
  closeSideDropdown,
  toggleSideDropdown,
  openInfoModal,
} from "./side-menu.js";
import {
  togglePlay,
  nextTrack,
  prevTrack,
  playTrack,
  seekBy,
  addRepeatExtra,
  resetRepeatExtra,
} from "./player.js";
import { closeModal } from "./modal.js";
import {
  adjustVolume,
  setVolume,
  toggleMute,
  toggleVolumePopup,
} from "./volume.js";
import { wireDragAndDropPlay } from "./drag-drop.js";
import {
  addFilesToConvertQueue,
  handleConvertProgressTick,
} from "./convert.js";
import { openSortMenu } from "./menus.js";
import {
  openAddMusicModal,
  toggleFavorite,
  deleteSelectedItems,
  openAddSelectedToPlaylistModal,
} from "./playlists.js";
import { resetShuffleNextPick } from "./queue.js";
import { cycleRepeatMode, refreshNextPreview } from "./now-playing-ui.js";
import { toggleLyrics, openSyncModal } from "./lyrics.js";
import { openSettingsModal } from "./settings.js";
import { openAboutModal } from "./backup.js";
import { openSleepTimerModal } from "./sleep-timer.js";
import { openHistoryModal } from "./history.js";
import { openEditModal } from "./metadata-edit.js";
import {
  SEEK_STEP_SECONDS,
  VOLUME_STEP,
  findShortcutForEvent,
} from "./shortcuts.js";

function toggleRail() {
  $("appRoot").classList.toggle("rail-expanded");
}

// What each keyboard shortcut does. Which keys trigger them (and how they are
// listed in Settings → Keyboard Shortcuts) is defined in shortcuts.js.
const SHORTCUT_ACTIONS = {
  playPause: togglePlay,
  mute: toggleMute,
  repeatExtra: addRepeatExtra,
  repeatExtraReset: resetRepeatExtra,
  volumeUp: () => adjustVolume(VOLUME_STEP),
  volumeDown: () => adjustVolume(-VOLUME_STEP),
  seekForward: () => seekBy(SEEK_STEP_SECONDS),
  seekBack: () => seekBy(-SEEK_STEP_SECONDS),
  nextTrack: () => nextTrack(false),
  prevTrack: () => prevTrack(),
};

function bindEvents() {
  document.addEventListener("keydown", (e) => {
    const t = e.target;
    const isTyping =
      t &&
      (t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.isContentEditable);
    if (isTyping) return;

    const shortcut = findShortcutForEvent(e);
    const action = shortcut && SHORTCUT_ACTIONS[shortcut.id];
    if (!action) return;
    e.preventDefault();
    action();
  });

  document.querySelectorAll(".rail-item[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".rail-item[data-tab]")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.currentTab = btn.dataset.tab;
      state.filter = null;
      state.playlistFolderId = null;
      searchInput.value = "";
      renderTab();
    });
  });

  backBtn.addEventListener("click", () => {
    if (state.filter) {
      state.filter = null;
    } else if (state.currentTab === "playlists" && state.playlistFolderId) {
      const current = state.playlistFolders.find(
        (f) => f.id === state.playlistFolderId,
      );
      state.playlistFolderId = current ? current.parentId || null : null;
    }
    searchInput.value = "";
    renderTab();
  });
  searchToggle.addEventListener("click", () => {
    searchRow.classList.toggle("hidden");
    if (!searchRow.classList.contains("hidden")) searchInput.focus();
    else {
      searchInput.value = "";
      renderTab();
    }
  });
  searchInput.addEventListener("input", debounce(renderTab, 120));

  locatePlayingToggle.addEventListener("click", scrollToNowPlaying);

  $("sortToggle").addEventListener("click", (e) => {
    e.stopPropagation();
    openSortMenu(e);
  });

  addMusicToggle.addEventListener("click", () => {
    if (state.filter && state.filter.type === "playlist")
      openAddMusicModal(state.filter.playlistId);
  });

  selectToggle.addEventListener("click", toggleSelectMode);
  $("selCancelBtn").addEventListener("click", toggleSelectMode);
  $("selDeleteBtn").addEventListener("click", deleteSelectedItems);
  $("selAddPlaylistBtn").addEventListener(
    "click",
    openAddSelectedToPlaylistModal,
  );

  wireDragAndDropPlay();

  $("filesInput").addEventListener("change", (e) => {
    ingestFiles(e.target.files, null);
    e.target.value = "";
  });
  $("folderInput").addEventListener("change", (e) => {
    const files = e.target.files;
    if (!files.length) {
      e.target.value = "";
      return;
    }
    let folderName = "Folder";
    const rel = files[0].webkitRelativePath;
    if (rel) folderName = rel.split("/")[0];
    ingestFiles(files, folderName);
    e.target.value = "";
  });

  $("convertFilesInput").addEventListener("change", (e) => {
    const files = e.target.files;
    if (files.length) addFilesToConvertQueue(files);
    e.target.value = "";
  });

  $("playBtn").addEventListener("click", togglePlay);
  $("nextBtn").addEventListener("click", () => {
    pulseCtrlBtn("nextBtn", "skip-kick", 380, "ctrl-streak");
    nextTrack(false);
  });
  $("prevBtn").addEventListener("click", () => {
    pulseCtrlBtn("prevBtn", "skip-kick", 380, "ctrl-streak");
    prevTrack();
  });
  $("shuffleBtn").addEventListener("click", () => {
    state.shuffle = !state.shuffle;
    if (!state.shuffle) state.shuffleHistory = [];
    resetShuffleNextPick();
    $("shuffleBtn").classList.toggle("active", state.shuffle);
    pulseCtrlBtn("shuffleBtn", "shuffle-spin", 520);
    refreshNextPreview();
  });
  $("repeatBtn").addEventListener("click", () => {
    cycleRepeatMode();
    pulseCtrlBtn("repeatBtn", "repeat-flip", 520);
  });
  $("lyricsBtn").addEventListener("click", toggleLyrics);
  $("loveBtn").addEventListener("click", () => {
    if (state.currentTrack) {
      toggleFavorite(state.currentTrack);
    }
  });

  $("miniPlay").addEventListener("click", togglePlay);
  $("miniNext").addEventListener("click", () => {
    pulseCtrlBtn("miniNext", "skip-kick", 380, "ctrl-streak");
    nextTrack(false);
  });
  $("miniPrev").addEventListener("click", () => {
    pulseCtrlBtn("miniPrev", "skip-kick", 380, "ctrl-streak");
    prevTrack();
  });

  $("miniInfo").addEventListener("click", () =>
    playerPanel.classList.add("expanded"),
  );
  $("closeOverlay").addEventListener("click", () =>
    playerPanel.classList.remove("expanded"),
  );

  $("railToggle").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleRail();
  });
  $("railSettingsBtn").addEventListener("click", openSettingsModal);
  $("railAboutBtn").addEventListener("click", openAboutModal);

  $("sideMenuBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleSideDropdown();
  });
  $("menuInfoBtn").addEventListener("click", () => {
    closeSideDropdown();
    openInfoModal();
  });
  $("menuEditBtn").addEventListener("click", () => {
    closeSideDropdown();
    openEditModal();
  });
  $("menuSyncBtn").addEventListener("click", () => {
    closeSideDropdown();
    openSyncModal();
  });
  $("menuSleepBtn").addEventListener("click", () => {
    closeSideDropdown();
    openSleepTimerModal();
  });
  $("menuHistoryBtn").addEventListener("click", () => {
    closeSideDropdown();
    openHistoryModal();
  });

  volumeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleVolumePopup();
  });
  volumeSlider.addEventListener("input", (e) => {
    setVolume(e.target.value / 100);
  });

  $("modalCloseBtn").addEventListener("click", closeModal);
  $("modalOverlay").addEventListener("click", (e) => {
    if (
      e.target.id === "modalOverlay" &&
      !$("modalBody").querySelector('[data-unsaved="1"]')
    )
      closeModal();
  });
}

if (window.electronAPI) {
  window.electronAPI.onOpenFile(async (payload) => {
    if (!payload || !payload.data) return;

    const bytes =
      payload.data instanceof Uint8Array
        ? payload.data
        : new Uint8Array(payload.data);
    const file = new File([bytes], payload.name, { type: payload.mime });
    if (payload.path) file.__electronPath = payload.path;

    const [track] = await ingestFiles([file], null, { persist: false });

    if (track) {
      playTrack(track, [track]);
    } else {
      console.warn(
        "Opened file wasn't a supported audio file, ignoring:",
        payload.name,
      );
    }
  });

  window.electronAPI.onFFmpegInstallProgress(({ line }) => {
    if (line == null) return;
    state.convert.installLog.push(line);
    if (
      state.currentTab === "convert" &&
      state.convert.ffmpegStatus === "installing"
    )
      renderTab();
  });
  window.electronAPI.onConvertProgress(handleConvertProgressTick);
}

export { bindEvents };
