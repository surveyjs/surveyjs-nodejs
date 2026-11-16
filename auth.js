// The integration's permission hooks. The examples call these and nothing else, so this is where your real checks go.

/**
 * May this user do it? Returns null when allowed, or the denial message the 403 answers (Creator shows it).
 * Saving definitions (creator-load-save, lint-definition) and variable presets is an admin action. Your real
 * permission check goes here: roles, teams, form ownership…
 * @param {{ isEditor: boolean } | null} user req.user
 * @param {"edit-forms"} ability
 */
export function can(user, ability) {
  if (ability === "edit-forms") {
    return user?.isEditor ? null : "You don't have editor rights: only editors can change forms";
  }
  throw new Error(`Unknown ability ${ability}`);
}

/**
 * May this user read this uploaded file (store-files)? A denial answers 404, not 403, so it doesn't confirm that
 * the file exists. Real apps check ownership here, for example file.owner_id === user.id.
 * @param {{ id: number } | null} user
 * @param {{ id: string, name: string, type: string }} file
 */
export function canReadFile(user, file) {
  return user !== null && file !== undefined;
}
