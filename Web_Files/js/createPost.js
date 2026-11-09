import { db, auth } from "./firebaseConfig.js";
import { collection, doc, serverTimestamp, writeBatch } from "firebase/firestore";

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
const tagInput = document.getElementById("tagInput");
const addTagConfirm = document.getElementById("addTagConfirm");
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
const MAX_TAG_LENGTH = 30;

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
const tags = [];

function renderTags() {
  tagsContainer.replaceChildren();
  tags.forEach((tag, index) => {
    const chip = document.createElement("span");
    chip.className = "badge rounded-pill text-bg-secondary fw-normal d-inline-flex align-items-center gap-1";
    chip.append(document.createTextNode(tag)); // text only, never HTML

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn-close btn-close-white";
    remove.style.fontSize = "0.55rem";
    remove.setAttribute("aria-label", `Remove tag ${tag}`);
    remove.addEventListener("click", () => {
      tags.splice(index, 1);
      clearError();
      renderTags();
    });

    chip.append(remove);
    tagsContainer.append(chip);
  });
}

// Turns what is typed into one clean tag and adds it. Returns true if added.
function addTagFromInput() {
  const tag = tagInput.value.replace(/^#+/, "").replace(/[\s,]+/g, " ").trim().slice(0, MAX_TAG_LENGTH).trim();
  tagInput.value = "";
  if (!tag) return false;
  if (tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) return false;
  if (tags.length >= MAX_TAGS) {
    showError(`You can add up to ${MAX_TAGS} tags.`);
    return false;
  }
  clearError();
  tags.push(tag);
  renderTags();
  return true;
}

addTagsButton.addEventListener("click", () => {
  tagSection.classList.toggle("d-none");
  if (!tagSection.classList.contains("d-none")) tagInput.focus();
});

tagInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === ",") {
    event.preventDefault(); // Enter must not submit the whole post
    addTagFromInput();
  }
});
addTagConfirm.addEventListener("click", () => {
  addTagFromInput();
  tagInput.focus();
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
  if (tagInput.value.trim() && tags.length >= MAX_TAGS) {
    showError(`You can add up to ${MAX_TAGS} tags.`);
    return;
  }
  addTagFromInput(); // include a tag that was typed but not yet added
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
      tags: [...tags],
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
