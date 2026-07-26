/* ============================================================
   ARTWORK LIBRARY
   ------------------------------------------------------------
   Persistent storage for saved artwork, backed by IndexedDB.
   This is a pure storage concern — it knows nothing about World,
   Mask, or Optics, and doesn't touch the rendering pipeline at
   all. main.js is the only file that connects this to Mask
   (by calling Mask.setArtwork() with whatever image this module
   hands back).

   Artwork is stored as Blobs (the original uploaded File object
   IS a Blob, so no re-encoding needed) rather than base64 data
   URLs — smaller in IndexedDB and cheaper to read back out.

   Nothing here is saved automatically. Uploading only sets the
   *active* (temporary, session-only) artwork; a record only
   lands in IndexedDB when saveArtwork() is called explicitly.
   ============================================================ */

const ArtworkLibrary = (function () {
    "use strict";

    const DB_NAME = 'rpgKaleidoscopeArtworkDB';
    const DB_VERSION = 1;
    const STORE_NAME = 'artworks';

    let dbPromise = null;

    function openDB() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    store.createIndex('createdAt', 'createdAt');
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return dbPromise;
    }

    // Save a Blob (e.g. the File from an <input type="file">) as a
    // permanent library entry under a friendly name.
    async function saveArtwork(name, blob) {
        const db = await openDB();
        const id = 'artwork-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        const record = { id, name: name || 'Untitled', blob, createdAt: Date.now() };
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(record);
            tx.oncomplete = () => resolve(record);
            tx.onerror = () => reject(tx.error);
        });
    }

    // All saved artwork, most recently saved first.
    async function getAll() {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).getAll();
            req.onsuccess = () => resolve(req.result.sort((a, b) => b.createdAt - a.createdAt));
            req.onerror = () => reject(req.error);
        });
    }

    async function rename(id, newName) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const getReq = store.get(id);
            getReq.onsuccess = () => {
                const record = getReq.result;
                if (!record) return;
                record.name = newName;
                store.put(record);
            };
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    }

    async function remove(id) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(id);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    }

    return { saveArtwork, getAll, rename, remove };
})();
