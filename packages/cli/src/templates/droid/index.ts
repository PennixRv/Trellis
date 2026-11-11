/**
 * Factory Droid templates
 *
 * These are GENERIC templates for user projects.
 *
 * Directory structure:
 *   droid/
 *   ├── droids/         # Multi-agent pipeline droids (agents)
 *   └── settings.json   # Settings configuration
 */

import { createTemplateReader, type HookTemplate } from "../template-utils.js";
export type { HookTemplate };

const { getSettings } = createTemplateReader(import.meta.url);
export const getSettingsTemplate = (): HookTemplate => getSettings();
