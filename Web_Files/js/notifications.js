import { db } from './firebaseConfig.js';
import {
  collection,
  onSnapshot,
  orderBy,
  query
} from 'firebase/firestore';

// ---------------------------------------------------------------------
// The bell in the homepage top bar opens the notifications overlay.
// The overlay is notificationPage.html inside #notificationsFrame, so it keeps
// its original look. The bell does what the old "Open Notifications" button did.
// ---------------------------------------------------------------------
const bell = document.getElementById('notificationsButton');
const frame = document.getElementById('notificationsFrame');

let openWhenLoaded = false;
let hideTimer = null;

function opener() {
  const frameWindow = frame.contentWindow;
  return frameWindow && typeof frameWindow.openNotifications === 'function' ? frameWindow : null;
}

function reveal(frameWindow) {
  frame.hidden = false;
  bell.setAttribute('aria-expanded', 'true');
  frameWindow.openNotifications();
}

if (bell && frame) {
  bell.addEventListener('click', () => {
    clearTimeout(hideTimer);
    const frameWindow = opener();
    if (frameWindow) reveal(frameWindow);
    else openWhenLoaded = true; // the page is still loading; open it as soon as it is ready
  });

  frame.addEventListener('load', () => {
    if (!openWhenLoaded) return;
    openWhenLoaded = false;
    const frameWindow = opener();
    if (frameWindow) reveal(frameWindow);
    else console.error('notificationPage.html did not load, so notifications cannot be opened.');
  });

  // notificationPage.html reports when its drawer closes (X, Esc, ...).
  window.addEventListener('message', (event) => {
    if (event.source !== frame.contentWindow) return;
    if (!event.data || event.data.type !== 'notifications-closed') return;
    bell.setAttribute('aria-expanded', 'false');
    clearTimeout(hideTimer);
    // Wait for the drawer's closing animation before hiding the frame.
    hideTimer = setTimeout(() => {
      frame.hidden = true;
      bell.focus();
    }, 450);
  });
}

//New Stuff from here down:

const notificationList = document.getElementById('notification-list');
const emptyMessage = document.getElementById('notifications-empty');
const clearButton = document.getElementById('clear-notifications');

let stopNotificationsListener = null;

// Display one post as a notification.
function renderNotification(postSnapshot, prepend = true) {
  const post = postSnapshot.data();
  const postId = postSnapshot.id;

  const notification = document.createElement('div');
  notification.className = 'alert theme-success mb-3 notification';
  notification.dataset.postId = postId;

  const heading = document.createElement('h4');
  heading.className = 'alert-heading mb-2';
  heading.textContent = post.title || 'New post';

  const author = document.createElement('p');
  author.textContent = `Posted by ${post.username || 'User'}`;

  const description = document.createElement('p');
  description.textContent = post.description || '';

  const link = document.createElement('a');
  link.href = `homePage.html?post=${encodeURIComponent(postId)}`;
  link.className = 'alert-link';
  link.textContent = 'View post';

  // Navigate to the selected post in the homepage.
  link.addEventListener('click', (event) => {
    event.preventDefault();
    openPostFromNotification(postId);
  });

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'btn-close';
  closeButton.setAttribute('aria-label', 'Dismiss notification');

  closeButton.addEventListener('click', () => {
    notification.remove();
    updateEmptyMessage();
  });

  notification.append(
    heading,
    author,
    description,
    link,
    closeButton
  );

  if (prepend) {
    notificationList.prepend(notification);
  } else {
    notificationList.append(notification);
  }

  updateEmptyMessage();
}

// Listen for new posts in Firestore.
function startPostNotifications() {
  if (stopNotificationsListener) {
    stopNotificationsListener();
  }

  const postsQuery = query(
    collection(db, 'posts'),
    orderBy('createdAt', 'desc')
  );

  let firstSnapshot = true;

  stopNotificationsListener = onSnapshot(
    postsQuery,
    (snapshot) => {

      // Load existing posts when notifications first open.
      if (firstSnapshot) {
        notificationList.replaceChildren();

        snapshot.docs.forEach((postSnapshot) => {
          renderNotification(postSnapshot, false);
        });

        firstSnapshot = false;
        updateEmptyMessage();
        return;
      }

      // Detect newly added posts.
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          renderNotification(change.doc, true);
        }

        if (change.type === 'removed') {
          const existing = notificationList.querySelector(
            `[data-post-id="${change.doc.id}"]`
          );

          if (existing) existing.remove();
        }
      });

      updateEmptyMessage();
    },
    (error) => {
      console.error('Unable to load notifications:', error);
      emptyMessage.textContent =
        'Unable to load notifications. Please try again.';
      emptyMessage.hidden = false;
    }
  );
}

// Open the actual post in the For You feed.
function openPostFromNotification(postId) {
  const destination = new URL(
    `homePage.html?post=${encodeURIComponent(postId)}`,
    window.parent.location.href
  );

  window.parent.location.href = destination.href;
}

// Remove all currently displayed notifications.
function clearNotifications() {
  notificationList.replaceChildren();
  updateEmptyMessage();
}

// Display the empty message when appropriate.
function updateEmptyMessage() {
  emptyMessage.hidden = notificationList.children.length > 0;
}

// Receive notification status from the notification iframe
window.addEventListener('message', (event) => {
  // Only accept messages from our notification iframe
  if (event.source !== frame.contentWindow) return;

  if (!event.data || event.data.type !== 'notification-status') return;

  const bellImage = bell.querySelector('img');

  if (!bellImage) return;

  if (event.data.hasNotifications) {
    bellImage.src = '../../images/bell_notif.png';
  } else {
    bellImage.src = '../../images/bell.png';
  }
});

// Clear All button.
clearButton.addEventListener('click', clearNotifications);

// Start listening automatically.
startPostNotifications();