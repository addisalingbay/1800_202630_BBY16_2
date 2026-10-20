
const feed = document.getElementById('post-feed');
const sentinel = document.getElementById('feed-sentinel');
const overlayImage = document.getElementById('overlay-image');

const PLACEHOLDER_USERS = ['USERNAME_123', 'USERNAME_204', 'USERNAME_377', 'USERNAME_512', 'USERNAME_689', 'USERNAME_741'];
const PLACEHOLDER_CAPTIONS = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nullam dignissim massa et metus commodo, vel dictum mauris viverra...',
  'Vivamus fermentum vel sapien eu accumsan. Quisque a ex sed orci fringilla feugiat vel vel quam...',
  'Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas...',
  'Integer posuere erat a ante venenatis dapibus posuere velit aliquet. Donec ullamcorper nulla non metus...',
  'Cras mattis consectetur purus sit amet fermentum. Aenean lacinia bibendum nulla sed consectetur...'
];

let postCounter = 0;
const POSTS_PER_BATCH = 4;

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function makePlaceholderPost() {
  postCounter += 1;
  return {
    id: 'post-' + postCounter + '-' + Math.random().toString(36).slice(2, 7),
    username: pick(PLACEHOLDER_USERS),
    caption: pick(PLACEHOLDER_CAPTIONS)
  };
}

function renderPost(post) {
  const card = document.createElement('article');
  card.className = 'post-card card bg-body-tertiary border-0 rounded-3 overflow-hidden mb-3';
  card.id = post.id;
  card.dataset.postId = post.id;

  card.innerHTML = `
    <div class="post-header card-header bg-transparent border-0 d-flex align-items-center gap-2 py-2">
      <div class="post-avatar"></div>
      <span class="fw-bold flex-grow-1">${post.username}</span>
      <button type="button" class="save-btn btn btn-link p-0 fs-4" aria-label="Save post">
        <i class="bi bi-bookmark"></i>
      </button>
    </div>

    <!-- Click image or caption => open overlay (Bootstrap offcanvas data attributes) -->
    <div class="post-image ratio ratio-1x1 bg-secondary-subtle"
         data-bs-toggle="offcanvas" data-bs-target="#post-overlay" role="button" aria-label="Open post"></div>

    <div class="card-body py-2">
      <div class="post-actions d-flex gap-3 fs-5 mb-1">
        <button type="button" class="like-btn btn btn-link p-0" aria-label="Like"><i class="bi bi-heart"></i></button>
        <button type="button" class="comment-btn btn btn-link p-0" aria-label="Comment"><i class="bi bi-chat-square-text"></i></button>
        <button type="button" class="share-btn btn btn-link p-0" aria-label="Share"><i class="bi bi-share"></i></button>
      </div>
      <p class="post-caption small mb-0" data-bs-toggle="offcanvas" data-bs-target="#post-overlay">${post.caption}</p>
    </div>`;
  return card;
}

function loadPosts(count = POSTS_PER_BATCH) {
  for (let i = 0; i < count; i++) feed.appendChild(renderPost(makePlaceholderPost()));
}

const observer = new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting) {
    console.log('Sentinel visible: loading more placeholder posts');
    loadPosts();
  }
}, { rootMargin: '300px' });

loadPosts(5);
observer.observe(sentinel);

feed.addEventListener('click', (e) => {
  const card = e.target.closest('.post-card');
  if (!card) return;
  const id = card.dataset.postId;

  if (e.target.closest('.like-btn')) console.log('Like clicked:', id);
  else if (e.target.closest('.comment-btn')) console.log('Comment clicked:', id);
  else if (e.target.closest('.share-btn')) console.log('Share clicked:', id);
  else if (e.target.closest('.save-btn')) console.log('Save clicked:', id);
  else if (e.target.closest('.post-image, .post-caption')) {
    console.log('Post opened:', id);
    overlayImage.dataset.postId = id;
  }
});

document.getElementById('search-btn').addEventListener('click', () => console.log('Search clicked'));
document.getElementById('notification-btn').addEventListener('click', () => console.log('Notification clicked (navigating to notifications.html)'));
document.getElementById('overlay-back-btn').addEventListener('click', () => console.log('Overlay back clicked'));

document.querySelectorAll('#bottom-nav .nav-link').forEach((link) => {
  link.addEventListener('click', () => console.log('Navbar clicked:', link.id, '->', link.getAttribute('href')));
});

const overlayEl = document.getElementById('post-overlay');
overlayEl.addEventListener('shown.bs.offcanvas', () => console.log('Overlay opened'));
overlayEl.addEventListener('hidden.bs.offcanvas', () => console.log('Overlay closed'));
