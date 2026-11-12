import { Offcanvas } from 'bootstrap';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch
} from 'firebase/firestore';
import { auth, db } from './firebaseConfig.js';

// =====================================================================
// Saved posts + folders
// =====================================================================
// users/{uid}/folders/{folderId}      -> { name, createdAt }
// users/{uid}/savedPosts/{postId}     -> { postId, folderId, savedAt }
//
// The saved-post document is named after the post, so a post can only ever
// be saved ONCE, which means in ONE folder. Saving it again to a different
// folder just overwrites that same document (it moves).
// Only a reference is stored, never a copy of the post. That is why likes and
// comments keep updating on a saved post.

let folders = [];
const savedPosts = new Map(); // postId -> { folderId, savedAt }
const subscribers = new Set();
let stopFolders = null;
let stopSaved = null;

function toDate(value) {
  return value && typeof value.toDate === 'function' ? value.toDate() : new Date();
}

function notify() {
  subscribers.forEach((callback) => {
    try { callback(); } catch (error) { console.error(error); }
  });
}

export function onSavedChange(callback) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

export function getFolders() {
  return folders;
}

export function isSaved(postId) {
  return savedPosts.has(postId);
}

export function getFolderIdOf(postId) {
  const entry = savedPosts.get(postId);
  return entry ? entry.folderId : null;
}

// Ids of the posts saved in a folder, most recently saved first.
export function getSavedPostIds(folderId) {
  return [...savedPosts.entries()]
    .filter(([, entry]) => entry.folderId === folderId)
    .sort((a, b) => b[1].savedAt - a[1].savedAt)
    .map(([postId]) => postId);
}

export function stopSavedListeners() {
  if (stopFolders) stopFolders();
  if (stopSaved) stopSaved();
  stopFolders = null;
  stopSaved = null;
  folders = [];
  savedPosts.clear();
  notify();
}

export function startSavedListeners(uid) {
  stopSavedListeners();

  stopFolders = onSnapshot(collection(db, 'users', uid, 'folders'), (snapshot) => {
    folders = snapshot.docs
      .map((folderSnapshot) => {
        const data = folderSnapshot.data({ serverTimestamps: 'estimate' });
        return {
          id: folderSnapshot.id,
          name: String(data.name || 'Untitled'),
          createdAt: toDate(data.createdAt)
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt); // newest folder first
    notify();
  }, (error) => console.error('Unable to load folders:', error));

  stopSaved = onSnapshot(collection(db, 'users', uid, 'savedPosts'), (snapshot) => {
    savedPosts.clear();
    snapshot.docs.forEach((savedSnapshot) => {
      const data = savedSnapshot.data({ serverTimestamps: 'estimate' });
      savedPosts.set(savedSnapshot.id, { folderId: data.folderId, savedAt: toDate(data.savedAt) });
    });
    notify();
  }, (error) => console.error('Unable to load saved posts:', error));
}

function currentUid() {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  return user.uid;
}

// Save (or move) a post into an existing folder.
export function savePostToFolder(postId, folderId) {
  const uid = currentUid();
  return setDoc(doc(db, 'users', uid, 'savedPosts', postId), {
    postId,
    folderId,
    savedAt: serverTimestamp()
  });
}

// Create a folder and save the post into it in one atomic write.
export function createFolderAndSave(postId, name) {
  const uid = currentUid();
  const folderRef = doc(collection(db, 'users', uid, 'folders')); // auto ID
  const batch = writeBatch(db);
  batch.set(folderRef, { name, createdAt: serverTimestamp() });
  batch.set(doc(db, 'users', uid, 'savedPosts', postId), {
    postId,
    folderId: folderRef.id,
    savedAt: serverTimestamp()
  });
  return batch.commit();
}

export function unsavePost(postId) {
  return deleteDoc(doc(db, 'users', currentUid(), 'savedPosts', postId));
}

// =====================================================================
// Pop-up message in the middle of the screen ("Post saved")
// Same grey pill as the "Copied" bubble, shown with Bootstrap's fade classes.
// =====================================================================
let toastElement = null;
let toastTimer = null;

export function showToast(message) {
  if (!toastElement) {
    toastElement = document.createElement('div');
    toastElement.className =
      'saved-toast badge rounded-pill text-bg-secondary fw-normal position-fixed top-50 start-50 translate-middle pe-none fade';
    toastElement.setAttribute('role', 'status');
    toastElement.setAttribute('aria-live', 'polite');
    document.body.append(toastElement);
  }
  toastElement.textContent = message;
  toastElement.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastElement.classList.remove('show'), 1500);
}

// =====================================================================
// "save to..." bottom sheet (a Bootstrap Offcanvas that slides up and down)
// Drag the handle up to expand it. When expanded the folder list scrolls.
// =====================================================================
const MAX_FOLDER_NAME = 40;
const VISIBLE_ROWS = 3; // folders shown before the sheet is expanded

const sheetState = { postId: null, trigger: null, expanded: false, drafting: false, busy: false };
let sheet = null; // element references, built the first time the sheet is opened

const collapsedHeight = () => Math.round(Math.min(380, window.innerHeight * 0.8));
const expandedHeight = () => Math.round(Math.min(window.innerHeight * 0.92, 780));

function buildSheet() {
  const element = document.createElement('div');
  element.className = 'offcanvas offcanvas-bottom folder-sheet';
  element.id = 'folderSheet';
  element.tabIndex = -1;
  element.setAttribute('aria-labelledby', 'folderSheetTitle');
  element.innerHTML = `
    <div class="folder-sheet-top">
      <div class="folder-sheet-handle" role="button" tabindex="0" aria-expanded="false"
        aria-label="Drag up to see more folders"><span class="folder-sheet-grip"></span></div>
      <button type="button" class="btn btn-link folder-sheet-back d-none" aria-label="Show fewer folders">
        <i class="bi bi-arrow-left"></i>
      </button>
      <button type="button" class="btn btn-link folder-sheet-remove d-none">Remove</button>
    </div>
    <h5 class="folder-sheet-title" id="folderSheetTitle">save to...</h5>
    <div class="folder-sheet-list">
      <div class="folder-sheet-draft"></div>
      <div class="folder-sheet-rows d-flex flex-column gap-2"></div>
      <p class="folder-sheet-none text-center small mb-0 d-none">You have no folders yet.</p>
    </div>
    <p class="folder-sheet-hint text-center small mb-0 d-none">Drag up to see more folders</p>
    <div class="folder-sheet-footer">
      <button type="button" class="btn folder-sheet-create w-100">create a new folder</button>
    </div>`;
  document.body.append(element);

  const refs = {
    element,
    drawer: Offcanvas.getOrCreateInstance(element, { backdrop: true, keyboard: true, scroll: false }),
    handle: element.querySelector('.folder-sheet-handle'),
    back: element.querySelector('.folder-sheet-back'),
    remove: element.querySelector('.folder-sheet-remove'),
    list: element.querySelector('.folder-sheet-list'),
    draft: element.querySelector('.folder-sheet-draft'),
    rows: element.querySelector('.folder-sheet-rows'),
    none: element.querySelector('.folder-sheet-none'),
    hint: element.querySelector('.folder-sheet-hint'),
    create: element.querySelector('.folder-sheet-create')
  };
  wireSheet(refs);
  return refs;
}

function folderRow(folder, isCurrent) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'folder-row';
  row.dataset.folderId = folder.id;

  const icon = document.createElement('span');
  icon.className = 'folder-row-icon';
  icon.setAttribute('aria-hidden', 'true');

  const name = document.createElement('span');
  name.className = 'folder-row-name';
  name.textContent = folder.name; // text only, never HTML

  row.append(icon, name);
  if (isCurrent) {
    const check = document.createElement('i');
    check.className = 'bi bi-check-circle-fill folder-row-check';
    check.setAttribute('aria-label', 'Current folder');
    row.append(check);
  }
  return row;
}

function renderSheetRows() {
  if (!sheet) return;
  const currentFolderId = getFolderIdOf(sheetState.postId);
  sheet.rows.replaceChildren(...folders.map((folder) => folderRow(folder, folder.id === currentFolderId)));
  sheet.none.classList.toggle('d-none', folders.length > 0 || sheetState.drafting);
  sheet.remove.classList.toggle('d-none', !currentFolderId);
  updateHint();
}

function updateHint() {
  if (!sheet) return;
  const total = folders.length + (sheetState.drafting ? 1 : 0);
  sheet.hint.classList.toggle('d-none', sheetState.expanded || total <= VISIBLE_ROWS);
}

function setExpanded(expanded, instant = false) {
  sheetState.expanded = expanded;
  const { element } = sheet;
  element.classList.toggle('is-instant', instant);
  element.classList.toggle('is-expanded', expanded);
  element.style.height = `${expanded ? expandedHeight() : collapsedHeight()}px`;
  sheet.handle.setAttribute('aria-expanded', String(expanded));
  sheet.handle.setAttribute('aria-label', expanded ? 'Drag down to show fewer folders' : 'Drag up to see more folders');
  sheet.back.classList.toggle('d-none', !expanded);
  if (instant) {
    void element.offsetHeight; // apply the height before animations are switched back on
    element.classList.remove('is-instant');
  }
  updateHint();
}

function handleSaveError(error) {
  console.error('Could not save post:', error);
  showToast('Could not save. Try again.');
}

function hideSheet() {
  if (sheet) sheet.drawer.hide();
}

function chooseFolder(folderId) {
  if (getFolderIdOf(sheetState.postId) === folderId) { // already saved here
    hideSheet();
    return;
  }
  savePostToFolder(sheetState.postId, folderId).catch(handleSaveError);
  showToast('Post saved');
  hideSheet();
}

function startDraft() {
  if (sheetState.drafting) {
    sheet.draft.querySelector('input').focus();
    return;
  }
  sheetState.drafting = true;

  const row = document.createElement('div');
  row.className = 'folder-row folder-row-draft';
  row.innerHTML = `
    <button type="button" class="folder-row-icon folder-row-confirm" aria-label="Save folder and post">
      <i class="bi bi-check-lg"></i>
    </button>
    <div class="flex-grow-1 min-w-0">
      <input type="text" class="form-control form-control-sm folder-name-input" maxlength="${MAX_FOLDER_NAME}"
        placeholder="Name your folder" aria-label="New folder name" autocomplete="off">
      <div class="invalid-feedback">Please name your folder.</div>
      <div class="folder-row-hint small mt-1">Type a name, then tap the folder to save.</div>
    </div>`;
  sheet.draft.replaceChildren(row);
  sheet.none.classList.add('d-none');
  sheet.list.scrollTop = 0;
  row.querySelector('input').focus();
  updateHint();
}

function confirmDraft() {
  const input = sheet.draft.querySelector('input');
  if (!input) return;
  const name = input.value.trim().slice(0, MAX_FOLDER_NAME);
  if (!name) {
    input.classList.add('is-invalid');
    input.focus();
    return;
  }
  createFolderAndSave(sheetState.postId, name).catch(handleSaveError);
  showToast('Post saved');
  hideSheet();
}

function wireSheet(refs) {
  const { element } = refs;

  refs.rows.addEventListener('click', (event) => {
    const row = event.target.closest('[data-folder-id]');
    if (row) chooseFolder(row.dataset.folderId);
  });

  refs.create.addEventListener('click', startDraft);

  refs.draft.addEventListener('click', (event) => {
    if (!event.target.closest('.folder-row-draft') || event.target.matches('input')) return;
    confirmDraft(); // tapping the new folder saves its name and the post
  });
  refs.draft.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('input')) {
      event.preventDefault();
      confirmDraft();
    }
  });
  refs.draft.addEventListener('input', (event) => {
    if (!event.target.matches('input')) return;
    event.target.classList.remove('is-invalid');
    event.target.closest('.folder-row-draft').classList.toggle('has-name', event.target.value.trim() !== '');
  });

  refs.remove.addEventListener('click', () => {
    unsavePost(sheetState.postId).catch(handleSaveError);
    showToast('Removed from saved');
    hideSheet();
  });
  refs.back.addEventListener('click', () => setExpanded(false));

  // ---- drag the handle up to expand, down to collapse or close ----
  let drag = null;
  refs.handle.addEventListener('pointerdown', (event) => {
    drag = { startY: event.clientY, startHeight: element.offsetHeight, moved: false };
    refs.handle.setPointerCapture(event.pointerId);
    element.classList.add('is-dragging');
  });
  refs.handle.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const up = drag.startY - event.clientY;
    if (Math.abs(up) > 4) drag.moved = true;
    const height = Math.max(collapsedHeight() * 0.6, Math.min(expandedHeight(), drag.startHeight + up));
    element.style.height = `${height}px`;
  });
  const endDrag = (event) => {
    if (!drag) return;
    const up = drag.startY - event.clientY;
    const { moved } = drag;
    drag = null;
    element.classList.remove('is-dragging');
    if (!moved) setExpanded(!sheetState.expanded);
    else if (!sheetState.expanded) {
      if (up > 40) setExpanded(true);
      else if (up < -70) hideSheet();
      else setExpanded(false);
    } else {
      setExpanded(up >= -60);
    }
  };
  refs.handle.addEventListener('pointerup', endDrag);
  refs.handle.addEventListener('pointercancel', endDrag);
  refs.handle.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setExpanded(!sheetState.expanded); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setExpanded(true); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); setExpanded(false); }
  });

  element.addEventListener('hidden.bs.offcanvas', () => {
    refs.draft.replaceChildren();
    sheetState.drafting = false;
    const { trigger } = sheetState;
    sheetState.postId = null;
    sheetState.trigger = null;
    if (trigger && document.contains(trigger)) trigger.focus({ preventScroll: true });
  });

  // Keep the sheet in step with the database while it is open.
  onSavedChange(() => {
    if (element.classList.contains('show')) renderSheetRows();
  });
}

// Open the "save to..." sheet for a post.
export function openFolderSheet(postId, trigger) {
  if (!auth.currentUser) {
    showToast('Sign in to save posts');
    return;
  }
  if (!sheet) sheet = buildSheet();
  sheetState.postId = postId;
  sheetState.trigger = trigger || null;
  sheetState.drafting = false;
  sheet.draft.replaceChildren();
  setExpanded(false, true);
  renderSheetRows();
  sheet.drawer.show(trigger);
}
