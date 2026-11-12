import '../../Web_Files/css/for-you.css';
import forYouHtml from '../../Web_Files/html/for-you.html?raw';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../Web_Files/js/firebaseConfig.js';
import { getFolders, getSavedPostIds, onSavedChange } from '../../Web_Files/js/saved.js';

// ---------------------------------------------------------------------
// Saved page
// Folders and the posts inside them come from Firestore:
//   users/{uid}/folders/{folderId}   and   users/{uid}/savedPosts/{postId}
// The post itself is read from posts/{postId} (through the For You code),
// so its likes and comments are always current.
// ---------------------------------------------------------------------

const folderGrid = document.getElementById('folder-grid');
const foldersEmpty = document.getElementById('folders-empty');

const overlay = document.getElementById('folder-overlay');
const backButton = document.getElementById('folder-back');
const folderTitle = document.getElementById('folder-title');
const folderScroll = document.getElementById('folder-scroll');
const folderPosts = document.getElementById('folder-posts');
const folderEmpty = document.getElementById('folder-empty');

let engine = null;        // the For You module, once loaded
let postsReady = false;   // true after the first posts snapshot
let signedIn = null;      // null = not known yet
let openFolderId = null;
let lastTrigger = null;
let gridSignature = '';
let postsSignature = '';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]
  ));
}

function postOf(postId) {
  return engine ? engine.getPostById(postId) : null;
}

const isHttps = (url) => typeof url === 'string' && /^https:\/\//i.test(url.trim());

// The picture of the most recently saved post in a folder that has one.
function coverFor(folderId) {
  for (const postId of getSavedPostIds(folderId)) {
    const post = postOf(postId);
    if (post && isHttps(post.imageUrl)) return post.imageUrl.trim();
  }
  return '';
}

// ---------------------------------------------------------------------
// Folder grid
// ---------------------------------------------------------------------
function renderFolder(folder, coverUrl) {
  const column = document.createElement('div');
  column.className = 'col';
  column.innerHTML = `
    <button type="button" class="folder-tile rounded-3" data-folder-id="${escapeHtml(folder.id)}">
      <span class="folder-cover">${coverUrl ? `<img src="${escapeHtml(coverUrl)}" alt="" class="w-100 h-100">` : ''}</span>
      <span class="folder-label fw-bold small text-uppercase text-truncate">${escapeHtml(folder.name)}</span>
    </button>`;
  return column;
}

function renderFolders() {
  const folders = getFolders();
  const covers = folders.map((folder) => coverFor(folder.id));

  foldersEmpty.textContent = signedIn === false
    ? 'Please sign in to see your saved posts.'
    : 'No saved folders yet. Tap the bookmark on a post to start one.';
  foldersEmpty.classList.toggle('d-none', folders.length > 0 || signedIn === null);

  // Only rebuild when something visible changed (keeps keyboard focus steady).
  const signature = JSON.stringify(folders.map((folder, index) => [folder.id, folder.name, covers[index]]));
  if (signature === gridSignature) return;
  gridSignature = signature;
  folderGrid.replaceChildren(...folders.map((folder, index) => renderFolder(folder, covers[index])));
}

// ---------------------------------------------------------------------
// Posts inside the open folder
// ---------------------------------------------------------------------
function renderSavedPost(post) {
  const column = document.createElement('div');
  column.className = 'col';
  const body = isHttps(post.imageUrl)
    ? `<img src="${escapeHtml(post.imageUrl.trim())}" alt="" class="w-100 h-100">`
    : `<span class="saved-post-text">${escapeHtml(post.title || 'Untitled post')}</span>`;
  column.innerHTML = `
    <div class="saved-post ratio rounded-2 overflow-hidden" role="button" tabindex="0"
         data-post-id="${escapeHtml(post.id)}" aria-label="Open post: ${escapeHtml(post.title || 'Untitled post')}">
      ${body}
      <i class="bi bi-bookmark-fill saved-badge" aria-hidden="true"></i>
    </div>`;
  return column;
}

function renderFolderPosts() {
  if (!openFolderId) return;
  if (!postsReady) return; // wait for the posts so "no saved posts yet…" never flashes by mistake

  const posts = getSavedPostIds(openFolderId).map(postOf).filter(Boolean);
  folderEmpty.classList.toggle('d-none', posts.length > 0);

  const signature = JSON.stringify(posts.map((post) => [post.id, post.title, post.imageUrl]));
  if (signature === postsSignature) return;
  postsSignature = signature;
  folderPosts.replaceChildren(...posts.map(renderSavedPost));
}

function renderAll() {
  renderFolders();
  if (openFolderId) {
    if (getFolders().some((folder) => folder.id === openFolderId)) renderFolderPosts();
    else closeFolder();
  }
}

// ---------------------------------------------------------------------
// Folder overlay
// ---------------------------------------------------------------------
function openFolder(folderId, triggerElement) {
  const folder = getFolders().find((item) => item.id === folderId);
  if (!folder) return;

  openFolderId = folderId;
  lastTrigger = triggerElement || null;
  postsSignature = '';
  folderTitle.textContent = folder.name;
  folderPosts.replaceChildren();
  folderEmpty.classList.add('d-none');
  renderFolderPosts();
  folderScroll.scrollTop = 0;

  overlay.inert = false;
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('folder-open');
  overlay.classList.add('is-open');
  backButton.focus({ preventScroll: true });
}

function closeFolder() {
  openFolderId = null;
  overlay.classList.remove('is-open');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.inert = true;
  document.body.classList.remove('folder-open');
  if (lastTrigger && document.contains(lastTrigger)) lastTrigger.focus({ preventScroll: true });
}

backButton.addEventListener('click', closeFolder);

folderGrid.addEventListener('click', (event) => {
  const tile = event.target.closest('.folder-tile');
  if (tile) openFolder(tile.dataset.folderId, tile);
});

function openSavedPost(tile) {
  if (engine) engine.openPostById(tile.dataset.postId, tile);
}
folderPosts.addEventListener('click', (event) => {
  const tile = event.target.closest('.saved-post');
  if (tile) openSavedPost(tile);
});
folderPosts.addEventListener('keydown', (event) => {
  const tile = event.target.closest('.saved-post');
  if (tile && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    openSavedPost(tile);
  }
});

// Esc closes only the top-most screen. This runs before the For You handler
// (capture phase) so it can see whether a post or the save sheet is open on top.
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const somethingOnTop = document.body.classList.contains('post-details-open')
    || document.querySelector('.folder-sheet.show');
  if (!somethingOnTop && overlay.classList.contains('is-open')) closeFolder();
}, true);

// While a post is open on top of the folder, switch the folder screen off so
// Tab and clicks cannot reach it.
new MutationObserver(() => {
  const postOpen = document.body.classList.contains('post-details-open');
  overlay.inert = !overlay.classList.contains('is-open') || postOpen;
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });

// ---------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------
onSavedChange(renderAll);

onAuthStateChanged(auth, (user) => {
  signedIn = Boolean(user);
  renderAll();
});

// Load the For You screens (post details + comments) without showing the feed.
async function loadForYouEngine() {
  const mount = document.getElementById('forYouMount');
  const source = new DOMParser().parseFromString(forYouHtml, 'text/html');

  const page = source.querySelector('main');
  if (page) mount.appendChild(document.importNode(page, true));
  source.body.querySelectorAll(':scope > [role="dialog"]').forEach((dialog) => {
    document.body.appendChild(document.importNode(dialog, true));
  });

  engine = await import('../../Web_Files/js/for-you.js');
  engine.onPostsChanged(() => {
    postsReady = true;
    renderAll();
  });
}

loadForYouEngine();
