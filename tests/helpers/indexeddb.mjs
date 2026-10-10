// Deterministic transaction mock: requests run serially, data becomes visible
// only on transaction completion, and readwrite transactions reserve the store.
export function mockIndexedDB() {
  const stores = new Map();
  let tail = Promise.resolve();
  let nextFailure = null;
  const database = {
    objectStoreNames: { contains: name => stores.has(name) },
    createObjectStore(name, options = {}) { stores.set(name, { keyPath: options.keyPath, data: new Map() }); },
    close() {},
    transaction(name, mode) {
      const source = stores.get(name);
      let local;
      let pending = 0;
      let active = false;
      let finished = false;
      let release;
      const reserved = new Promise(resolve => { release = resolve; });
      const previous = tail;
      tail = reserved;
      const tasks = [];
      const tx = {
        error: null,
        abort() { if (!finished) { finished = true; tx.onabort?.(); release(); } },
        objectStore() {
          function request(operation) {
            const req = {};
            pending += 1;
            const run = () => setTimeout(() => {
              if (finished) return;
              req.result = operation();
              req.onsuccess?.();
              pending -= 1;
              complete();
            }, 0);
            if (active) run(); else tasks.push(run);
            return req;
          }
          return {
            get: key => request(() => local.get(key)),
            getAll: () => request(() => [...local.values()]),
            put: (value, key) => request(() => { local.set(key ?? value[source.keyPath], structuredClone(value)); return key; }),
            delete: key => request(() => local.delete(key))
          };
        }
      };
      function complete() {
        if (pending || finished) return;
        setTimeout(() => {
          if (pending || finished) return;
          if (mode === "readwrite" && nextFailure) {
            tx.error = nextFailure;
            nextFailure = null;
            tx.abort();
            return;
          }
          finished = true;
          if (mode === "readwrite") source.data = local;
          tx.oncomplete?.();
          release();
        }, 0);
      }
      previous.then(() => {
        active = true;
        local = new Map(source.data);
        tasks.forEach(run => run());
        complete();
      });
      return tx;
    }
  };
  return {
    stores,
    failNextCommit(error = new Error("模拟磁盘事务失败")) { nextFailure = error; },
    open() {
      const request = {};
      setTimeout(() => {
        request.result = database;
        request.onupgradeneeded?.();
        request.onsuccess?.();
      }, 0);
      return request;
    }
  };
}
