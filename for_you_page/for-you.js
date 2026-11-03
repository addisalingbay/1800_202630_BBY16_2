const feed = document.getElementById('post-feed');
const sentinel = document.getElementById('feed-sentinel');

const PLACEHOLDER_USERS = ['USERNAME_123', 'USERNAME_204', 'USERNAME_377', 'USERNAME_512', 'USERNAME_689', 'USERNAME_741'];
const PLACEHOLDER_TITLES = ['POST CAPTION', 'POST CAPTION', 'POST CAPTION'];
const PLACEHOLDER_DESCRIPTIONS = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nullam dignissim massa et metus commodo, vel dictum mauris viverra. Vivamus fermentum vel sapien eu accumsan. Quisque a ex sed orci fringilla feugiat vel vel quam.\n\nInterdum et malesuada fames ac ante ipsum primis in faucibus. Aenean sed ullamcorper dolor, ut interdum quam. Suspendisse at varius sem.',
  'Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Integer posuere erat a ante venenatis dapibus posuere velit aliquet. Donec ullamcorper nulla non metus auctor fringilla.\n\nCras mattis consectetur purus sit amet fermentum. Aenean lacinia bibendum nulla sed consectetur. Maecenas faucibus mollis interdum.',
  'Cras mattis consectetur purus sit amet fermentum. Aenean lacinia bibendum nulla sed consectetur. Nullam quis risus eget urna mollis ornare vel eu leo.',
  'Donec id elit non mi porta gravida at eget metus. Vestibulum id ligula porta felis euismod semper. Etiam porta sem malesuada magna mollis euismod. Maecenas sed diam eget risus varius blandit sit amet non magna.\n\nFusce dapibus, tellus ac cursus commodo, tortor mauris condimentum nibh, ut fermentum massa justo sit amet risus.'
];
const PLACEHOLDER_COMMENT_TEXTS = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. In rhoncus congue tincidunt. Vivamus fermentum vel sapien eu accumsan.',
  'Quisque a ex sed orci fringilla feugiat vel quam.',
  'Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas.',
  'Integer posuere erat a ante venenatis dapibus posuere velit aliquet.',
  'Cras mattis consectetur purus sit amet fermentum. Aenean lacinia bibendum nulla sed consectetur.',
  'Donec id elit non mi porta gravida at eget metus.',
  'Maecenas sed diam eget risus varius blandit sit amet non magna.'
];

let postCounter = 0;
const POSTS_PER_BATCH = 4;

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const minutesAgo = (m) => new Date(Date.now() - m * 60000);

const postsById = new Map();

function makePlaceholderPost() {
  postCounter += 1;
  const hasPhoto = Math.random() < 0.5;
  return {
    id: 'post-' + postCounter + '-' + Math.random().toString(36).slice(2, 7),
    username: pick(PLACEHOLDER_USERS),
    title: pick(PLACEHOLDER_TITLES),
    tags: ['Tag 1', 'Tag 1', 'Tag 1', 'Tag 1'],
    description: pick(PLACEHOLDER_DESCRIPTIONS),
    imageUrl: hasPhoto ? '' : null,

    createdAt: minutesAgo(pick([0, 1, 4, 12, 45, 95, 300, 1500, 4000]))
  };
}

function loadCommentsForPost(postId) {
  return PLACEHOLDER_COMMENT_TEXTS.map((text, i) => ({
    id: postId + '-comment-' + i,
    username: PLACEHOLDER_USERS[i % PLACEHOLDER_USERS.length],
    text,
    createdAt: minutesAgo((i + 1) * 7)
  }));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function formatTimeAgo(date, now = Date.now()) {
  const seconds = Math.floor((now - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : minutes + ' minutes ago';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : hours + ' hours ago';
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? '1 day ago' : days + ' days ago';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function timeHtml(date, extraClasses = '') {
  return `<time class="${extraClasses}" datetime="${date.toISOString()}" data-created-at="${date.getTime()}">${formatTimeAgo(date)}</time>`;
}

function tagsHtml(tags) {
  if (!tags || !tags.length) return '';
  return `<div class="d-flex flex-wrap gap-1">${tags.map((t) =>
    `<span class="badge rounded-pill text-bg-secondary fw-normal">${escapeHtml(t)}</span>`).join('')}</div>`;
}

function actionsHtml() {
  return `
    <div class="d-flex gap-3 fs-5">
      <button type="button" class="btn btn-link text-body p-0 lh-1 post-action" aria-label="Like"><i class="bi bi-heart"></i></button>
      <button type="button" class="btn btn-link text-body p-0 lh-1 post-action" aria-label="Comments"><i class="bi bi-chat-square-text"></i></button>
      <button type="button" class="btn btn-link text-body p-0 lh-1 post-action" aria-label="Share"><i class="bi bi-share"></i></button>
    </div>`;
}

function imageHtml(post, ratioClass) {
  const inner = post.imageUrl
    ? `<img src="${escapeHtml(post.imageUrl)}" alt="Post image" class="w-100 h-100">`
    : '';
  return `<div class="post-image ratio ${ratioClass} bg-secondary-subtle" ${post.imageUrl ? '' : 'role="img" aria-label="Post image placeholder"'}>${inner}</div>`;
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

  if (post.imageUrl === null) {

    card.innerHTML = `
      ${header}
      <div class="card-body pt-1 pb-2">
        ${preview}
        <div class="mt-2">${actionsHtml()}</div>
      </div>`;
  } else {

    card.innerHTML = `
      ${header}
      ${imageHtml(post, 'ratio-16x9')}
      <div class="card-body py-2">
        <div class="mb-1">${actionsHtml()}</div>
        ${preview}
      </div>`;
  }
  return card;
}

function loadPosts(count = POSTS_PER_BATCH) {
  for (let i = 0; i < count; i++) feed.appendChild(renderPost(makePlaceholderPost()));
}

const observer = new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting) {
    console.log('Loading more placeholder posts');
    loadPosts();
  }
}, { rootMargin: '300px' });

function updateTimestamps() {
  const now = Date.now();
  document.querySelectorAll('[data-created-at]').forEach((el) => {
    const text = formatTimeAgo(new Date(Number(el.dataset.createdAt)), now);
    if (el.textContent !== text) el.textContent = text;
  });
}

setInterval(updateTimestamps, 60 * 1000);

document.addEventListener('visibilitychange', () => { if (!document.hidden) updateTimestamps(); });

const overlay = document.getElementById('post-details');
const backButton = document.getElementById('post-details-back');
const detailsScroll = document.getElementById('post-details-scroll');
const detailsPost = document.getElementById('post-details-post');
const commentsList = document.getElementById('comments-list');
const commentsCount = document.getElementById('comments-count');
const commentsEmpty = document.getElementById('comments-empty');

let lastTrigger = null;

function renderPostDetails(post) {
  const hasPhoto = post.imageUrl !== null;

  detailsPost.innerHTML = `
    <article class="card bg-body-tertiary border-0 rounded-3 overflow-hidden">
      <div class="card-header bg-transparent border-0 d-flex align-items-center gap-2 py-2">
        <div class="post-avatar"></div>
        <span class="fw-bold flex-grow-1 text-truncate">${escapeHtml(post.username)}</span>
        ${timeHtml(post.createdAt, 'small text-body-secondary')}
      </div>
      <div class="px-3 pb-2">
        <h2 class="h5 fw-bold mb-1">${escapeHtml(post.title)}</h2>
        ${tagsHtml(post.tags)}
      </div>
      ${hasPhoto ? imageHtml(post, 'ratio-1x1') : ''}
      <div class="px-3 py-2">${actionsHtml()}</div>
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

  const collapsedHeight = () => {
    const lineHeight = parseFloat(getComputedStyle(body).lineHeight) || 20;
    return Math.round(lineHeight * DESCRIPTION_COLLAPSED_LINES);
  };
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
    body.style.height = (expanded ? body.scrollHeight : collapsedHeight()) + 'px';
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
  toggle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); }
  });
  toggle._reflow = apply;
  apply();
}

window.addEventListener('resize', () => {
  const toggle = detailsPost.querySelector('.post-description-toggle');
  if (toggle && toggle._reflow) toggle._reflow();
});

function renderComment(comment) {
  const el = document.createElement('div');
  el.className = 'comment bg-body-secondary rounded-3 p-3';
  el.id = comment.id;
  el.innerHTML = `
    <div class="d-flex align-items-center gap-2 mb-1">
      <div class="post-avatar post-avatar-sm"></div>
      <span class="fw-bold small flex-grow-1 text-truncate">${escapeHtml(comment.username)}</span>
      ${timeHtml(comment.createdAt, 'small text-body-secondary')}
      <button type="button" class="btn btn-link text-body p-0 fs-6 lh-1 post-action" aria-label="Like comment"><i class="bi bi-heart"></i></button>
    </div>
    <p class="small mb-0">${escapeHtml(comment.text)}</p>`;
  return el;
}

function updateCommentsMeta() {
  const count = commentsList.children.length;
  commentsCount.textContent = count;
  commentsEmpty.classList.toggle('d-none', count > 0);
}

function renderComments(comments) {
  commentsList.replaceChildren();
  [...comments]
    .sort((a, b) => b.createdAt - a.createdAt)
    .forEach((c) => commentsList.appendChild(renderComment(c)));
  updateCommentsMeta();
}

function addComment(comment) {
  commentsList.prepend(renderComment(comment));
  updateCommentsMeta();
}

function openPostDetails(postId, triggerEl) {
  const post = postsById.get(postId);
  if (!post) return;

  lastTrigger = triggerEl || null;
  renderPostDetails(post);
  renderComments(loadCommentsForPost(post.id));
  detailsScroll.scrollTop = 0;
  updateTimestamps();

  overlay.inert = false;
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('post-details-open');
  overlay.classList.add('is-open');
  backButton.focus({ preventScroll: true });
}

function closePostDetails() {
  overlay.classList.remove('is-open');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.inert = true;
  document.body.classList.remove('post-details-open');
  if (lastTrigger) lastTrigger.focus({ preventScroll: true });
}

backButton.addEventListener('click', closePostDetails);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && overlay.classList.contains('is-open')) closePostDetails();
});

feed.addEventListener('click', (e) => {
  if (e.target.closest('.post-action')) return;
  const card = e.target.closest('.post-card');
  if (card) openPostDetails(card.id, card);
});
feed.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('post-card')) {
    e.preventDefault();
    openPostDetails(e.target.id, e.target);
  }
});

loadPosts(5);
observer.observe(sentinel);
