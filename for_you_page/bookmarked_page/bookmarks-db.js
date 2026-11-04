import {
  collection, doc, addDoc, deleteDoc, onSnapshot, query, orderBy, writeBatch, serverTimestamp
} from 'firebase/firestore';
import { db } from './firebase-init.js';

const foldersPath = (uid) => collection(db, 'users', uid, 'bookmarkFolders');

export function subscribeToFolders(uid, onChange) {
  const q = query(foldersPath(uid), orderBy('createdAt', 'asc'));
  return onSnapshot(q, (snapshot) => {
    onChange(snapshot.docs.map((d) => {
      const data = d.data({ serverTimestamps: 'estimate' });
      return { id: d.id, name: data.name || '', coverUrl: data.coverUrl || '' };
    }));
  });
}

export function subscribeToSavedPosts(uid, folderId, onChange) {
  const q = query(
    collection(db, 'users', uid, 'bookmarkFolders', folderId, 'savedPosts'),
    orderBy('savedAt', 'desc')
  );
  return onSnapshot(q, (snapshot) => {
    onChange(snapshot.docs.map((d) => {
      const data = d.data({ serverTimestamps: 'estimate' });
      return { id: d.id, postId: data.postId || d.id, thumbnailUrl: data.thumbnailUrl || '' };
    }));
  });
}

export async function createFolder(uid, name) {
  const created = await addDoc(foldersPath(uid), {
    name,
    coverUrl: '',
    createdAt: serverTimestamp()
  });
  return created.id;
}

export async function savePostToFolder(uid, folderId, post) {
  const folderRef = doc(db, 'users', uid, 'bookmarkFolders', folderId);
  const batch = writeBatch(db);
  batch.set(doc(folderRef, 'savedPosts', post.id), {
    postId: post.id,
    authorId: post.authorId,
    title: post.title,
    thumbnailUrl: post.imageUrl || '',
    savedAt: serverTimestamp()
  });
  if (post.imageUrl) batch.update(folderRef, { coverUrl: post.imageUrl });
  await batch.commit();
}

export function removeSavedPost(uid, folderId, postId) {
  return deleteDoc(doc(db, 'users', uid, 'bookmarkFolders', folderId, 'savedPosts', postId));
}
