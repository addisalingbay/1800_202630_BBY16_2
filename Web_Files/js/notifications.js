import { Offcanvas } from 'bootstrap';

// ---------------------------------------------------------------------
// Notifications drawer
// The bell button in the homepage top bar opens a Bootstrap Offcanvas
// (#notificationsOffcanvas) that slides in from the left.
// ---------------------------------------------------------------------
const bell = document.getElementById('notificationsButton');
const panel = document.getElementById('notificationsOffcanvas');
const list = document.getElementById('notificationList');
const clearButton = document.getElementById('clear-notifications');

if (bell && panel) {
  const drawer = Offcanvas.getOrCreateInstance(panel);
  bell.addEventListener('click', () => drawer.toggle(bell));
  panel.addEventListener('show.bs.offcanvas', () => bell.setAttribute('aria-expanded', 'true'));
  panel.addEventListener('hidden.bs.offcanvas', () => bell.setAttribute('aria-expanded', 'false'));
}

// "Clear All Notifications" is only useful while there is something to clear.
function syncClearButton() {
  if (clearButton && list) clearButton.disabled = list.children.length === 0;
}

// Removing a notification (or clearing them all) removes the button that had
// keyboard focus, which would drop focus to the page and stop Esc from closing
// the drawer. Hand focus back to the drawer so Esc and Tab keep working.
function keepFocusInDrawer() {
  if (!panel || !panel.classList.contains('show')) return;
  const active = document.activeElement;
  const lostFocus = !panel.contains(active) || (active === clearButton && clearButton.disabled);
  if (lostFocus) panel.focus();
}

if (clearButton && list) {
  clearButton.addEventListener('click', () => list.replaceChildren());

  // Runs whenever a notification is removed, by its X or by "Clear All".
  new MutationObserver(() => {
    syncClearButton();
    keepFocusInDrawer();
  }).observe(list, { childList: true });

  syncClearButton();
}
