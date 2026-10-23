// One connection and a serialized write queue; audio changes don't rewrite large videos.
export function createProjectStore(factory = globalThis.indexedDB) {
  let connection, queue = Promise.resolve();
  const stored = new Map();
  function open() {
    if (!connection) connection = new Promise((resolve, reject) => {
      const request = factory.open('moment-studio', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('project');
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); connection = null; };
        resolve(db);
      };
      request.onerror = () => { connection = null; reject(request.error); };
    }).catch(error => { connection = null; throw error; });
    return connection;
  }
  async function get(key) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const request = db.transaction('project').objectStore('project').get(key);
      request.onsuccess = () => { stored.set(key, request.result || null); resolve(request.result); };
      request.onerror = () => reject(request.error);
    });
  }
  function setMedia(video, audio) {
    const requested = [['video', video], ['audio', audio]];
    queue = queue.catch(() => {}).then(async () => {
      // Earlier queued writes may have failed; compare only after they settle.
      const changed = requested.filter(([key, value]) => !stored.has(key) || stored.get(key) !== value);
      if (!changed.length) return;
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('project', 'readwrite');
        const store = tx.objectStore('project');
        changed.forEach(([key, value]) => value ? store.put(value, key) : store.delete(key));
        tx.oncomplete = () => { changed.forEach(([key, value]) => stored.set(key, value)); resolve(); };
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('Media storage failed'));
      });
    });
    return queue;
  }
  return { get, setMedia };
}
