// SPDX-License-Identifier: MIT

/**
 * Fired on `window` after the settings dialog stores a preference, so viewers
 * that are already open can repaint with it without being rebuilt.
 */
export const SETTINGS_CHANGED = 'seam:settings-changed'
