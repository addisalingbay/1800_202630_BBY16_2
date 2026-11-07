import { Offcanvas } from 'bootstrap';

// ---------------------------------------------------------------------
// The bell in the homepage top bar opens the notifications overlay
// (a Bootstrap Offcanvas that slides in from the left).
// ---------------------------------------------------------------------
const bell = document.getElementById('notificationsButton');
const panel = document.getElementById('notificationsOffcanvas');

if (bell && panel) {
  const drawer = Offcanvas.getOrCreateInstance(panel);
  bell.addEventListener('click', () => drawer.toggle(bell));
  panel.addEventListener('show.bs.offcanvas', () => bell.setAttribute('aria-expanded', 'true'));
  panel.addEventListener('hidden.bs.offcanvas', () => bell.setAttribute('aria-expanded', 'false'));

  // Dismissing a notification (or "Clear All") removes the button that had
  // keyboard focus, which would stop Esc from closing the overlay.
  // Hand focus back to the overlay when that happens.
  new MutationObserver(() => {
    if (panel.classList.contains('show') && !panel.contains(document.activeElement)) panel.focus();
  }).observe(panel.querySelector('.offcanvas-body'), { childList: true, subtree: true });
}
