import { Offcanvas } from 'bootstrap';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebaseConfig.js';


const LOGIN_PAGE = 'loginPage.html';

const settingsLink = document.getElementById('settingsNavLink');
const panel = document.getElementById('settingsOffcanvas');
const backButton = document.getElementById('settingsBack');
const usernameElement = document.getElementById('settingsUsername');
const joinedElement = document.getElementById('settingsJoined');
const signOutButton = document.getElementById('signOutButton');
const signOutError = document.getElementById('signOutError');

const usernames = new Map();
function joinedText(user) {
  const created = new Date(user.metadata.creationTime);
  if (Number.isNaN(created.getTime())) return '';
  return `Joined: ${created.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
}


async function fetchUsername(user) {
  try {
    const snapshot = await getDoc(doc(db, 'users', user.uid));
    const saved = snapshot.exists() ? snapshot.data().username : '';
    if (typeof saved === 'string' && saved.trim()) return saved.trim();
  } catch (error) {
    console.error('Could not read the username:', error);
  }
  return user.displayName || user.email || 'User';
}

async function fillProfile(user) {
  joinedElement.textContent = user ? joinedText(user) : '';
  if (!user) {
    usernameElement.textContent = '';
    return;
  }

  if (!usernames.has(user.uid)) {
    usernameElement.textContent = '';
    usernames.set(user.uid, await fetchUsername(user));
  }
  if (auth.currentUser && auth.currentUser.uid === user.uid) {
    usernameElement.textContent = usernames.get(user.uid);
  }
}

onAuthStateChanged(auth, (user) => {
  joinedElement.textContent = user ? joinedText(user) : '';
  usernameElement.textContent = user && usernames.has(user.uid) ? usernames.get(user.uid) : '';
});

if (settingsLink && panel) {
  const drawer = Offcanvas.getOrCreateInstance(panel, { backdrop: true, keyboard: true, scroll: false });

  settingsLink.addEventListener('click', (event) => {
    event.preventDefault();
    fillProfile(auth.currentUser);
    drawer.show(settingsLink);
  });

  backButton.addEventListener('click', () => drawer.hide());

  panel.addEventListener('show.bs.offcanvas', () => settingsLink.setAttribute('aria-expanded', 'true'));
  panel.addEventListener('hidden.bs.offcanvas', () => {
    settingsLink.setAttribute('aria-expanded', 'false');
    signOutError.classList.add('d-none');
    settingsLink.focus({ preventScroll: true });
  });
}

if (signOutButton) {
  signOutButton.addEventListener('click', async () => {
    signOutButton.disabled = true;
    signOutError.classList.add('d-none');
    try {
      await signOut(auth);
      window.location.replace(LOGIN_PAGE);
    } catch (error) {
      console.error('Could not sign out:', error);
      signOutError.textContent = 'Could not sign out. Please try again.';
      signOutError.classList.remove('d-none');
      signOutButton.disabled = false;
    }
  });
}
