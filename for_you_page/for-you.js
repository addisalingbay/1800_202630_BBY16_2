
const feed = document.getElementById('post-feed');
const sentinel = document.getElementById('feed-sentinel');

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

  card.innerHTML = `
    <div class="card-header bg-transparent border-0 d-flex align-items-center gap-2 py-2">
      <div class="post-avatar"></div>
      <span class="fw-bold flex-grow-1">${post.username}</span>
      <i class="bi bi-bookmark fs-4"></i>
    </div>
    <div class="post-image ratio ratio-1x1 bg-secondary-subtle" role="img" aria-label="Post image placeholder"></div>
    <div class="card-body py-2">
      <div class="d-flex gap-3 fs-5 mb-1">
        <i class="bi bi-heart"></i>
        <i class="bi bi-chat-square-text"></i>
        <i class="bi bi-share"></i>
      </div>
      <p class="post-caption small mb-0">${post.caption}</p>
    </div>`;
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

loadPosts(5);
observer.observe(sentinel);
