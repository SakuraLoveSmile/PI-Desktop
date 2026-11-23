/** Folders in a platform's user area that belong to everyone rather than to one person, so none of them is a home. */
const SHARED_USER_FOLDERS = new Set(["Shared", "Public", "Default", "All Users"]);
const HOME_PREFIX = /^(?:\/(?:Users|home)\/([^/]+)|[A-Za-z]:[\\/]Users[\\/]([^\\/]+))(?=[\\/]|$)/;

/** The part of a path that is a person's home folder, when it lies in one: `/Users/<name>`, `/home/<name>` or `<drive>:\Users\<name>`. */
function homePrefix(path: string): string | undefined {
  const match = HOME_PREFIX.exec(path);
  const name = match?.[1] ?? match?.[2];
  return match && name && !SHARED_USER_FOLDERS.has(name) ? match[0] : undefined;
}

/**
 * A project path as the rail's caption: the last two folders behind an ellipsis, and `~` for the home folder
 * (`~/…/Fork Project/PI-Desktop`). The whole path stays in the row's tooltip. The renderer is not told where the home
 * folder is, so it is recognised by the platform's layout; a path in another account's folder reads with that `~` too.
 */
export function shortProjectPath(path: string): string {
  const separator = path.includes("/") ? "/" : "\\";
  const home = homePrefix(path);
  const segments = (home ? path.slice(home.length) : path).split(/[\\/]+/).filter(Boolean);
  const tail = segments.length <= 2 ? segments.join(separator) : `…${separator}${segments.slice(-2).join(separator)}`;
  if (home) return tail ? `~${separator}${tail}` : "~";
  return segments.length <= 2 ? path : tail;
}

/** The folder's own name, for a project the session summary does not name. */
export function projectFolderName(path: string): string {
  return path.split(/[\\/]+/).filter(Boolean).at(-1) ?? path;
}
