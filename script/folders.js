import { state, idbPut, idbDelete } from "./state.js";
import { el } from "./utils.js";
import { tr, plural } from "./i18n.js";
import { renderTab } from "./library-view.js";
import { closeMenu, positionMenu } from "./menus.js";
import { promptModal } from "./modal.js";
import { notifyTracksDeleted, removeTrackData } from "./playlists.js";

function openFolderMenu(e, folder) {
  closeMenu();
  const menu = el("div", "ctx-menu");

  const renameBtn = el("button", "", tr("folder.rename"));
  renameBtn.addEventListener("click", () => {
    closeMenu();
    renameFolder(folder);
  });
  menu.appendChild(renameBtn);

  const forgetBtn = el("button", "", tr("folder.forget"));
  forgetBtn.addEventListener("click", () => {
    closeMenu();
    forgetFolder(folder);
  });
  menu.appendChild(forgetBtn);

  menu.appendChild(el("div", "divider"));

  const delBtn = el("button", "danger", tr("folder.delete"));
  delBtn.addEventListener("click", () => {
    closeMenu();
    deleteFolder(folder);
  });
  menu.appendChild(delBtn);

  positionMenu(menu, e.currentTarget, { offset: 170 });
}

async function renameFolder(folder) {
  const name = await promptModal(
    tr("prompt.renameFolderTitle"),
    tr("prompt.folderNameLabel"),
    folder.name,
  );
  if (!name) return;
  folder.name = name;
  idbPut("folders", folder);
  renderTab();
}

function forgetFolder(folder) {
  const tracksInFolder = state.tracks.filter((t) => t.folderId === folder.id);
  const label = tracksInFolder.length
    ? tr("and its") + plural(tracksInFolder.length, "song")
    : "";
  if (!confirm(tr("confirm.forgetNamed", { name: folder.name, label }))) return;

  tracksInFolder.forEach((t) => removeTrackData(t));

  state.folders = state.folders.filter((f) => f.id !== folder.id);
  idbDelete("folders", folder.id);

  if (state.filter && state.filter.type === "folder") {
    state.filter.tracks = state.filter.tracks.filter(
      (t) => t.folderId !== folder.id,
    );
  }
  renderTab();
}

function deleteFolder(folder) {
  const tracksInFolder = state.tracks.filter((t) => t.folderId === folder.id);
  const label = tracksInFolder.length
    ? tr("and its") + plural(tracksInFolder.length, "song")
    : "";
  if (
    !confirm(tr("confirm.deleteNamedWithLabel", { name: folder.name, label }))
  )
    return;

  notifyTracksDeleted(tracksInFolder);
  tracksInFolder.forEach((t) => removeTrackData(t));

  state.folders = state.folders.filter((f) => f.id !== folder.id);
  idbDelete("folders", folder.id);

  if (state.filter && state.filter.type === "folder") {
    state.filter.tracks = state.filter.tracks.filter(
      (t) => t.folderId !== folder.id,
    );
  }
  renderTab();
}

export { openFolderMenu };
