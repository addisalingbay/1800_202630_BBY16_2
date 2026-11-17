import '../css/filters.css';
import { db } from './firebaseConfig.js';
import { doc, getDoc } from 'firebase/firestore';

// ---------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------
// A filters object looks like:
//   { keywords: 'some words', tags: ['Tag A'], likes: 'asc' | 'desc' | null, date: 'latest' | 'oldest' | null }
// The default (nothing chosen) means: every post, newest first.

// 'any' = a post matches if it has AT LEAST ONE of the chosen tags.
// Change to 'all' to require EVERY chosen tag.
const TAG_MATCH = 'any';

const TAGS_DOC = doc(db, 'posts', 'Tags'); // same doc the Create Post page reads

export function defaultFilters() {
  return { keywords: '', tags: [], likes: null, date: null };
}

export function hasActiveFilters(filters) {
  return Boolean(filters.keywords || filters.tags.length || filters.likes || filters.date);
}

// Returns a NEW array: filtered by keywords/tags, then sorted.
// Sort rules: likes (if chosen) is the main sort and date breaks ties;
// with no likes choice the date choice decides; with neither it is newest first.
export function filterAndSortPosts(posts, filters) {
  const terms = filters.keywords.toLowerCase().split(/\s+/).filter(Boolean);

  const result = posts.filter((post) => {
    if (terms.length) {
      const haystack = [post.title, post.description, post.username, ...post.tags]
        .join(' ')
        .toLowerCase();
      if (!terms.every((term) => haystack.includes(term))) return false;
    }
    if (filters.tags.length) {
      const matches = TAG_MATCH === 'all'
        ? filters.tags.every((tag) => post.tags.includes(tag))
        : filters.tags.some((tag) => post.tags.includes(tag));
      if (!matches) return false;
    }
    return true;
  });

  const dateDirection = filters.date === 'oldest' ? 1 : -1; // -1 = newest first
  result.sort((a, b) => {
    if (filters.likes) {
      const likeDiff = filters.likes === 'asc'
        ? a.likeCount - b.likeCount
        : b.likeCount - a.likeCount;
      if (likeDiff) return likeDiff;
    }
    return dateDirection * (a.createdAt - b.createdAt);
  });
  return result;
}

// ---------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------
function overlayHtml() {
  return `
    <div id="filters-overlay" class="filters-overlay" role="dialog" aria-modal="true"
      aria-labelledby="filters-title" aria-hidden="true" inert>
      <div class="filters-panel card bg-body-tertiary border-0 rounded-3 overflow-hidden">
        <header class="filters-header bg-body-secondary px-3 py-2">
          <span aria-hidden="true"></span>
          <h2 id="filters-title" class="h4 fw-bold text-center mb-0">Filter</h2>
          <button type="button" id="filters-close" class="btn btn-link text-body p-0 fs-3 lh-1 ms-auto"
            aria-label="Close filters"><i class="bi bi-x-lg"></i></button>
        </header>

        <form id="filters-form" class="p-3" novalidate>
          <label for="filters-keywords" class="form-label small fw-bold mb-1">Keywords:</label>
          <input type="text" id="filters-keywords" class="form-control mb-3" maxlength="100"
            placeholder="Search title, description, user..." autocomplete="off">

          <div id="filters-tags-label" class="small fw-bold mb-1">Tags:</div>
          <div class="filters-tag-bar form-control d-flex align-items-center gap-2 mb-2"
            role="group" aria-labelledby="filters-tags-label">
            <button type="button" id="filters-add-tag" class="btn btn-sm btn-outline-secondary rounded-circle filters-add-tag"
              aria-label="Add tags" aria-expanded="false" aria-controls="filters-tag-picker">
              <i class="bi bi-plus-lg"></i>
            </button>
            <div id="filters-selected-tags" class="d-flex flex-wrap gap-1"></div>
          </div>

          <div id="filters-tag-picker" class="p-2 bg-body-secondary rounded-3 mb-3 d-none">
            <div id="filters-available-tags" class="d-flex flex-wrap gap-1"></div>
            <div id="filters-tag-status" class="form-text mt-0"></div>
          </div>

          <div class="filters-group bg-body-secondary rounded-3 px-3 py-2 mb-3" role="radiogroup" aria-labelledby="filters-likes-label">
            <span id="filters-likes-label" class="fw-bold">Likes:</span>
            <div class="form-check form-check-reverse m-0">
              <input class="form-check-input" type="radio" name="filters-likes" id="filters-likes-asc" value="asc">
              <label class="form-check-label small" for="filters-likes-asc">Ascending</label>
            </div>
            <div class="form-check form-check-reverse m-0">
              <input class="form-check-input" type="radio" name="filters-likes" id="filters-likes-desc" value="desc">
              <label class="form-check-label small" for="filters-likes-desc">Descending</label>
            </div>
          </div>

          <div class="filters-group bg-body-secondary rounded-3 px-3 py-2 mb-3" role="radiogroup" aria-labelledby="filters-date-label">
            <span id="filters-date-label" class="fw-bold">Date:</span>
            <div class="form-check form-check-reverse m-0">
              <input class="form-check-input" type="radio" name="filters-date" id="filters-date-latest" value="latest">
              <label class="form-check-label small" for="filters-date-latest">Latest</label>
            </div>
            <div class="form-check form-check-reverse m-0">
              <input class="form-check-input" type="radio" name="filters-date" id="filters-date-oldest" value="oldest">
              <label class="form-check-label small" for="filters-date-oldest">Oldest</label>
            </div>
          </div>

          <div class="d-flex gap-3">
            <button type="button" id="filters-clear" class="btn btn-outline-secondary fw-bold rounded-3 flex-fill">Clear All</button>
            <button type="submit" id="filters-apply" class="btn btn-primary fw-bold rounded-3 flex-fill">Apply</button>
          </div>
        </form>
      </div>
    </div>`;
}

// Wires the filter button to the filters panel.
// onApply(filters) runs when the user presses Apply or Clear All.
export function initFilters(openButton, onApply) {
  document.body.insertAdjacentHTML('beforeend', overlayHtml());

  const overlay = document.getElementById('filters-overlay');
  const form = document.getElementById('filters-form');
  const closeButton = document.getElementById('filters-close');
  const keywordsInput = document.getElementById('filters-keywords');
  const clearButton = document.getElementById('filters-clear');
  const addTagButton = document.getElementById('filters-add-tag');
  const tagPicker = document.getElementById('filters-tag-picker');
  const availableTagsEl = document.getElementById('filters-available-tags');
  const selectedTagsEl = document.getElementById('filters-selected-tags');
  const tagStatus = document.getElementById('filters-tag-status');

  let applied = defaultFilters(); // what the feed is currently using
  let draftTags = [];             // tags picked in the panel, not applied yet
  let allTags = [];
  let tagsLoaded = false;

  // ---- tags ----
  function makeTagButton(tag, isSelected) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `badge rounded-pill fw-normal ${
      isSelected ? 'text-bg-secondary border-0' : 'filters-tag-available'
    }`;
    button.textContent = tag; // text only, never HTML
    if (isSelected) {
      const icon = document.createElement('i');
      icon.className = 'bi bi-x ms-1';
      icon.setAttribute('aria-hidden', 'true');
      button.append(icon);
    }
    button.setAttribute('aria-label', isSelected ? `Remove tag ${tag}` : `Add tag ${tag}`);
    button.addEventListener('click', () => {
      if (isSelected) draftTags = draftTags.filter((t) => t !== tag);
      else if (!draftTags.includes(tag)) draftTags.push(tag);
      renderTags();
    });
    return button;
  }

  function renderTags() {
    availableTagsEl.replaceChildren();
    selectedTagsEl.replaceChildren();
    allTags
      .filter((tag) => !draftTags.includes(tag))
      .forEach((tag) => availableTagsEl.append(makeTagButton(tag, false)));
    draftTags.forEach((tag) => selectedTagsEl.append(makeTagButton(tag, true)));

    if (tagsLoaded) {
      if (!allTags.length) tagStatus.textContent = 'No tags available yet.';
      else if (draftTags.length >= allTags.length) tagStatus.textContent = 'All tags selected.';
      else tagStatus.textContent = '';
    }
  }

  async function loadTags() {
    if (tagsLoaded) return;
    tagStatus.textContent = 'Loading tags...';
    try {
      const snap = await getDoc(TAGS_DOC);
      const data = snap.exists() ? snap.data() : {};
      const values = Object.keys(data)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) // Tag1, Tag2, ... Tag10
        .map((key) => data[key])
        .filter((value) => typeof value === 'string' && value.trim())
        .map((value) => value.trim());
      allTags = [...new Set(values)];
      tagsLoaded = true;
    } catch (error) {
      console.error('Could not load tags:', error);
      tagStatus.textContent = 'Could not load tags. Close and reopen the tag list to try again.';
      return;
    }
    renderTags();
  }

  function setPickerOpen(open) {
    tagPicker.classList.toggle('d-none', !open);
    addTagButton.setAttribute('aria-expanded', String(open));
    if (open) loadTags();
  }
  addTagButton.addEventListener('click', () => {
    setPickerOpen(tagPicker.classList.contains('d-none'));
  });

  // ---- form <-> filters ----
  function setRadio(name, value) {
    form.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
      input.checked = input.value === value;
    });
  }

  function fillForm(filters) {
    keywordsInput.value = filters.keywords;
    draftTags = [...filters.tags];
    setRadio('filters-likes', filters.likes);
    setRadio('filters-date', filters.date);
    setPickerOpen(false);
    renderTags();
  }

  function readForm() {
    return {
      keywords: keywordsInput.value.trim(),
      tags: [...draftTags],
      likes: form.querySelector('input[name="filters-likes"]:checked')?.value ?? null,
      date: form.querySelector('input[name="filters-date"]:checked')?.value ?? null
    };
  }

  // ---- open / close ----
  function openFilters() {
    fillForm(applied); // always start from what is currently applied
    overlay.inert = false;
    overlay.setAttribute('aria-hidden', 'false');
    overlay.classList.add('is-open');
    keywordsInput.focus({ preventScroll: true });
  }

  function closeFilters() {
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.inert = true;
    openButton.focus({ preventScroll: true });
  }

  function commit(filters) {
    applied = filters;
    openButton.classList.toggle('has-filters', hasActiveFilters(applied));
    closeFilters();
    onApply(applied);
  }

  openButton.addEventListener('click', openFilters);
  closeButton.addEventListener('click', closeFilters);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeFilters(); // click on the dark backdrop
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlay.classList.contains('is-open')) closeFilters();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    commit(readForm());
  });
  clearButton.addEventListener('click', () => {
    fillForm(defaultFilters());
    commit(defaultFilters());
  });
}