/** Main-session platform assets and native context entry points. */

import { createTemplateReader } from "../template-utils.js";

const { getConfig } = createTemplateReader(import.meta.url);
export const getSettingsTemplate = (): string => getConfig("settings.json");
