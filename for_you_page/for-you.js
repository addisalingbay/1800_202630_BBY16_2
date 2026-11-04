import { auth, db } from '../Web_Files/js/firebaseConfig.js';
import { onAuthStateChanged } from 'firebase/auth';
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp
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

function actionsHtml(opensComments = false) {
  return `
    <div class="d-flex gap-3 fs-5">
      <button type="button" class="btn btn-link text-body p-0 lh-1 post-action" aria-label="Like"><i class="bi bi-heart"></i></button>
      <button type="button" class="btn btn-link text-body p-0 lh-1 post-action" aria-label="Comments"${opensComments ? ' data-open-comments' : ''}><i class="bi bi-chat-square-text"></i></button>
      <button type="button" class="btn btn-link text-body p-0 lh-1 post-action" aria-label="Share"><i class="bi bi-share"></i></button>
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
      <button type="button" class="btn btn-link text-body p-0 fs-4 lh-1 post-action" aria-label="Bookmark post"><i class="bi bi-bookmark"></i></button>
    </div>
    <div class="px-3 pb-2">
      <h2 class="h5 fw-bold mb-1">${escapeHtml(post.title)}</h2>
      ${tagsHtml(post.tags)}
    </div>`;
  const preview = `<p class="post-preview small mb-0">${escapeHtml(post.description)}</p>`;

  if (!post.imageUrl) {
    card.innerHTML = `${header}<div class="card-body pt-1 pb-2">${preview}<div class="mt-2">${actionsHtml()}</div></div>`;
  } else {
    card.innerHTML = `${header}${imageHtml(post, 'ratio-16x9')}<div class="card-body py-2"><div class="mb-1">${actionsHtml()}</div>${preview}</div>`;
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
  }, (error) => {
    console.error('Unable to load posts from Firestore:', error);
    showFeedMessage('Unable to load posts. Please refresh and try again.');
    sentinel.classList.add('d-none');
  });
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
      <div class="px-3 py-2">${actionsHtml(true)}</div>
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
    commentsOverlayScroll.scrollTo({ top: 0, behavior: 'smooth' });
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
  const trigger = event.target.closest('[data-open-comments]');
  if (trigger) openCommentsOverlay(trigger);
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
  if (event.target.closest('.post-action')) return;
  const card = event.target.closest('.post-card');
  if (card) openPostDetails(card.id, card);
});
feed.addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.classList.contains('post-card')) {
    event.preventDefault();
    openPostDetails(event.target.id, event.target);
  }
});

onAuthStateChanged(auth, (user) => {
  if (!user) {
    if (stopPostsListener) stopPostsListener();
    stopPostsListener = null;
    showFeedMessage('Please sign in to view posts.');
    sentinel.classList.add('d-none');
    syncCommentBox();
    return;
  }
  const greetingName = document.getElementById('greeting-username');
  if (greetingName) greetingName.textContent = user.displayName || user.email || 'there';
  syncCommentBox();
  startPostsFeed();
});
