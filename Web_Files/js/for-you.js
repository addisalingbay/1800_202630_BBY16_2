import { auth, db } from './firebaseConfig.js';
import { isSaved, onSavedChange, openFolderSheet, startSavedListeners, stopSavedListeners } from './saved.js';
import { defaultFilters, filterAndSortPosts, initFilters } from './filters.js';
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
  where,
  writeBatch
} from 'firebase/firestore';

const feed = document.getElementById('post-feed');
const sentinel = document.getElementById('feed-sentinel');

const postsById = new Map();
let allPosts = [];                    // every post from Firestore, newest first
let currentFilters = defaultFilters(); // what the Filters panel last applied
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
// NOTE: the "like" data is now the EYE ("I have seen / experienced this"):
// users/{uid}/likedPosts/{postId} is the user's marker and posts/{postId}.likeCount is the number next to the eye.

// Scam votes (the popup that opens when the eye is long pressed): the signed-in
// user's own vote on each post, live from users/{uid}/scamVotes.
const myScamVotes = new Map();        // postId -> 'scam' | 'notScam'
const pendingScamVotes = new Set();
let stopScamVotesListener = null;
let scamPopupPostId = null;           // the post whose popup is open

// Comment thumbs: the user's own reaction on each comment of the open post.
const myCommentVotes = new Map();     // commentId -> 'up' | 'down'
const pendingCommentVotes = new Set();
let stopCommentVotesListener = null;

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

// ---------------------------------------------------------------------
// Actions row: eye (+ count), comments (+ count), share
// ---------------------------------------------------------------------
// Share of people who voted "scam" and "not a scam" (the two always add up to 100).
function scamPercentages(post) {
  const total = post.scamCount + post.notScamCount;
  if (!total) return { scam: 0, notScam: 0 };
  const scam = Math.round((post.scamCount / total) * 100);
  return { scam, notScam: 100 - scam };
}

// The small bubble that opens on a long press of the eye (no animation).
function scamPopupHtml(post) {
  const mine = myScamVotes.get(post.id) || null;
  const { scam, notScam } = scamPercentages(post);
  const voteButton = (vote, icon, percent, count, label) => `
    <button type="button" class="scam-vote btn btn-link ${mine === vote ? 'is-chosen' : ''}" data-scam-vote="${vote}" aria-pressed="${mine === vote}" aria-label="${label}: ${percent}% (${count} ${count === 1 ? 'vote' : 'votes'})" title="${label}: ${count} ${count === 1 ? 'vote' : 'votes'}"><span class="png-icon ${icon}" aria-hidden="true"></span><span>${percent}%</span></button>`;
  return `
    <div class="scam-popup position-absolute bottom-100 start-0 d-flex align-items-center gap-2" role="group" aria-label="What do people think of this post?" data-scam-popup>
      ${voteButton('scam', 'icon-warning', scam, post.scamCount, 'Scam')}
      ${voteButton('notScam', 'icon-close', notScam, post.notScamCount, 'Not a scam')}
    </div>`;
}

function actionsHtml(post) {
  const seen = likedPostIds.has(post.id);
  return `
    <div class="d-flex align-items-center gap-3 fs-5" data-post-id="${escapeHtml(post.id)}">
      <span class="position-relative d-inline-flex align-items-center gap-1" data-eye-wrap>
        <button type="button" class="eye-button btn btn-link p-0 lh-1 post-action ${seen ? 'seen-active' : 'text-body'}" data-eye-button aria-label="${seen ? 'You have seen this. Tap to undo.' : 'I have seen this.'} Hold to see what people think." aria-pressed="${seen}" aria-haspopup="true"><span class="png-icon icon-eyes" aria-hidden="true"></span></button>
        ${scamPopupPostId === post.id ? scamPopupHtml(post) : ''}
        <span class="eye-count small" data-eye-count>${post.likeCount}</span>
      </span>
      <span class="d-inline-flex align-items-center gap-1">
        <button type="button" class="btn btn-link text-body p-0 lh-1 post-action" data-open-comments aria-label="Comments"><i class="bi bi-chat-square-text"></i></button>
        <span class="comment-count small" data-comment-count>${post.commentCount}</span>
      </span>
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
    likeCount: Math.max(0, Number(data.likeCount) || 0),   // people who have seen / experienced it (the eye)
    commentCount: Math.max(0, Number(data.commentCount) || 0),
    scamCount: Math.max(0, Number(data.scamCount) || 0),
    notScamCount: Math.max(0, Number(data.notScamCount) || 0),
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

// Draws the feed from allPosts using the applied filters.
// Default (no filters) = every post, latest first.
function renderFeed() {
  if (!allPosts.length) {
    showFeedMessage('no posts yet');
    return;
  }
  const visiblePosts = filterAndSortPosts(allPosts, currentFilters);
  if (!visiblePosts.length) {
    showFeedMessage('No posts match your filters.');
    return;
  }
  const fragment = document.createDocumentFragment();
  visiblePosts.forEach((post) => fragment.appendChild(renderPost(post)));
  feed.replaceChildren(fragment);
}

function handleFiltersApplied(filters) {
  currentFilters = filters;
  renderFeed();
  window.scrollTo({ top: 0 });
}

function startPostsFeed() {
  if (stopPostsListener) stopPostsListener();
  const postsQuery = query(collection(db, 'posts'), orderBy('createdAt', 'desc'));
  stopPostsListener = onSnapshot(postsQuery, (snapshot) => {
    // postsById keeps EVERY post (the Saved page and share links need them
    // even when a filter hides them from the feed).
    postsById.clear();
    allPosts = snapshot.docs.map(normalizePost);
    allPosts.forEach((post) => postsById.set(post.id, post));

    renderFeed();
    sentinel.classList.add('d-none');

    // Keep the open details view synchronized if the active post changes.
    if (activePostId && postsById.has(activePostId)) {
      renderPostDetails(postsById.get(activePostId));
    }

    postsLoaded = true;
    notifyPostsChanged();
    if (allPosts.length) openDeepLinkedPost();
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
// Updates every actions row on screen (feed cards and the post details):
// the eye, its count, the comment count and the popup.
function syncEyeUI() {
  document.querySelectorAll('[data-post-id]').forEach((group) => {
    const post = postsById.get(group.dataset.postId);
    const button = group.querySelector('[data-eye-button]');
    if (!post || !button) return;               // (the Saved page also uses data-post-id on its tiles)
    const seen = likedPostIds.has(post.id);
    button.classList.toggle('seen-active', seen);
    button.classList.toggle('text-body', !seen);
    button.setAttribute('aria-pressed', String(seen));
    button.setAttribute('aria-label', `${seen ? 'You have seen this. Tap to undo.' : 'I have seen this.'} Hold to see what people think.`);
    group.querySelector('[data-eye-count]').textContent = String(post.likeCount);
    group.querySelector('[data-comment-count]').textContent = String(post.commentCount);

    const open = scamPopupPostId === post.id;
    const popup = group.querySelector('[data-scam-popup]');
    if (!open) {
      if (popup) popup.remove();
    } else if (popup) {
      popup.outerHTML = scamPopupHtml(post);
    } else {
      button.insertAdjacentHTML('afterend', scamPopupHtml(post));
    }
  });
}

// "I have seen / experienced this": one tap on, tap again to take it back.
async function toggleEye(postId) {
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
    console.error('Could not update the eye:', error);
    alert('That could not be saved. Please check your connection and try again.');
  } finally {
    pendingLikes.delete(postId);
    syncEyeUI();
  }
}

// ---------------------------------------------------------------------
// Scam / not scam votes (long press on the eye)
// ---------------------------------------------------------------------
// users/{uid}/scamVotes/{postId} -> { postId, vote, votedAt }   one vote per user per post
// posts/{postId}.scamCount / .notScamCount                      the two counters
// The marker and the counters change together in one atomic batch.
function startScamVotesListener(uid) {
  if (stopScamVotesListener) stopScamVotesListener();
  stopScamVotesListener = onSnapshot(collection(db, 'users', uid, 'scamVotes'), (snapshot) => {
    myScamVotes.clear();
    snapshot.docs.forEach((voteSnapshot) => {
      const { vote } = voteSnapshot.data();
      if (vote === 'scam' || vote === 'notScam') myScamVotes.set(voteSnapshot.id, vote);
    });
    syncEyeUI();
  }, (error) => {
    console.error('Unable to load your scam votes:', error);
  });
}

function stopScamVotes() {
  if (stopScamVotesListener) stopScamVotesListener();
  stopScamVotesListener = null;
  myScamVotes.clear();
  scamPopupPostId = null;
  syncEyeUI();
}

function openScamPopup(postId) {
  if (scamPopupPostId === postId) return;
  scamPopupPostId = postId;
  syncEyeUI();
}

function closeScamPopup() {
  if (!scamPopupPostId) return;
  scamPopupPostId = null;
  syncEyeUI();
}

async function castScamVote(postId, vote) {
  const user = auth.currentUser;
  if (!user || !postsById.has(postId) || pendingScamVotes.has(postId)) return;
  pendingScamVotes.add(postId);

  const previous = myScamVotes.get(postId) || null;
  const postRef = doc(db, 'posts', postId);
  const markerRef = doc(db, 'users', user.uid, 'scamVotes', postId);
  const counter = (choice) => (choice === 'scam' ? 'scamCount' : 'notScamCount');
  const batch = writeBatch(db);
  if (previous === vote) {                       // tapping the same choice again takes the vote back
    batch.delete(markerRef);
    batch.update(postRef, { [counter(vote)]: increment(-1) });
  } else if (previous) {                         // switching sides
    batch.set(markerRef, { postId, vote, votedAt: serverTimestamp() });
    batch.update(postRef, { [counter(previous)]: increment(-1), [counter(vote)]: increment(1) });
  } else {                                       // a first vote
    batch.set(markerRef, { postId, vote, votedAt: serverTimestamp() });
    batch.update(postRef, { [counter(vote)]: increment(1) });
  }

  try {
    await batch.commit();
  } catch (error) {
    console.error('Could not save your vote:', error);
    alert('Your vote could not be saved. Please check your connection and try again.');
  } finally {
    pendingScamVotes.delete(postId);
    syncEyeUI();
  }
}

function startLikesListener(uid) {
  if (stopLikesListener) stopLikesListener();
  stopLikesListener = onSnapshot(collection(db, 'users', uid, 'likedPosts'), (snapshot) => {
    likedPostIds.clear();
    snapshot.docs.forEach((likeSnapshot) => likedPostIds.add(likeSnapshot.id));
    syncEyeUI();
  }, (error) => {
    console.error('Unable to load liked posts:', error);
  });
}

function stopLikes() {
  if (stopLikesListener) stopLikesListener();
  stopLikesListener = null;
  likedPostIds.clear();
  syncEyeUI();
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
  const mine = myCommentVotes.get(comment.id) || null;
  const thumb = (vote, icon, count, label) => `
    <span class="d-inline-flex align-items-center gap-1">
      <button type="button" class="comment-vote btn btn-link p-0 lh-1 ${mine === vote ? 'vote-active' : 'text-body'}" data-comment-vote="${vote}" aria-pressed="${mine === vote}" aria-label="${label}"><i class="bi ${mine === vote ? `${icon}-fill` : icon}"></i></button>
      <span class="small">${count}</span>
    </span>`;
  const element = document.createElement('div');
  element.className = 'comment bg-body-secondary rounded-3 p-3';
  element.dataset.commentId = comment.id;
  element.innerHTML = `
    <div class="d-flex align-items-center gap-2 mb-1">
      <div class="post-avatar post-avatar-sm"></div>
      <div class="flex-grow-1 min-w-0">
        <div class="fw-bold small text-truncate">${escapeHtml(comment.username)}</div>
        ${timeHtml(comment.createdAt, 'small text-body-secondary')}
      </div>
      <div class="comment-votes d-flex align-items-center gap-3 fs-5">
        ${thumb('up', 'bi-hand-thumbs-up', comment.upCount, 'Thumbs up')}
        ${thumb('down', 'bi-hand-thumbs-down', comment.downCount, 'Thumbs down')}
      </div>
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

  // The user's own thumbs on this post's comments (only this post's, not all of them).
  if (stopCommentVotesListener) stopCommentVotesListener();
  stopCommentVotesListener = null;
  myCommentVotes.clear();
  if (auth.currentUser) {
    const votesQuery = query(collection(db, 'users', auth.currentUser.uid, 'commentVotes'), where('postId', '==', postId));
    stopCommentVotesListener = onSnapshot(votesQuery, (snapshot) => {
      myCommentVotes.clear();
      snapshot.docs.forEach((voteSnapshot) => {
        const { commentId, vote } = voteSnapshot.data();
        if (vote === 'up' || vote === 'down') myCommentVotes.set(commentId, vote);
      });
      if (activePostId === postId) renderComments(commentsByPostId.get(postId) || []);
    }, (error) => {
      console.error('Unable to load your comment votes:', error);
    });
  }
  const commentsQuery = query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt', 'desc'));
  stopCommentsListener = onSnapshot(commentsQuery, (snapshot) => {
    const comments = snapshot.docs.map((commentSnapshot) => {
      const data = commentSnapshot.data();
      return {
        id: commentSnapshot.id,
        uid: data.uid,
        username: data.username || 'User',
        text: data.text || '',
        upCount: Math.max(0, Number(data.upCount) || 0),
        downCount: Math.max(0, Number(data.downCount) || 0),
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
    // The comment and the post's comment counter are saved together.
    const commentRef = doc(collection(db, 'posts', postId, 'comments'));   // Firebase makes the ID
    const batch = writeBatch(db);
    batch.set(commentRef, {
      uid: user.uid,
      username: user.displayName || user.email || 'User',
      text,
      createdAt: serverTimestamp()
    });
    batch.update(doc(db, 'posts', postId), { commentCount: increment(1), lastCommentId: commentRef.id });
    await batch.commit();
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
// ---------------------------------------------------------------------
// Comment thumbs up / down
// ---------------------------------------------------------------------
// users/{uid}/commentVotes/{postId}_{commentId} -> { postId, commentId, vote, votedAt }
// posts/{postId}/comments/{commentId}.upCount / .downCount
// One reaction per user per comment, changed together with the counters in one batch.
async function castCommentVote(commentId, vote) {
  const user = auth.currentUser;
  const postId = activePostId;
  if (!user || !postId || pendingCommentVotes.has(commentId)) return;
  pendingCommentVotes.add(commentId);

  const previous = myCommentVotes.get(commentId) || null;
  const commentRef = doc(db, 'posts', postId, 'comments', commentId);
  const markerRef = doc(db, 'users', user.uid, 'commentVotes', `${postId}_${commentId}`);
  const counter = (choice) => (choice === 'up' ? 'upCount' : 'downCount');
  const batch = writeBatch(db);
  if (previous === vote) {                       // the same thumb again takes it back
    batch.delete(markerRef);
    batch.update(commentRef, { [counter(vote)]: increment(-1) });
  } else if (previous) {                         // switching thumbs
    batch.set(markerRef, { postId, commentId, vote, votedAt: serverTimestamp() });
    batch.update(commentRef, { [counter(previous)]: increment(-1), [counter(vote)]: increment(1) });
  } else {                                       // a first reaction
    batch.set(markerRef, { postId, commentId, vote, votedAt: serverTimestamp() });
    batch.update(commentRef, { [counter(vote)]: increment(1) });
  }

  try {
    await batch.commit();
  } catch (error) {
    console.error('Could not save your reaction:', error);
    alert('Your reaction could not be saved. Please check your connection and try again.');
  } finally {
    pendingCommentVotes.delete(commentId);
  }
}

// One listener per list (the comments are redrawn often, so the click is delegated).
[commentsList, commentsOverlayList].forEach((list) => {
  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-comment-vote]');
    const comment = button && button.closest('.comment');
    if (comment) castCommentVote(comment.dataset.commentId, button.dataset.commentVote);
  });
});

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
  const scamVote = event.target.closest('[data-scam-vote]');
  if (scamVote) {
    if (activePostId) castScamVote(activePostId, scamVote.dataset.scamVote);
    return;
  }
  if (event.target.closest('[data-scam-popup]')) return;
  const button = event.target.closest('.post-action');
  if (!button || !activePostId) return;
  if (button.matches('[data-eye-button]')) handleEyeClick(activePostId);
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
  closeScamPopup();
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
  if (stopCommentVotesListener) stopCommentVotesListener();
  stopCommentVotesListener = null;
  myCommentVotes.clear();
  closeScamPopup();
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
  const scamVote = event.target.closest('[data-scam-vote]');
  if (scamVote) {                                    // a choice in the scam / not scam popup
    castScamVote(card.id, scamVote.dataset.scamVote);
    return;
  }
  if (event.target.closest('[data-scam-popup]')) return;   // the popup itself never opens the post
  const button = event.target.closest('.post-action');
  if (button) {
    if (button.matches('[data-eye-button]')) handleEyeClick(card.id);
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

// ---------------------------------------------------------------------
// Long press on the eye opens the scam / not scam popup
// ---------------------------------------------------------------------
const LONG_PRESS_MS = 500;
let pressTimer = null;
let longPressHappened = false;

function startLongPress(event) {
  const eye = event.target.closest('[data-eye-button]');
  if (!eye || (event.pointerType === 'mouse' && event.button !== 0)) return;
  const group = eye.closest('[data-post-id]');
  if (!group) return;
  longPressHappened = false;
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => {
    longPressHappened = true;                // the click that follows this press must not count as a tap
    openScamPopup(group.dataset.postId);
  }, LONG_PRESS_MS);
}

function cancelLongPress() {
  clearTimeout(pressTimer);
}

// A normal tap on the eye. (Ignored when the press was a long press.)
function handleEyeClick(postId) {
  if (longPressHappened) {
    longPressHappened = false;
    return;
  }
  closeScamPopup();
  toggleEye(postId);
}

[feed, detailsPost].forEach((area) => {
  area.addEventListener('pointerdown', startLongPress);
  area.addEventListener('pointerup', cancelLongPress);
  area.addEventListener('pointercancel', cancelLongPress);
  area.addEventListener('pointerout', (event) => {
    if (event.target.closest('[data-eye-button]')) cancelLongPress();   // moved away: not a long press
  });
  // Phones show a menu on a long press; the eye must not.
  area.addEventListener('contextmenu', (event) => {
    if (event.target.closest('[data-eye-button]')) event.preventDefault();
  });
  // Keyboard users: Shift + Enter, the Menu key or Arrow Up on the eye opens the popup.
  area.addEventListener('keydown', (event) => {
    const eye = event.target.closest('[data-eye-button]');
    if (!eye) return;
    const opensPopup = event.key === 'ContextMenu' || event.key === 'ArrowUp' || (event.key === 'Enter' && event.shiftKey);
    if (!opensPopup) return;
    event.preventDefault();
    event.stopPropagation();
    const group = eye.closest('[data-post-id]');
    if (group) openScamPopup(group.dataset.postId);
  });
});

// Tapping anywhere else closes the popup.
document.addEventListener('pointerdown', (event) => {
  if (!scamPopupPostId) return;
  if (event.target.closest('[data-scam-popup]') || event.target.closest('[data-eye-button]')) return;
  closeScamPopup();
});

// Esc closes the popup first (before it can close the post behind it).
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !scamPopupPostId) return;
  event.stopImmediatePropagation();
  closeScamPopup();
}, true);

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
    stopScamVotes();
    stopSavedListeners();
    showFeedMessage('Please sign in to view posts.');
    sentinel.classList.add('d-none');
    syncCommentBox();
    return;
  }
  const greetingName = document.getElementById('greeting-username');
  const greetingDiv = document.getElementById(`greeting`)
  if (greetingName) greetingName.textContent = String(user.displayName || user.email || 'there').toUpperCase();
  // Add the filter button once (this callback can run more than once).
  if (!document.getElementById('filter-open') && window.location.pathname.split("/").pop() === 'for-you.html') {
    greetingDiv.insertAdjacentHTML(`beforeend`, `<button type="button" id="filter-open" class="filter-open-button" aria-label="Open filters" aria-haspopup="dialog"><img src="../../images/filter.png" width="45px" alt=""></button>`);
    initFilters(document.getElementById('filter-open'), handleFiltersApplied);
  } // filter now doesnt show up in the saved page
  
  syncCommentBox();
  startLikesListener(user.uid);
  startScamVotesListener(user.uid);
  startSavedListeners(user.uid);
  startPostsFeed();
});