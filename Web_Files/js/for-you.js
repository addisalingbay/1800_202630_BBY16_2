import { auth, db } from './firebaseConfig.js';
import { isSaved, onSavedChange, openFolderSheet, startSavedListeners, stopSavedListeners } from './saved.js';
import { onAuthStateChanged } from 'firebase/auth';
import {
  addDoc,
  collection,
  doc,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';

const feed = document.getElementById('post-feed');
const sentinel = document.getElementById('feed-sentinel');

const postsById = new Map();
const commentsByPostId = new Map();
let activePostId = null;
let commentsTrigger = null;
let lastTrigger = null;
let stopCommentsListener = null;
let stopPostsListener = null;

// Lets other pages (the Saved page) read the posts and react when they change.
let postsLoaded = false;
const postsSubscribers = new Set();

// Likes: ids of the posts the signed-in user has liked (live from
// users/{uid}/likedPosts), plus posts with a like write still in flight.
const likedPostIds = new Set();
const pendingLikes = new Set();
let stopLikesListener = null;

// Share links look like ...homePage.html?post=<postId>
let deepLinkPostId = new URLSearchParams(window.location.search).get('post');

const overlay = document.getElementById('post-details');
const backButton = document.getElementById('post-details-back');
const detailsScroll = document.getElementById('post-details-scroll');
const detailsPost = document.getElementById('post-details-post');
const commentsList = document.getElementById('comments-list');
const commentsCount = document.getElementById('comments-count');
const commentsEmpty = document.getElementById('comments-empty');

const commentsOverlay = document.getElementById('comments-overlay');
const commentsBack = document.getElementById('comments-back');
const commentsOverlayScroll = document.getElementById('comments-overlay-scroll');
const commentsOverlayList = document.getElementById('comments-overlay-list');
const commentsOverlayEmpty = document.getElementById('comments-overlay-empty');
const commentTextarea = document.getElementById('comment-textarea');
const commentSend = document.getElementById('comment-send');
const commentLaunchBar = document.getElementById('comment-launch-bar');
const commentLaunch = document.getElementById('comment-launch');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function asDate(value) {
  if (value && typeof value.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function formatTimeAgo(date, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - date.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? '1 day ago' : `${days} days ago`;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function timeHtml(date, extraClasses = '') {
  const safeDate = asDate(date);
  return `<time class="${extraClasses}" datetime="${safeDate.toISOString()}" data-created-at="${safeDate.getTime()}">${formatTimeAgo(safeDate)}</time>`;
}

function tagsHtml(tags) {
  if (!Array.isArray(tags) || !tags.length) return '';
  return `<div class="d-flex flex-wrap gap-1">${tags.map((tag) =>
    `<span class="badge rounded-pill text-bg-secondary fw-normal">${escapeHtml(tag)}</span>`
  ).join('')}</div>`;
}

// ---------------------------------------------------------------------
// Bookmark (save to a folder)
// ---------------------------------------------------------------------
function bookmarkButtonHtml(postId) {
  const saved = isSaved(postId);
  return `<button type="button" class="btn btn-link p-0 fs-4 lh-1 post-action ${saved ? 'saved-active' : 'text-body'}" data-bookmark-button data-bookmark-post="${escapeHtml(postId)}" aria-label="${saved ? 'Saved. Change folder' : 'Save post'}" aria-pressed="${saved}"><i class="bi ${saved ? 'bi-bookmark-fill' : 'bi-bookmark'}"></i></button>`;
}

// Fill / empty every bookmark icon on screen (feed cards and the details header).
function syncBookmarkUI() {
  document.querySelectorAll('[data-bookmark-button]').forEach((button) => {
    const postId = button.dataset.bookmarkPost || activePostId;
    const saved = Boolean(postId) && isSaved(postId);
    button.classList.toggle('saved-active', saved);
    button.classList.toggle('text-body', !saved);
    button.setAttribute('aria-pressed', String(saved));
    button.setAttribute('aria-label', saved ? 'Saved. Change folder' : 'Save post');
    const icon = button.querySelector('i');
    icon.classList.toggle('bi-bookmark-fill', saved);
    icon.classList.toggle('bi-bookmark', !saved);
  });
}

function actionsHtml(post) {
  const liked = likedPostIds.has(post.id);
  return `
    <div class="d-flex align-items-center gap-3 fs-5" data-post-id="${escapeHtml(post.id)}">
      <span class="d-inline-flex align-items-center gap-1">
        <button type="button" class="btn btn-link p-0 lh-1 post-action ${liked ? 'like-active' : 'text-body'}" data-like-button aria-label="${liked ? 'Unlike' : 'Like'}" aria-pressed="${liked}"><i class="bi ${liked ? 'bi-heart-fill' : 'bi-heart'}"></i></button>
        <span class="like-count small" data-like-count>${post.likeCount}</span>
      </span>
      <button type="button" class="btn btn-link text-body p-0 lh-1 post-action" data-open-comments aria-label="Comments"><i class="bi bi-chat-square-text"></i></button>
      <span class="position-relative d-inline-flex">
        <button type="button" class="btn btn-link text-body p-0 lh-1 post-action" data-share-button aria-label="Copy link to post"><i class="bi bi-share-fill"></i></button>
        <span class="share-toast badge rounded-pill text-bg-secondary fw-normal position-absolute top-100 start-50 translate-middle-x mt-1 pe-none fade" role="status" aria-live="polite"></span>
      </span>
    </div>`;
}

function imageHtml(post, ratioClass) {
  const imageUrl = typeof post.imageUrl === 'string' ? post.imageUrl.trim() : '';
  const safeUrl = imageUrl && /^https:\/\//i.test(imageUrl) ? imageUrl : '';
  const inner = safeUrl
    ? `<img src="${escapeHtml(safeUrl)}" alt="Post image" class="w-100 h-100" loading="lazy">`
    : '';
  return `<div class="post-image ratio ${ratioClass} bg-secondary-subtle" ${inner ? '' : 'aria-hidden="true"'}>${inner}</div>`;
}

function normalizePost(snapshot) {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    uid: data.uid,
    username: data.username || 'User',
    title: data.title || '',
    tags: Array.isArray(data.tags) ? data.tags : [],
    description: data.description || '',
    imageUrl: data.imageUrl || '',
    likeCount: Math.max(0, Number(data.likeCount) || 0),
    createdAt: asDate(data.createdAt)
  };
}

function renderPost(post) {
  postsById.set(post.id, post);
  const card = document.createElement('article');
  card.className = 'post-card card bg-body-tertiary border-0 rounded-3 overflow-hidden mb-3';
  card.id = post.id;
  card.tabIndex = 0;

  const header = `
    <div class="card-header bg-transparent border-0 d-flex align-items-center gap-2 py-2">
      <div class="post-avatar"></div>
      <span class="fw-bold flex-grow-1 text-truncate">${escapeHtml(post.username)}</span>
      ${timeHtml(post.createdAt, 'small text-body-secondary')}
      ${bookmarkButtonHtml(post.id)}
    </div>
    <div class="px-3 pb-2">
      <h2 class="h5 fw-bold mb-1">${escapeHtml(post.title)}</h2>
      ${tagsHtml(post.tags)}
    </div>`;
  const preview = `<p class="post-preview small mb-0">${escapeHtml(post.description)}</p>`;

  if (!post.imageUrl) {
    card.innerHTML = `${header}<div class="card-body pt-1 pb-4">${preview}<div class="mt-2">${actionsHtml(post)}</div></div>`;
  } else {
    card.innerHTML = `${header}${imageHtml(post, 'ratio-1x1')}<div class="card-body py-2"><div class="mb-1">${actionsHtml(post)}</div>${preview}</div>`;
  }
  return card;
}

function showFeedMessage(message) {
  feed.replaceChildren();
  const empty = document.createElement('p');
  empty.className = 'text-body-secondary text-center py-5 mb-0';
  empty.textContent = message;
  feed.appendChild(empty);
}

function startPostsFeed() {
  if (stopPostsListener) stopPostsListener();
  const postsQuery = query(collection(db, 'posts'), orderBy('createdAt', 'desc'));
  stopPostsListener = onSnapshot(postsQuery, (snapshot) => {
    postsById.clear();
    if (snapshot.empty) {
      showFeedMessage('no posts yet');
      sentinel.classList.add('d-none');
      postsLoaded = true;
      notifyPostsChanged();
      return;
    }

    const fragment = document.createDocumentFragment();
    snapshot.docs.forEach((postSnapshot) => {
      const post = normalizePost(postSnapshot);
      fragment.appendChild(renderPost(post));
    });
    feed.replaceChildren(fragment);
    sentinel.classList.add('d-none');

    // Keep the open details view synchronized if the active post changes.
    if (activePostId && postsById.has(activePostId)) {
      renderPostDetails(postsById.get(activePostId));
    }

    postsLoaded = true;
    notifyPostsChanged();
    openDeepLinkedPost();
  }, (error) => {
    console.error('Unable to load posts from Firestore:', error);
    showFeedMessage('Unable to load posts. Please refresh and try again.');
    sentinel.classList.add('d-none');
  });
}

// ---------------------------------------------------------------------
// Likes
// ---------------------------------------------------------------------
// users/{uid}/likedPosts/{postId}  -> one doc per (user, post), so a user can
//                                     only ever like a post once.
// posts/{postId}.likeCount         -> the counter shown next to the heart.
// Both are changed together in one atomic batch.
function syncLikeUI() {
  document.querySelectorAll('[data-post-id]').forEach((group) => {
    const post = postsById.get(group.dataset.postId);
    if (!post) return;
    const liked = likedPostIds.has(post.id);
    const button = group.querySelector('[data-like-button]');
    const icon = button.querySelector('i');
    button.classList.toggle('like-active', liked);
    button.classList.toggle('text-body', !liked);
    button.setAttribute('aria-pressed', String(liked));
    button.setAttribute('aria-label', liked ? 'Unlike' : 'Like');
    icon.classList.toggle('bi-heart-fill', liked);
    icon.classList.toggle('bi-heart', !liked);
    group.querySelector('[data-like-count]').textContent = String(post.likeCount);
  });
}

async function toggleLike(postId) {
  const user = auth.currentUser;
  if (!user || !postsById.has(postId) || pendingLikes.has(postId)) return;
  pendingLikes.add(postId);

  const postRef = doc(db, 'posts', postId);
  const likeRef = doc(db, 'users', user.uid, 'likedPosts', postId);
  const batch = writeBatch(db);
  if (likedPostIds.has(postId)) {
    batch.delete(likeRef);
    batch.update(postRef, { likeCount: increment(-1) });
  } else {
    batch.set(likeRef, { postId, createdAt: serverTimestamp() });
    batch.update(postRef, { likeCount: increment(1) });
  }

  try {
    await batch.commit();
  } catch (error) {
    console.error('Could not update like:', error);
    alert('Your like could not be saved. Please check your connection and try again.');
  } finally {
    pendingLikes.delete(postId);
    syncLikeUI();
  }
}

function startLikesListener(uid) {
  if (stopLikesListener) stopLikesListener();
  stopLikesListener = onSnapshot(collection(db, 'users', uid, 'likedPosts'), (snapshot) => {
    likedPostIds.clear();
    snapshot.docs.forEach((likeSnapshot) => likedPostIds.add(likeSnapshot.id));
    syncLikeUI();
  }, (error) => {
    console.error('Unable to load liked posts:', error);
  });
}

function stopLikes() {
  if (stopLikesListener) stopLikesListener();
  stopLikesListener = null;
  likedPostIds.clear();
  syncLikeUI();
}

// ---------------------------------------------------------------------
// Share
// ---------------------------------------------------------------------
function postShareUrl(postId) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('post', postId);
  return url.toString();
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      // fall through to the legacy copy below
    }
  }
  const helper = document.createElement('textarea');
  helper.value = text;
  helper.setAttribute('readonly', '');
  helper.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
  document.body.appendChild(helper);
  helper.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch (error) { copied = false; }
  helper.remove();
  return copied;
}

async function sharePost(postId, button) {
  const copied = await copyText(postShareUrl(postId));
  const toast = button.parentElement.querySelector('.share-toast');
  if (!toast) return;
  toast.textContent = copied ? 'Copied' : 'Failed';
  toast.classList.add('show');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 1400);
}

function openDeepLinkedPost() {
  if (!deepLinkPostId) return;
  const postId = deepLinkPostId;
  deepLinkPostId = null;

  const params = new URLSearchParams(window.location.search);
  params.delete('post');
  const remaining = params.toString();
  history.replaceState(null, '', window.location.pathname + (remaining ? `?${remaining}` : '') + window.location.hash);

  if (postsById.has(postId)) openPostDetails(postId, null);
  else console.warn('Shared post not found:', postId);
}

function updateTimestamps() {
  const now = Date.now();
  document.querySelectorAll('[data-created-at]').forEach((element) => {
    const label = formatTimeAgo(new Date(Number(element.dataset.createdAt)), now);
    if (element.textContent !== label) element.textContent = label;
  });
}
setInterval(updateTimestamps, 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) updateTimestamps();
});

function renderPostDetails(post) {
  const hasPhoto = Boolean(post.imageUrl);
  detailsPost.innerHTML = `
    <article class="card bg-body-tertiary border-0 rounded-3 overflow-hidden">
      <div class="card-header bg-transparent border-0 d-flex align-items-center gap-2 py-2">
        <div class="post-avatar"></div>
        <span class="fw-bold flex-grow-1 text-truncate">${escapeHtml(post.username)}</span>
        ${timeHtml(post.createdAt, 'small text-body-secondary')}
      </div>
      <div class="px-3 pb-2"><h2 class="h5 fw-bold mb-1">${escapeHtml(post.title)}</h2>${tagsHtml(post.tags)}</div>
      ${hasPhoto ? imageHtml(post, 'ratio-1x1') : ''}
      <div class="px-3 py-2">${actionsHtml(post)}</div>
      <div class="post-description-toggle px-3 pb-3" role="button" tabindex="0" aria-expanded="false">
        <div class="post-description-body small">${escapeHtml(post.description)}</div>
        <div class="post-description-hint small text-body-secondary mt-1">Show more</div>
      </div>
    </article>`;
  setupDescription(detailsPost.querySelector('.post-description-toggle'));
}

const DESCRIPTION_COLLAPSED_LINES = 3;
function setupDescription(toggle) {
  const body = toggle.querySelector('.post-description-body');
  const hint = toggle.querySelector('.post-description-hint');
  let expanded = false;
  const collapsedHeight = () => Math.round((parseFloat(getComputedStyle(body).lineHeight) || 20) * DESCRIPTION_COLLAPSED_LINES);
  const isExpandable = () => body.scrollHeight > collapsedHeight() + 2;
  function apply() {
    if (!isExpandable()) {
      body.style.height = 'auto';
      body.classList.remove('is-fading');
      toggle.classList.add('is-static');
      toggle.removeAttribute('role');
      toggle.removeAttribute('tabindex');
      hint.classList.add('d-none');
      return;
    }
    body.style.height = `${expanded ? body.scrollHeight : collapsedHeight()}px`;
    body.classList.toggle('is-fading', !expanded);
    hint.textContent = expanded ? 'Show less' : 'Show more';
    toggle.setAttribute('aria-expanded', String(expanded));
  }
  function flip() {
    if (!isExpandable()) return;
    expanded = !expanded;
    apply();
  }
  toggle.addEventListener('click', flip);
  toggle.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); flip(); }
  });
  toggle._reflow = apply;
  apply();
}
window.addEventListener('resize', () => {
  const toggle = detailsPost.querySelector('.post-description-toggle');
  if (toggle?._reflow) toggle._reflow();
});

function renderComment(comment) {
  const element = document.createElement('div');
  element.className = 'comment bg-body-secondary rounded-3 p-3';
  element.dataset.commentId = comment.id;
  element.innerHTML = `
    <div class="d-flex align-items-center gap-2 mb-1">
      <div class="post-avatar post-avatar-sm"></div>
      <span class="fw-bold small flex-grow-1 text-truncate">${escapeHtml(comment.username)}</span>
      ${timeHtml(comment.createdAt, 'small text-body-secondary')}
    </div>
    <p class="comment-text small mb-0">${escapeHtml(comment.text)}</p>`;
  return element;
}

function updateCommentsMeta(count) {
  commentsCount.textContent = String(count);
  commentsEmpty.classList.toggle('d-none', count > 0);
  commentsOverlayEmpty.classList.toggle('d-none', count > 0);
}

function renderComments(comments) {
  const elements = comments.map(renderComment);
  commentsList.replaceChildren(...elements.map((element) => element.cloneNode(true)));
  commentsOverlayList.replaceChildren(...elements);
  updateCommentsMeta(comments.length);
}

function listenToComments(postId) {
  if (stopCommentsListener) stopCommentsListener();
  commentsByPostId.set(postId, []);
  const commentsQuery = query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt', 'desc'));
  stopCommentsListener = onSnapshot(commentsQuery, (snapshot) => {
    const comments = snapshot.docs.map((commentSnapshot) => {
      const data = commentSnapshot.data();
      return {
        id: commentSnapshot.id,
        uid: data.uid,
        username: data.username || 'User',
        text: data.text || '',
        createdAt: asDate(data.createdAt)
      };
    });
    commentsByPostId.set(postId, comments);
    if (activePostId === postId) renderComments(comments);
  }, (error) => {
    console.error('Unable to load comments:', error);
    if (activePostId === postId) {
      commentsList.replaceChildren();
      commentsOverlayList.replaceChildren();
      updateCommentsMeta(0);
    }
  });
}

function resizeCommentBox() {
  commentTextarea.style.height = 'auto';
  const borders = commentTextarea.offsetHeight - commentTextarea.clientHeight;
  commentTextarea.style.height = `${commentTextarea.scrollHeight + borders}px`;
}
function syncCommentBox() {
  resizeCommentBox();
  commentSend.disabled = !commentTextarea.value.trim() || !auth.currentUser;
}

async function submitComment() {
  const user = auth.currentUser;
  const text = commentTextarea.value.trim();
  if (!user || !text || !activePostId) return;
  const postId = activePostId;
  commentSend.disabled = true;
  try {
    await addDoc(collection(db, 'posts', postId, 'comments'), {
      uid: user.uid,
      username: user.displayName || user.email || 'User',
      text,
      createdAt: serverTimestamp()
    });
    commentTextarea.value = '';
    syncCommentBox();
    commentsOverlayScroll.scrollTop = 0;
    // Always land back on the post details after commenting.
    closeCommentsOverlay();
  } catch (error) {
    console.error('Could not save comment:', error);
    alert('Your comment could not be saved. Please check your connection and try again.');
    syncCommentBox();
  }
}
commentTextarea.addEventListener('input', syncCommentBox);
commentSend.addEventListener('click', submitComment);
window.addEventListener('resize', () => {
  if (commentsOverlay.classList.contains('is-open')) resizeCommentBox();
});

function openCommentsOverlay(triggerElement) {
  if (!activePostId) return;
  commentsTrigger = triggerElement || null;
  overlay.inert = true;
  commentsOverlay.inert = false;
  commentsOverlay.setAttribute('aria-hidden', 'false');
  commentsOverlayScroll.scrollTop = 0;
  commentsOverlay.classList.add('is-open');
  resizeCommentBox();
  commentsBack.focus({ preventScroll: true });
}
function closeCommentsOverlay() {
  commentsOverlay.classList.remove('is-open');
  commentsOverlay.setAttribute('aria-hidden', 'true');
  commentsOverlay.inert = true;
  overlay.inert = false;
  if (commentsTrigger) commentsTrigger.focus({ preventScroll: true });
}
commentsBack.addEventListener('click', closeCommentsOverlay);

detailsPost.addEventListener('click', (event) => {
  const button = event.target.closest('.post-action');
  if (!button || !activePostId) return;
  if (button.matches('[data-like-button]')) toggleLike(activePostId);
  else if (button.matches('[data-share-button]')) sharePost(activePostId, button);
  else if (button.matches('[data-open-comments]')) openCommentsOverlay(button);
});
commentLaunchBar.addEventListener('click', (event) => {
  if (event.target.closest('.post-action')) return;
  openCommentsOverlay(commentLaunch);
});
commentLaunch.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    openCommentsOverlay(commentLaunch);
  }
});

function openPostDetails(postId, triggerElement) {
  const post = postsById.get(postId);
  if (!post) return;
  lastTrigger = triggerElement || null;
  activePostId = post.id;
  syncBookmarkUI();
  commentTextarea.value = '';
  syncCommentBox();
  renderPostDetails(post);
  renderComments(commentsByPostId.get(post.id) || []);
  listenToComments(post.id);
  detailsScroll.scrollTop = 0;
  updateTimestamps();
  overlay.inert = false;
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('post-details-open');
  overlay.classList.add('is-open');
  backButton.focus({ preventScroll: true });
}
function closePostDetails() {
  if (commentsOverlay.classList.contains('is-open')) closeCommentsOverlay();
  if (stopCommentsListener) stopCommentsListener();
  stopCommentsListener = null;
  activePostId = null;
  overlay.classList.remove('is-open');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.inert = true;
  document.body.classList.remove('post-details-open');
  if (lastTrigger) lastTrigger.focus({ preventScroll: true });
}
backButton.addEventListener('click', closePostDetails);
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (commentsOverlay.classList.contains('is-open')) closeCommentsOverlay();
  else if (overlay.classList.contains('is-open')) closePostDetails();
});

feed.addEventListener('click', (event) => {
  const card = event.target.closest('.post-card');
  if (!card) return;
  const button = event.target.closest('.post-action');
  if (button) {
    if (button.matches('[data-like-button]')) toggleLike(card.id);
    else if (button.matches('[data-share-button]')) sharePost(card.id, button);
    else if (button.matches('[data-bookmark-button]')) openFolderSheet(card.id, button);
    else if (button.matches('[data-open-comments]')) {
      // Open the post details first so closing the comments returns there.
      openPostDetails(card.id, card);
      openCommentsOverlay(commentLaunch);
    }
    return;
  }
  openPostDetails(card.id, card);
});
feed.addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.classList.contains('post-card')) {
    event.preventDefault();
    openPostDetails(event.target.id, event.target);
  }
});

// The bookmark in the post details header.
const detailsBookmark = document.getElementById('post-details-bookmark');
if (detailsBookmark) {
  detailsBookmark.addEventListener('click', () => {
    if (activePostId) openFolderSheet(activePostId, detailsBookmark);
  });
}
onSavedChange(syncBookmarkUI);

function notifyPostsChanged() {
  postsSubscribers.forEach((callback) => {
    try { callback(); } catch (error) { console.error(error); }
  });
}

// Used by the Saved page.
export function getPostById(postId) {
  return postsById.get(postId) || null;
}
export function openPostById(postId, trigger) {
  openPostDetails(postId, trigger);
}
export function onPostsChanged(callback) {
  postsSubscribers.add(callback);
  if (postsLoaded) callback();
  return () => postsSubscribers.delete(callback);
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    if (stopPostsListener) stopPostsListener();
    stopPostsListener = null;
    stopLikes();
    stopSavedListeners();
    showFeedMessage('Please sign in to view posts.');
    sentinel.classList.add('d-none');
    syncCommentBox();
    return;
  }
  const greetingName = document.getElementById('greeting-username');
  if (greetingName) greetingName.textContent = String(user.displayName || user.email || 'there').toUpperCase();
  syncCommentBox();
  startLikesListener(user.uid);
  startSavedListeners(user.uid);
  startPostsFeed();
});
