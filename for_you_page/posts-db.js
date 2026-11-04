import {
  collection, doc, getDocs, onSnapshot, query, orderBy, limit, startAfter,
  where, writeBatch, serverTimestamp, Timestamp
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from './firebase-init.js';

export const POSTS_COLLECTION = 'posts';
const PAGE_SIZE = 8;

export function normalizePost(snapshot) {
  const data = snapshot.data({ serverTimestamps: 'estimate' });
  const imageUrls = Array.isArray(data.imageUrls) ? data.imageUrls : [];
  return {
    id: snapshot.id,
    authorId: data.authorId || '',
    username: data.authorName || 'Unknown',
    title: data.title || '',
    tags: Array.isArray(data.tags) ? data.tags : [],
    description: data.description || '',
    imageUrls,
    imageUrl: imageUrls.length ? imageUrls[0] : null,
    createdAt: data.createdAt ? data.createdAt.toDate() : new Date()
  };
}

export async function fetchPostsPage(cursor = null) {
  const constraints = [orderBy('createdAt', 'desc')];
  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(PAGE_SIZE));

  const snapshot = await getDocs(query(collection(db, POSTS_COLLECTION), ...constraints));
  const docs = snapshot.docs;
  return {
    posts: docs.map(normalizePost),
    cursor: docs.length ? docs[docs.length - 1] : cursor,
    done: docs.length < PAGE_SIZE
  };
}

export function subscribeToNewPosts(since, onPost) {
  const q = query(
    collection(db, POSTS_COLLECTION),
    where('createdAt', '>', Timestamp.fromDate(since)),
    orderBy('createdAt', 'asc')
  );
  return onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') onPost(normalizePost(change.doc));
    });
  });
}

export async function createPost({ user, authorName, title, description, tags = [], files = [] }) {
  const postRef = doc(collection(db, POSTS_COLLECTION));

  const imageUrls = [];
  for (const file of files) {
    const safeName = file.name.replace(/[^\w.-]/g, '_');
    const fileRef = ref(storage, 'posts/' + user.uid + '/' + postRef.id + '/' + Date.now() + '-' + safeName);
    await uploadBytes(fileRef, file);
    imageUrls.push(await getDownloadURL(fileRef));
  }

  const batch = writeBatch(db);
  batch.set(postRef, {
    authorId: user.uid,
    authorName,
    title,
    description,
    tags,
    imageUrls,
    createdAt: serverTimestamp()
  });
  batch.set(doc(db, 'users', user.uid, 'createdPosts', postRef.id), {
    postId: postRef.id,
    createdAt: serverTimestamp()
  });
  await batch.commit();
  return postRef.id;
}
