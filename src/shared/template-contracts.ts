/**
 * The one renderer/main value contract for a game template file.
 * Filesystem policy and export behavior stay in their process owners.
 */
export interface TemplateExportEntry {
  readonly path: string;
  readonly contents: string;
}
