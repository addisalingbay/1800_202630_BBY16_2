import { onAuthStateChanged } from 'firebase/auth';
import { auth, LOGIN_PAGE } from './firebase-init.js';
import { subscribeToFolders, subscribeToSavedPosts } from './bookmarks-db.js';

const folderGrid = document.getElementById('folder-grid');
const foldersEmpty = document.getElementById('folders-empty');

const overlay = document.getElementById('folder-overlay');
const backButton = document.getElementById('folder-back');
const folderTitle = document.getElementById('folder-title');
const folderScroll = document.getElementById('folder-scroll');
const folderPosts = document.getElementById('folder-posts');
const folderEmpty = document.getElementById('folder-empty');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const foldersById = new Map();
let openFolderId = null;
let lastTrigger = null;
let currentUser = null;
let stopFolders = () => {};
let stopSavedPosts = () => {};

function renderFolder(folder) {
  foldersById.set(folder.id, folder);

  const col = document.createElement('div');
  col.className = 'col';
  col.dataset.folderId = folder.id;
  col.innerHTML = `
    <button type="button" class="folder-tile rounded-3" data-folder-id="${escapeHtml(folder.id)}">
      <span class="folder-cover">${folder.coverUrl ? `<img src="${escapeHtml(folder.coverUrl)}" alt="" class="w-100 h-100">` : ''}</span>
      <span class="folder-label fw-bold small text-white text-uppercase text-truncate">${escapeHtml(folder.name)}</span>
    </button>`;
  return col;
}

function renderFolders(folders) {
  foldersById.clear();
  folderGrid.replaceChildren(...folders.map(renderFolder));
  foldersEmpty.classList.toggle('d-none', folders.length > 0);
}

function renderSavedPost(post) {
  const col = document.createElement('div');
  col.className = 'col';
  col.dataset.postId = post.id;
  col.innerHTML = `
    <div class="saved-post ratio rounded-2 overflow-hidden">
      ${post.thumbnailUrl ? `<img src="${escapeHtml(post.thumbnailUrl)}" alt="Saved post" class="w-100 h-100">` : ''}
      <i class="bi bi-bookmark-fill saved-badge" aria-hidden="true"></i>
    </div>`;
  return col;
}

function updateFolderEmptyState() {
  folderEmpty.classList.toggle('d-none', folderPosts.children.length > 0);
}

function renderSavedPosts(posts) {
  folderPosts.replaceChildren(...posts.map(renderSavedPost));
  updateFolderEmptyState();
}

function openFolder(folderId, triggerEl) {
  const folder = foldersById.get(folderId);
  if (!folder) return;

  openFolderId = folderId;
  lastTrigger = triggerEl || null;
  folderTitle.textContent = folder.name;
  folderPosts.replaceChildren();
  folderEmpty.classList.add('d-none');
  stopSavedPosts();
  stopSavedPosts = subscribeToSavedPosts(currentUser.uid, folderId, renderSavedPosts);
  folderScroll.scrollTop = 0;

  overlay.inert = false;
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('folder-open');
  overlay.classList.add('is-open');
  backButton.focus({ preventScroll: true });
}

function closeFolder() {
  openFolderId = null;
  stopSavedPosts();
  stopSavedPosts = () => {};
  overlay.classList.remove('is-open');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.inert = true;
  document.body.classList.remove('folder-open');
  if (lastTrigger) lastTrigger.focus({ preventScroll: true });
}

backButton.addEventListener('click', closeFolder);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && overlay.classList.contains('is-open')) closeFolder();
});

folderGrid.addEventListener('click', (e) => {
  const tile = e.target.closest('.folder-tile');
  if (tile) openFolder(tile.dataset.folderId, tile);
});

onAuthStateChanged(auth, (user) => {
  stopFolders();
  if (!user) {
    window.location.href = LOGIN_PAGE;
    return;
  }
  currentUser = user;
  stopFolders = subscribeToFolders(user.uid, renderFolders);
});
