import { db, auth } from "./firebaseConfig.js";
import { collection, doc, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

// ---------------------------------------------------------------------
// Create Post
// ---------------------------------------------------------------------
// Submitting the form saves ONE post into the shared feed:
//
//   posts/{postId}                      <- what the For You feed reads, so
//                                          every signed-in user can see it
//   users/{uid}/createdPosts/{postId}   <- the author's own list (kept from the
//                                          original design); just points at it
//
// Both writes happen in one batch: either both are saved or neither is.
// The image is a pasted https:// link stored in the post's `imageUrl` field
// (no Firebase Storage involved).

const form = document.getElementById("createPost");
const titleInput = document.getElementById("title");
const descriptionInput = document.getElementById("description");
const addImagesButton = document.getElementById("addImagesButton");
const addTagsButton = document.getElementById("addTagsButton");
const tagSection = document.getElementById("tagSection");
const availableTagsContainer = document.getElementById("availableTags");
const tagStatus = document.getElementById("tagStatus");
const tagsContainer = document.getElementById("postTags");
const imageLinkSection = document.getElementById("imageLinkSection");
const imageUrlInput = document.getElementById("imageUrl");
const imagePreview = document.getElementById("imageLinkPreview");
const createPostButton = document.getElementById("createPostButton");
const returnButton = document.getElementById("returnButton");
const postError = document.getElementById("postError");

const FEED_PAGE = "homePage.html";
// These limits match the Firestore security rules for posts.
const MAX_TITLE = 160;
const MAX_DESCRIPTION = 10000;
const MAX_IMAGE_URL = 2048;
const MAX_USERNAME = 80;
const MAX_TAGS = 10;


function showError(message) {
  postError.textContent = message;
  postError.classList.remove("d-none");
}

function clearError() {
  postError.textContent = "";
  postError.classList.add("d-none");
}

function setSaving(saving) {
  createPostButton.disabled = saving;
  createPostButton.textContent = saving ? "Posting..." : "Post";
}

// Reads the pasted image link. Returns { url } (null when empty) or { error }.
function readImageUrl() {
  const raw = imageUrlInput.value.trim();
  if (!raw) return { url: null };
  if (raw.length > MAX_IMAGE_URL) {
    return { error: `That image link is too long (maximum ${MAX_IMAGE_URL} characters).` };
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (error) {
    return { error: "That image link is not a valid web address." };
  }
  if (parsed.protocol !== "https:") {
    return { error: "Image links must start with https://" };
  }
  return { url: raw };
}

// Resolves true if the browser can actually load the picture at this link.
function imageLoads(url) {
  return new Promise((resolve) => {
    const probe = new Image();
    const timer = setTimeout(() => resolve(false), 8000);
    probe.onload = () => { clearTimeout(timer); resolve(true); };
    probe.onerror = () => { clearTimeout(timer); resolve(false); };
    probe.src = url;
  });
}

// ---------------------------------------------------------------------
// Tags: kept in this array and drawn as Bootstrap badges inside #postTags.
// ---------------------------------------------------------------------

const TAGS_DOC = doc(db, "posts", "Tags");
let allTags = [];          // every premade tag, in database order
const selectedTags = [];   // what will be saved with the post
let tagsLoaded = false;

function makeTagButton(tag, isSelected) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `badge rounded-pill fw-normal ${
    isSelected ? "text-bg-secondary border-0" : "tag-available"
  }`;
  button.textContent = tag; // text only, never HTML
  button.setAttribute("aria-label", isSelected ? `Remove tag ${tag}` : `Add tag ${tag}`);
  button.addEventListener("click", () => (isSelected ? deselectTag(tag) : selectTag(tag)));
  return button;
}

function renderTags() {
  availableTagsContainer.replaceChildren();
  tagsContainer.replaceChildren();

  allTags
    .filter((tag) => !selectedTags.includes(tag))
    .forEach((tag) => availableTagsContainer.append(makeTagButton(tag, false)));

  selectedTags.forEach((tag) => tagsContainer.append(makeTagButton(tag, true)));

  if (tagsLoaded) {
    if (!allTags.length) tagStatus.textContent = "No tags available yet.";
    else if (selectedTags.length === allTags.length) tagStatus.textContent = "All tags selected.";
    else tagStatus.textContent = "";
  }
}

function selectTag(tag) {
  if (selectedTags.includes(tag)) return;
  if (selectedTags.length >= MAX_TAGS) {
    showError(`You can add up to ${MAX_TAGS} tags.`);
    return;
  }
  clearError();
  selectedTags.push(tag);
  renderTags();
}

function deselectTag(tag) {
  const index = selectedTags.indexOf(tag);
  if (index === -1) return;
  selectedTags.splice(index, 1);
  clearError();
  renderTags(); // the tag reappears in its original position in the list
}

async function loadTags() {
  if (tagsLoaded) return;
  tagStatus.textContent = "Loading tags...";
  try {
    const snap = await getDoc(TAGS_DOC);
    const data = snap.exists() ? snap.data() : {};
    const values = Object.keys(data)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) // Tag1, Tag2, ... Tag10
      .map((key) => data[key])
      .filter((value) => typeof value === "string" && value.trim())
      .map((value) => value.trim());
    allTags = [...new Set(values)];
    tagsLoaded = true;
  } catch (error) {
    console.error("Could not load tags:", error);
    tagStatus.textContent = "Could not load tags. Close and reopen this panel to try again.";
    return;
  }
  renderTags();
}

addTagsButton.addEventListener("click", () => {
  tagSection.classList.toggle("d-none");
  if (!tagSection.classList.contains("d-none")) loadTags();
});


// Show / hide the image-link field (Bootstrap's d-none utility).
addImagesButton.addEventListener("click", () => {
  imageLinkSection.classList.toggle("d-none");
  if (!imageLinkSection.classList.contains("d-none")) imageUrlInput.focus();
});

// Live preview of the pasted link.
let previewTimer = null;
imageUrlInput.addEventListener("input", () => {
  clearTimeout(previewTimer);
  imagePreview.classList.add("d-none");
  previewTimer = setTimeout(() => {
    const { url } = readImageUrl();
    if (url) imagePreview.src = url;
    else imagePreview.removeAttribute("src");
  }, 400);
});
imagePreview.addEventListener("load", () => imagePreview.classList.remove("d-none"));
imagePreview.addEventListener("error", () => imagePreview.classList.add("d-none"));

returnButton.addEventListener("click", () => {
  window.location.href = FEED_PAGE;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();

  const user = auth.currentUser;
  if (!user) {
    showError("Please sign in before creating a post.");
    return;
  }

  const title = titleInput.value.trim();
  const description = descriptionInput.value.trim();
  if (!title) {
    showError("Please add a title.");
    return;
  }
  if (title.length > MAX_TITLE) {
    showError(`The title is too long (maximum ${MAX_TITLE} characters).`);
    return;
  }
  if (description.length > MAX_DESCRIPTION) {
    showError(`The post is too long (maximum ${MAX_DESCRIPTION} characters).`);
    return;
  }

  const image = readImageUrl();
  if (image.error) {
    showError(image.error);
    return;
  }

  setSaving(true);
  try {
    if (image.url && !(await imageLoads(image.url))) {
      showError("That image could not be loaded. Make sure the link goes straight to a picture.");
      setSaving(false);
      return;
    }

    const postRef = doc(collection(db, "posts")); // auto-generated unique post ID
    const userPostRef = doc(db, "users", user.uid, "createdPosts", postRef.id);
    const username = String(user.displayName || user.email || "User").slice(0, MAX_USERNAME);

    const batch = writeBatch(db);
    batch.set(postRef, {
      uid: user.uid,
      username,
      title,
      description,
      tags: [...selectedTags],   // empty array if none picked, so tags stay optional
      imageUrl: image.url,
      createdAt: serverTimestamp(),
      likeCount: 0
    });
    batch.set(userPostRef, {
      postId: postRef.id,
      title,
      createdAt: serverTimestamp()
    });
    await batch.commit();

    // The feed is sorted newest-first, so the new post will be at the top.
    window.location.href = FEED_PAGE;
  } catch (error) {
    console.error("Could not create post:", error);
    showError("Your post could not be saved. Please check your connection and try again.");
    setSaving(false);
  }
});

onAuthStateChanged(auth, (user) => {
  const name = document.getElementById("composerUsername");
  if (name && user) name.textContent = user.displayName || user.email || "You";
});