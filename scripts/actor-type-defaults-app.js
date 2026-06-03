import { MODULE_ID } from "./constants.js";
import { openSoundConfig } from "./sound-config.js";

/**
 * Thin proxy that makes game.settings behave like an Actor Document for SoundConfigSheet.
 * Reads/writes the `actorTypeDefaults` world setting under the given actorType key.
 */
class ActorTypeDefaultsProxy {
  /**
   * @param {string} actorType
   * @param {ActorTypeDefaultsApp} app
   */
  constructor(actorType, app) {
    this._actorType = actorType;
    this._app = app;
  }

  /**
   * Mimics Actor#getFlag for the "sounds" key so SoundConfigSheet can read existing data.
   * @param {string} moduleId
   * @param {string} key
   * @returns {object|undefined}
   */
  getFlag(moduleId, key) {
    if (moduleId !== MODULE_ID || key !== "sounds") return undefined;
    return (game.settings.get(MODULE_ID, "actorTypeDefaults") ?? {})[this._actorType] ?? {};
  }

  /**
   * Mimics Actor#update. Parses SoundConfigSheet's flat dot-notation payload
   * ("flags.token-sounds.sounds.<soundId>.<field>") into the settings object.
   * @param {object} data Flat update object from SoundConfigSheet.
   * @returns {Promise<void>}
   */
  async update(data) {
    const all = foundry.utils.deepClone(game.settings.get(MODULE_ID, "actorTypeDefaults") ?? {});
    if (!all[this._actorType]) all[this._actorType] = {};

    const prefix = `flags.${MODULE_ID}.sounds.`;
    for (const [key, value] of Object.entries(data)) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const dot = rest.indexOf(".");
      if (dot === -1) continue;
      const soundId = rest.slice(0, dot);
      const field = rest.slice(dot + 1);
      if (!all[this._actorType][soundId]) all[this._actorType][soundId] = {};
      all[this._actorType][soundId][field] = value;
    }

    await game.settings.set(MODULE_ID, "actorTypeDefaults", all);
    this._app?.render();
  }

  /**
   * Mimics Actor#unsetFlag. Removes a sound entry from the type's defaults.
   * @param {string} moduleId
   * @param {string} path "sounds.<soundId>"
   * @returns {Promise<void>}
   */
  async unsetFlag(moduleId, path) {
    if (moduleId !== MODULE_ID) return;
    const match = path.match(/^sounds\.(.+)$/);
    if (!match) return;
    const soundId = match[1];

    const all = foundry.utils.deepClone(game.settings.get(MODULE_ID, "actorTypeDefaults") ?? {});
    if (all[this._actorType]) {
      delete all[this._actorType][soundId];
      await game.settings.set(MODULE_ID, "actorTypeDefaults", all);
    }
    this._app?.render();
  }
}

/**
 * ApplicationV2 for managing default soundboards per actor type.
 * Opened from the module's settings menu entry. Shows one section per registered
 * actor type; each section mirrors the HUD soundboard with add/right-click-edit support.
 */
export class ActorTypeDefaultsApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-actor-type-defaults`,
    classes: [MODULE_ID, "actor-type-defaults"],
    window: { title: "Default Sounds by Actor Type", resizable: true },
    position: { width: 560, height: 620 },
    actions: {
      addSound: ActorTypeDefaultsApp.#onAddSound,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/actor-type-defaults.hbs` },
  };

  /**
   * Build context for each registered actor type, skipping the internal "base" type.
   * @override
   * @returns {Promise<object>}
   */
  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const defaults = game.settings.get(MODULE_ID, "actorTypeDefaults") ?? {};
    const actorTypes = (game.documentTypes?.Actor ?? []).filter((t) => t !== "base");

    const types = actorTypes.map((type) => {
      const rawLabel = CONFIG.Actor?.typeLabels?.[type] ?? type;
      const label = game.i18n.has(rawLabel) ? game.i18n.localize(rawLabel) : type;
      const sounds = Object.values(foundry.utils.deepClone(defaults[type] ?? {})).sort(
        (a, b) => (a.sort ?? 0) - (b.sort ?? 0),
      );
      sounds.forEach((s) => { if (!s.img) s.img = "icons/svg/sound.svg"; });
      return { type, label, sounds };
    });

    return { ...ctx, types };
  }

  /**
   * Attach right-click listeners for in-place editing of default sound tiles.
   * @override
   */
  _onRender(context, options) {
    super._onRender?.(context, options);
    this.element.querySelectorAll(".default-sound-tile").forEach((el) => {
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.#editSound(e.currentTarget);
      });
    });
  }

  /**
   * Open SoundConfigSheet in create mode for the targeted actor type.
   * Called via data-action="addSound" on the per-type add button.
   * @param {Event} _event
   * @param {HTMLElement} target
   */
  static #onAddSound(_event, target) {
    const actorType = target.closest("[data-actor-type]")?.dataset.actorType;
    if (!actorType) return;
    openSoundConfig({}, new ActorTypeDefaultsProxy(actorType, this), true);
  }

  /**
   * Open SoundConfigSheet in edit mode for an existing default sound tile.
   * @param {HTMLElement} tile
   */
  #editSound(tile) {
    const actorType = tile.closest("[data-actor-type]")?.dataset.actorType;
    const soundId = tile.dataset.soundId;
    if (!(actorType && soundId)) return;

    const sound = ((game.settings.get(MODULE_ID, "actorTypeDefaults") ?? {})[actorType] ?? {})[soundId];
    if (sound) openSoundConfig(sound, new ActorTypeDefaultsProxy(actorType, this), false);
  }
}
