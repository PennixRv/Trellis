/**
 * Qoder templates
 *
 * These are GENERIC templates for user projects.
 *
 * Directory structure:
 *   qoder/
 *   ├── agents/         # Multi-agent pipeline agents
 *   └── settings.json   # Settings configuration
 */

import { createTemplateReader, type HookTemplate } from "../template-utils.js";
export type { HookTemplate };

const { getSettings } = createTemplateReader(import.meta.url);
export const getSettingsTemplate = (): HookTemplate => getSettings();
