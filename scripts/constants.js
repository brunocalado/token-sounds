/**
 * Single source of truth for the module id.
 * Must mirror the `id` field in module.json verbatim.
 * @type {string}
 */
export const MODULE_ID = "token-sounds";

/**
 * File extensions accepted when expanding a folder source into a pool of audio files
 * for non-repeat random playback. Match is case-insensitive at use sites.
 * @type {string[]}
 */
export const AUDIO_EXTENSIONS = [".mp3", ".ogg", ".wav"];
