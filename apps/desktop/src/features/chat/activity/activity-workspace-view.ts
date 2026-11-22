/** The last two folders of a project path behind an ellipsis; the whole path stays in the row's tooltip. */
export function shortProjectPath(path: string): string {
  const segments = path.split(/[\\/]+/).filter(Boolean);
  if (segments.length <= 2) return path;
  const separator = path.includes("/") ? "/" : "\\";
  return `…${separator}${segments.slice(-2).join(separator)}`;
}

/** The folder's own name, for a project the session summary does not name. */
export function projectFolderName(path: string): string {
  return path.split(/[\\/]+/).filter(Boolean).at(-1) ?? path;
}
