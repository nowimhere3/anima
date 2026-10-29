/* ============================================================
   IMAGE PRESETS — Persistent Saved Control Snapshots (My Images)
   Backed by IndexedDB. Stores durable preset configurations and
   associated image blobs without duplicating shared assets.
   Survives closing and reopening the browser.
   ============================================================ */
const ImagePresets = (function () {
    "use strict";

    const DB_NAME = 'animaArtLabPresetsDB';
    const DB_VERSION = 1;
    const PRESETS_STORE = 'presets';
    const ASSETS_STORE = 'assets';

    let dbPromise = null;

    function openDB() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(PRESETS_STORE)) {
                    const ps = db.createObjectStore(PRESETS_STORE, { keyPath: 'id' });
                    ps.createIndex('updatedAt', 'updatedAt');
                    ps.createIndex('name', 'name');
                }
                if (!db.objectStoreNames.contains(ASSETS_STORE)) {
                    const as = db.createObjectStore(ASSETS_STORE, { keyPath: 'id' });
                    as.createIndex('createdAt', 'createdAt');
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('Failed to open presets database'));
        });
        return dbPromise;
    }

    async function hashBlob(blob) {
        if (window.crypto && crypto.subtle && blob.arrayBuffer) {
            try {
                const buf = await blob.arrayBuffer();
                const dig = await crypto.subtle.digest('SHA-256', buf);
                return Array.from(new Uint8Array(dig)).map(b => b.toString(16).padStart(2, '0')).join('');
            } catch (e) {
                // fallback below
            }
        }
        return 'blob-' + (blob.size || 0) + '-' + (blob.name || 'image') + '-' + (blob.lastModified || Date.now());
    }

    async function storeAsset(rec) {
        const db = await openDB();
        let sId = rec.storageId;
        if (!sId) {
            const h = await hashBlob(rec.blob);
            sId = 'sha256-' + h;
            rec.storageId = sId;
        }

        const existing = await new Promise((res, rej) => {
            const tx = db.transaction(ASSETS_STORE, 'readonly');
            const req = tx.objectStore(ASSETS_STORE).get(sId);
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(tx.error);
        });

        if (!existing) {
            await new Promise((res, rej) => {
                const tx = db.transaction(ASSETS_STORE, 'readwrite');
                tx.objectStore(ASSETS_STORE).put({
                    id: sId,
                    name: rec.name || 'image',
                    type: (rec.blob && rec.blob.type) || 'image/png',
                    blob: rec.blob,
                    width: rec.width,
                    height: rec.height,
                    createdAt: Date.now()
                });
                tx.oncomplete = () => res(true);
                tx.onerror = () => rej(tx.error);
            });
        }
        return sId;
    }

    async function getAllPresets() {
        const db = await openDB();
        return new Promise((res, rej) => {
            const tx = db.transaction(PRESETS_STORE, 'readonly');
            const req = tx.objectStore(PRESETS_STORE).getAll();
            req.onsuccess = () => {
                const list = req.result || [];
                list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
                res(list);
            };
            req.onerror = () => rej(tx.error);
        });
    }

    async function getPreset(id) {
        const db = await openDB();
        return new Promise((res, rej) => {
            const tx = db.transaction(PRESETS_STORE, 'readonly');
            const req = tx.objectStore(PRESETS_STORE).get(id);
            req.onsuccess = () => res(req.result || null);
            req.onerror = () => rej(tx.error);
        });
    }

    async function getAsset(id) {
        const db = await openDB();
        return new Promise((res, rej) => {
            const tx = db.transaction(ASSETS_STORE, 'readonly');
            const req = tx.objectStore(ASSETS_STORE).get(id);
            req.onsuccess = () => res(req.result || null);
            req.onerror = () => rej(tx.error);
        });
    }

    async function getAllAssets() {
        const db = await openDB();
        return new Promise((res, rej) => {
            const tx = db.transaction(ASSETS_STORE, 'readonly');
            const req = tx.objectStore(ASSETS_STORE).getAll();
            req.onsuccess = () => res(req.result || []);
            req.onerror = () => rej(tx.error);
        });
    }

    async function savePreset(name, scene) {
        if (!scene || !scene.layers || !scene.layers.length) {
            throw new Error('Scene has no layers to save.');
        }
        const db = await openDB();
        const assetIdMap = new Map();

        for (const rt of scene.layers) {
            const aId = rt.spec.image && rt.spec.image.assetId;
            if (aId && !assetIdMap.has(aId)) {
                const rec = ImageArtEngine.assets.get(aId);
                if (!rec) throw new Error('Asset not found in memory: ' + aId);
                const sId = await storeAsset(rec);
                assetIdMap.set(aId, sId);
            }
        }

        const layersSnapshot = scene.layers.map(rt => {
            const sp = JSON.parse(JSON.stringify(rt.spec));
            if (sp.image && sp.image.assetId) {
                sp.image.storageId = assetIdMap.get(sp.image.assetId) || rt.spec.image.storageId;
            }
            return sp;
        });

        const id = 'preset-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
        const record = {
            id,
            name: (name || 'Untitled Preset').trim(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            assetIds: Array.from(assetIdMap.values()),
            scene: {
                folds: scene.folds,
                motionMultiplier: scene.motionMultiplier,
                light: Object.assign({}, scene.light),
                layers: layersSnapshot
            }
        };

        await new Promise((res, rej) => {
            const tx = db.transaction(PRESETS_STORE, 'readwrite');
            tx.objectStore(PRESETS_STORE).put(record);
            tx.oncomplete = () => res(record);
            tx.onerror = () => rej(tx.error);
        });

        return record;
    }

    async function updatePreset(id, scene) {
        if (!scene || !scene.layers || !scene.layers.length) {
            throw new Error('Scene has no layers to save.');
        }
        const db = await openDB();
        const existing = await getPreset(id);
        if (!existing) throw new Error('Preset not found: ' + id);

        const assetIdMap = new Map();
        for (const rt of scene.layers) {
            const aId = rt.spec.image && rt.spec.image.assetId;
            if (aId && !assetIdMap.has(aId)) {
                const rec = ImageArtEngine.assets.get(aId);
                if (!rec) throw new Error('Asset not found in memory: ' + aId);
                const sId = await storeAsset(rec);
                assetIdMap.set(aId, sId);
            }
        }

        const layersSnapshot = scene.layers.map(rt => {
            const sp = JSON.parse(JSON.stringify(rt.spec));
            if (sp.image && sp.image.assetId) {
                sp.image.storageId = assetIdMap.get(sp.image.assetId) || rt.spec.image.storageId;
            }
            return sp;
        });

        existing.updatedAt = Date.now();
        existing.assetIds = Array.from(assetIdMap.values());
        existing.scene = {
            folds: scene.folds,
            motionMultiplier: scene.motionMultiplier,
            light: Object.assign({}, scene.light),
            layers: layersSnapshot
        };

        await new Promise((res, rej) => {
            const tx = db.transaction(PRESETS_STORE, 'readwrite');
            tx.objectStore(PRESETS_STORE).put(existing);
            tx.oncomplete = () => res(existing);
            tx.onerror = () => rej(tx.error);
        });

        return existing;
    }

    async function renamePreset(id, newName) {
        const db = await openDB();
        const existing = await getPreset(id);
        if (!existing) throw new Error('Preset not found: ' + id);
        existing.name = (newName || existing.name).trim();
        existing.updatedAt = Date.now();

        await new Promise((res, rej) => {
            const tx = db.transaction(PRESETS_STORE, 'readwrite');
            tx.objectStore(PRESETS_STORE).put(existing);
            tx.oncomplete = () => res(existing);
            tx.onerror = () => rej(tx.error);
        });
        return existing;
    }

    async function deletePreset(id) {
        const db = await openDB();
        const existing = await getPreset(id);
        if (!existing) return;

        await new Promise((res, rej) => {
            const tx = db.transaction(PRESETS_STORE, 'readwrite');
            tx.objectStore(PRESETS_STORE).delete(id);
            tx.oncomplete = () => res(true);
            tx.onerror = () => rej(tx.error);
        });

        // Safe cleanup: only delete assets not referenced by ANY remaining preset AND not saved in library
        const all = await getAllPresets();
        const activeAssetIds = new Set();
        all.forEach(p => (p.assetIds || []).forEach(aId => activeAssetIds.add(aId)));

        for (const sId of (existing.assetIds || [])) {
            if (!activeAssetIds.has(sId)) {
                try {
                    const assetRec = await getAsset(sId);
                    if (assetRec && assetRec.savedInLibrary) {
                        // Protected: image is saved in the user's permanent library
                        continue;
                    }
                    await new Promise((res, rej) => {
                        const tx = db.transaction(ASSETS_STORE, 'readwrite');
                        tx.objectStore(ASSETS_STORE).delete(sId);
                        tx.oncomplete = () => res(true);
                        tx.onerror = () => rej(tx.error);
                    });
                } catch (e) {
                    console.warn('Asset deletion error:', e);
                }
            }
        }
    }

    /* ---------- Permanent Saved Images Library ---------- */
    async function saveImageToLibrary(name, blob, meta) {
        if (!blob) throw new Error('No image blob provided');
        const db = await openDB();
        const hash = await hashBlob(blob);
        const sId = 'sha256-' + hash;
        const displayName = (name || (blob.name ? blob.name.replace(/\.[^.]+$/, '') : 'image')).trim();

        const existing = await getAsset(sId);
        if (existing) {
            existing.savedInLibrary = true;
            existing.libraryName = displayName || existing.libraryName || existing.name;
            existing.updatedAt = Date.now();
            await new Promise((res, rej) => {
                const tx = db.transaction(ASSETS_STORE, 'readwrite');
                tx.objectStore(ASSETS_STORE).put(existing);
                tx.oncomplete = () => res(existing);
                tx.onerror = () => rej(tx.error);
            });
            return existing;
        }

        const record = {
            id: sId,
            name: displayName,
            libraryName: displayName,
            savedInLibrary: true,
            type: blob.type || 'image/png',
            blob: blob,
            width: (meta && meta.width) || 0,
            height: (meta && meta.height) || 0,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        await new Promise((res, rej) => {
            const tx = db.transaction(ASSETS_STORE, 'readwrite');
            tx.objectStore(ASSETS_STORE).put(record);
            tx.oncomplete = () => res(record);
            tx.onerror = () => rej(tx.error);
        });
        return record;
    }

    async function getSavedImages() {
        const assets = await getAllAssets();
        const libraryAssets = assets.filter(a => a.savedInLibrary === true);
        libraryAssets.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));

        const bundled = (typeof window !== 'undefined' && window.AnimaBundledImages) || [];
        const result = [];

        // Bundled images appear at the top
        for (const b of bundled) {
            result.push({
                id: b.id,
                name: b.name,
                libraryName: b.name,
                fileName: b.fileName || 'image.png',
                isBundled: true,
                type: b.type,
                width: b.width,
                height: b.height,
                dataUrl: b.dataUrl
            });
        }

        for (const a of libraryAssets) {
            result.push({
                id: a.id,
                name: a.libraryName || a.name || 'image',
                libraryName: a.libraryName || a.name || 'image',
                fileName: a.name || 'image',
                isBundled: false,
                type: a.type,
                width: a.width,
                height: a.height,
                storageId: a.id,
                blob: a.blob,
                createdAt: a.createdAt,
                updatedAt: a.updatedAt
            });
        }
        return result;
    }

    async function renameLibraryImage(id, newName) {
        const trimmed = (newName || '').trim();
        if (!trimmed) return null;
        const db = await openDB();
        const existing = await getAsset(id);
        if (!existing) throw new Error('Asset not found in library: ' + id);
        existing.libraryName = trimmed;
        existing.updatedAt = Date.now();
        await new Promise((res, rej) => {
            const tx = db.transaction(ASSETS_STORE, 'readwrite');
            tx.objectStore(ASSETS_STORE).put(existing);
            tx.oncomplete = () => res(existing);
            tx.onerror = () => rej(tx.error);
        });
        return existing;
    }

    async function removeLibraryImage(id) {
        const db = await openDB();
        const existing = await getAsset(id);
        if (!existing) return { deleted: false };

        const all = await getAllPresets();
        const isReferencedByPreset = all.some(p => (p.assetIds || []).includes(id));

        if (isReferencedByPreset) {
            // Unmark from library but keep binary asset so presets remain intact!
            existing.savedInLibrary = false;
            existing.updatedAt = Date.now();
            await new Promise((res, rej) => {
                const tx = db.transaction(ASSETS_STORE, 'readwrite');
                tx.objectStore(ASSETS_STORE).put(existing);
                tx.oncomplete = () => res(true);
                tx.onerror = () => rej(tx.error);
            });
            return { preservedForPresets: true };
        } else {
            // Safe to delete entirely from assets store
            await new Promise((res, rej) => {
                const tx = db.transaction(ASSETS_STORE, 'readwrite');
                tx.objectStore(ASSETS_STORE).delete(id);
                tx.oncomplete = () => res(true);
                tx.onerror = () => rej(tx.error);
            });
            return { deleted: true };
        }
    }

    /* ---------- Backup / Restore ---------- */
    async function exportBackup() {
        const presets = await getAllPresets();
        const assets = await getAllAssets();
        const serializedAssets = [];

        for (const a of assets) {
            let dataUrl = '';
            if (a.blob) {
                dataUrl = await new Promise(res => {
                    const fr = new FileReader();
                    fr.onload = () => res(fr.result);
                    fr.onerror = () => res('');
                    fr.readAsDataURL(a.blob);
                });
            }
            serializedAssets.push({
                id: a.id,
                name: a.name,
                libraryName: a.libraryName || a.name,
                savedInLibrary: !!a.savedInLibrary,
                type: a.type || 'image/png',
                width: a.width || 0,
                height: a.height || 0,
                createdAt: a.createdAt,
                updatedAt: a.updatedAt,
                dataUrl
            });
        }

        const backup = {
            format: 'anima-artlab-backup',
            version: 1,
            exportedAt: new Date().toISOString(),
            presetsCount: presets.length,
            assetsCount: serializedAssets.length,
            presets,
            assets: serializedAssets
        };

        const jsonStr = JSON.stringify(backup, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `anima-artlab-backup-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        return backup;
    }

    async function importBackup(payload) {
        if (!payload || !Array.isArray(payload.presets) || !Array.isArray(payload.assets)) {
            throw new Error('Invalid Anima Art Lab backup file format.');
        }
        const db = await openDB();

        // 1. Import assets
        let importedAssets = 0;
        for (const a of payload.assets) {
            if (!a.id) continue;
            let blob = null;
            if (a.dataUrl) {
                try {
                    const res = await fetch(a.dataUrl);
                    blob = await res.blob();
                } catch (e) {
                    console.warn('Could not decode dataUrl for asset:', a.id, e);
                }
            }
            const existing = await getAsset(a.id);
            if (existing) {
                if (a.savedInLibrary) existing.savedInLibrary = true;
                if (a.libraryName) existing.libraryName = a.libraryName;
                if (blob && !existing.blob) existing.blob = blob;
                await new Promise((res, rej) => {
                    const tx = db.transaction(ASSETS_STORE, 'readwrite');
                    tx.objectStore(ASSETS_STORE).put(existing);
                    tx.oncomplete = () => res(true);
                    tx.onerror = () => rej(tx.error);
                });
            } else if (blob) {
                const rec = {
                    id: a.id,
                    name: a.name || 'image',
                    libraryName: a.libraryName || a.name || 'image',
                    savedInLibrary: !!a.savedInLibrary,
                    type: a.type || blob.type || 'image/png',
                    blob: blob,
                    width: a.width || 0,
                    height: a.height || 0,
                    createdAt: a.createdAt || Date.now(),
                    updatedAt: a.updatedAt || Date.now()
                };
                await new Promise((res, rej) => {
                    const tx = db.transaction(ASSETS_STORE, 'readwrite');
                    tx.objectStore(ASSETS_STORE).put(rec);
                    tx.oncomplete = () => res(true);
                    tx.onerror = () => rej(tx.error);
                });
                importedAssets++;
            }
        }

        // 2. Import presets (non-destructive, merge by id)
        let importedPresets = 0;
        for (const p of payload.presets) {
            if (!p.id || !p.scene) continue;
            const existing = await getPreset(p.id);
            if (!existing) {
                await new Promise((res, rej) => {
                    const tx = db.transaction(PRESETS_STORE, 'readwrite');
                    tx.objectStore(PRESETS_STORE).put(p);
                    tx.oncomplete = () => res(true);
                    tx.onerror = () => rej(tx.error);
                });
                importedPresets++;
            }
        }

        return { importedPresets, importedAssets, totalPresets: payload.presets.length, totalAssets: payload.assets.length };
    }

    async function restorePreset(id, currentScene) {
        const db = await openDB();
        const record = await getPreset(id);
        if (!record) throw new Error('Preset not found: ' + id);

        const storageToMemoryId = new Map();
        for (const [memId, rec] of ImageArtEngine.assets.entries()) {
            if (rec.storageId) {
                storageToMemoryId.set(rec.storageId, memId);
            }
        }

        // Load any assets not yet in memory from IndexedDB
        for (const sId of (record.assetIds || [])) {
            if (!storageToMemoryId.has(sId)) {
                let assetRec = await new Promise((res, rej) => {
                    const tx = db.transaction(ASSETS_STORE, 'readonly');
                    const req = tx.objectStore(ASSETS_STORE).get(sId);
                    req.onsuccess = () => res(req.result || null);
                    req.onerror = () => rej(tx.error);
                });
                if ((!assetRec || !assetRec.blob) && typeof window !== 'undefined' && Array.isArray(window.AnimaBundledImages)) {
                    const b = window.AnimaBundledImages.find(x => x.id === sId);
                    if (b && b.dataUrl) {
                        const r = await fetch(b.dataUrl);
                        assetRec = { id: b.id, name: b.name, blob: await r.blob() };
                    }
                }
                if (!assetRec || !assetRec.blob) {
                    throw new Error('Image asset could not be retrieved from storage for: ' + sId);
                }
                const memRec = await ImageArtEngine.importFile(assetRec.blob);
                if (assetRec.libraryName || assetRec.name) memRec.name = assetRec.libraryName || assetRec.name;
                memRec.storageId = sId;
                storageToMemoryId.set(sId, memRec.id);
            }
        }

        // Reconstruct scene settings
        const sc = record.scene;
        currentScene.folds = sc.folds;
        currentScene.motionMultiplier = sc.motionMultiplier;
        currentScene.light = Object.assign({}, sc.light);
        if (currentScene.light && currentScene.light.preset && window.World) {
            World.setActiveRGB(currentScene.light.preset);
        }

        // Release old runtime projections to free memory
        for (const rt of currentScene.layers) {
            LabCompositor.release(rt);
        }
        currentScene.layers = [];

        // Build new layer runtimes
        for (const lspec of sc.layers) {
            const spec = JSON.parse(JSON.stringify(lspec));
            if (spec.image && spec.image.storageId) {
                const memId = storageToMemoryId.get(spec.image.storageId);
                if (memId) spec.image.assetId = memId;
            }
            const rt = LabCompositor.makeRuntime(spec);
            currentScene.layers.push(rt);
        }

        return record;
    }

    return {
        openDB,
        hashBlob,
        storeAsset,
        getAsset,
        getAllAssets,
        getAllPresets,
        getPreset,
        savePreset,
        updatePreset,
        renamePreset,
        deletePreset,
        restorePreset,
        saveImageToLibrary,
        getSavedImages,
        renameLibraryImage,
        removeLibraryImage,
        exportBackup,
        importBackup
    };
})();

if (typeof window !== 'undefined') {
    window.ImagePresets = ImagePresets;
}
