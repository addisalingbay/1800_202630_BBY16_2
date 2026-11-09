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
