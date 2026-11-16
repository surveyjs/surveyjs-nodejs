// Serialize schema writes and keep the newest browser edits separate from the saved version
export function createSchemaSaver(getDefinition, write, onState) {
  let saved;
  let pending = 0;
  let error = null;
  let tail = Promise.resolve();
  const snapshot = () => JSON.stringify(getDefinition());
  function publish() {
    const dirty = snapshot() !== saved;
    onState({ state: pending ? "saving" : !dirty ? "saved" : error ? "error" : "unsaved", dirty, error });
  }
  function save() {
    const json = snapshot();
    pending++;
    error = null;
    publish();
    const task = tail.then(async () => {
      if (json !== saved) {
        await write(json);
        saved = json;
      }
      error = null;
      return true;
    }).catch(reason => {
      error = reason.message || "Couldn't save the form schema. Please try again.";
      return false;
    }).finally(() => { pending--; publish(); });
    tail = task.then(() => undefined);
    return task;
  }
  return {
    save,
    changed() { error = null; publish(); },
    markSaved() { saved = snapshot(); error = null; publish(); },
    get dirty() { return snapshot() !== saved; },
    get error() { return error; },
  };
}

export async function responseError(response, fallback) {
  const report = await response.json().catch(() => null);
  return new Error(report?.error || report?.errors?.map(error => error.message || error.text).filter(Boolean).join("; ") || fallback);
}
