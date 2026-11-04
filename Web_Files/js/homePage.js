import '../../for_you_page/for-you.css';
import forYouHtml from '../../for_you_page/for-you.html?raw';

async function mountForYou() {
  const mount = document.getElementById('forYouMount');
  if (!mount) return;

  const source = new DOMParser().parseFromString(forYouHtml, 'text/html');

  const page = source.querySelector('main');
  if (page) mount.appendChild(document.importNode(page, true));

  source.body.querySelectorAll(':scope > [role="dialog"]').forEach((overlay) => {
    document.body.appendChild(document.importNode(overlay, true));
  });

  await import('../../for_you_page/for-you.js');
}

mountForYou();
