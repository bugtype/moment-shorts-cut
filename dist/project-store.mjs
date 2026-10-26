// One connection and a serialized write queue; audio changes don't rewrite large videos.
export function createProjectStore(factory = globalThis.indexedDB) {
  let connection, queue = Promise.resolve();
  let stored = new Map();
  function open() {
    if (!connection) connection = new Promise((resolve, reject) => {
      const request = factory.open('moment-studio', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('project');
      request.onsuccess = () => {
        const db = request.result, owner = connection;
        const invalidate = () => {
          if (connection !== owner) return;
          connection = null;
          // Late transactions may still finish, but must not refill the next connection's cache.
          stored = new Map();
        };
        db.onversionchange = () => { db.close(); invalidate(); };
        db.onclose = invalidate;
        resolve(db);
      };
      request.onerror = () => { connection = null; reject(request.error); };
    }).catch(error => { connection = null; throw error; });
    return connection;
  }
  async function get(key) {
    const db = await open(), cache = stored;
    return new Promise((resolve, reject) => {
      const request = db.transaction('project').objectStore('project').get(key);
      request.onsuccess = () => { cache.set(key, request.result || null); resolve(request.result); };
      request.onerror = () => reject(request.error);
    });
  }
  function setMedia(video, audio) {
    const requested = [['video', video], ['audio', audio]];
    queue = queue.catch(() => {}).then(async () => {
      // Earlier queued writes may have failed; compare only after they settle.
      const db = await open(), cache = stored;
      const changed = requested.filter(([key, value]) => !cache.has(key) || cache.get(key) !== value);
      if (!changed.length) return;
      return new Promise((resolve, reject) => {
        const tx = db.transaction('project', 'readwrite');
        tx.oncomplete = () => { changed.forEach(([key, value]) => cache.set(key, value)); resolve(); };
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('Media storage failed'));
        try {
          const store = tx.objectStore('project');
          changed.forEach(([key, value]) => value ? store.put(value, key) : store.delete(key));
        } catch (error) {
          // Promise rejection alone does not cancel requests already queued.
          try { tx.abort(); } finally { reject(error); }
        }
      });
    });
    return queue;
  }
  function hasStoredMedia(video, audio) {
    // Confirm attached files only; metadata-only projects need no media connection.
    return (!video || stored.get('video') === video) && (!audio || stored.get('audio') === audio);
  }
  return { get, setMedia, hasStoredMedia };
}
