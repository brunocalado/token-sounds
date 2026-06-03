import { MODULE_ID } from "./constants.js";
import { SoundEntry } from "./sound-data-model.js";

/**
 * Open the module-native sound configuration sheet.
 * @param {object} data Initial sound payload (`{}` when creating).
 * @param {Actor|TokenDocument} dataSource Document whose `flags.<MODULE_ID>.sounds` map the sheet writes to.
 * @param {boolean} [create=true] Whether this is creation (vs editing an existing entry).
 * @returns {Promise<foundry.applications.api.ApplicationV2>}
 */
export async function openSoundConfig(data, dataSource, create = true) {
  return new SoundConfigSheet({ data, dataSource, create }).render(true);
}

/**
 * AppV2 sheet for configuring a single soundboard entry. Replaces the previous
 * extension of core's AmbientSoundConfig: this sheet only exposes fields the module
 * actually uses, with dynamic visibility driven by the `repeat` toggle.
 */
class SoundConfigSheet extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) {
  static DEFAULT_OPTIONS = {
    classes: [MODULE_ID, "sound-config"],
    tag: "form",
    window: { contentClasses: ["standard-form"], resizable: false },
    position: { width: 460, height: "auto" },
    form: {
      handler: SoundConfigSheet.#onSubmit,
      closeOnSubmit: true,
      submitOnChange: false,
    },
    actions: {
      sotRemove: SoundConfigSheet.#onRemove,
      pickImage: SoundConfigSheet.#onPickImage,
      pickSource: SoundConfigSheet.#onPickSource,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/sound-config.hbs` },
  };

  constructor({ data = {}, dataSource, create = true } = {}) {
    const soundId = data.soundId ?? foundry.utils.randomID();
    super({ id: `${MODULE_ID}-sound-config-${soundId}` });
    this.data = foundry.utils.deepClone(data);
    this.dataSource = dataSource;
    this.create = create;
    this.soundId = soundId;
  }

  /** @override */
  get title() { return this.create ? "Create New Sound" : "Update Sound"; }

  /**
   * Build the cleaned payload from saved data + defaults so the template never reads undefined.
   * @override
   */
  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const cleaned = SoundEntry.cleanData({ ...this.data, soundId: this.soundId });
    const pct = Math.round((cleaned.volume ?? 0) * 100);
    return {
      ...ctx,
      data: cleaned,
      create: this.create,
      sourceChoices: { single: "Single sound", folder: "Random from folder" },
      volumePct: `${pct}%`,
    };
  }

  /**
   * Wire change listeners that drive dynamic visibility and volume display. Runs after every render.
   * @override
   */
  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;

    root.querySelector('[name="repeat"]')?.addEventListener("change", () => this.#applyVisibility());
    root.querySelectorAll('[name="sourceMode"]').forEach((el) => {
      el.addEventListener("change", () => this.#applyVisibility());
    });

    const volEl = root.querySelector('[name="volume"]');
    const volDisp = root.querySelector(".volume-display");
    if (volEl && volDisp) {
      volEl.addEventListener("input", () => {
        const pct = Math.round(parseFloat(volEl.value) * 100);
        volDisp.textContent = `${pct}%`;
      });
    }

    this.#applyVisibility();
  }

  /**
   * Toggle the `.hidden` class on groups marked with `data-show-when`, swap the path label
   * and file-picker target based on the current `repeat` and `sourceMode` values.
   */
  #applyVisibility() {
    const root = this.element;
    const repeat = !!root.querySelector('[name="repeat"]')?.checked;
    const sourceModeEl = root.querySelector('[name="sourceMode"]:checked');
    let sourceMode = sourceModeEl?.value ?? "single";

    // Folder mode is non-repeat only: snap the radio back to "single" if the user just enabled repeat.
    if (repeat && sourceMode === "folder") {
      const singleRadio = root.querySelector('[name="sourceMode"][value="single"]');
      if (singleRadio) singleRadio.checked = true;
      sourceMode = "single";
    }

    const isFolder = !repeat && sourceMode === "folder";

    root.querySelectorAll("[data-show-when]").forEach((el) => {
      const cond = el.dataset.showWhen;
      const visible = cond === "repeat" ? repeat : cond === "non-repeat" ? !repeat : true;
      el.classList.toggle("hidden", !visible);
    });

    const pathLabel = root.querySelector(".path-label");
    if (pathLabel) pathLabel.textContent = isFolder ? "Folder (random pick)" : "Audio";

    const pickBtn = root.querySelector('[data-action="pickSource"]');
    if (pickBtn) {
      pickBtn.dataset.pickType = isFolder ? "folder" : "audio";
      pickBtn.title = isFolder ? "Browse Folder" : "Browse Audio";
    }
  }

  /**
   * Form submit action handler. Persists each form field via a dot-notation update so
   * sibling fields (e.g. `sort`) are preserved on the actor's sounds map. `this` is the sheet.
   * @param {SubmitEvent} event
   * @param {HTMLFormElement} form
   * @param {foundry.applications.ux.FormDataExtended} formData
   */
  static async #onSubmit(event, form, formData) {
    const data = formData.object;
    data.soundId = this.soundId;
    // Enforce that folder mode is never persisted on repeat sounds.
    if (data.repeat) data.sourceMode = "single";

    const update = {};
    for (const [k, v] of Object.entries(data)) {
      update[`flags.${MODULE_ID}.sounds.${this.soundId}.${k}`] = v;
    }
    await this.dataSource.update(update);
  }

  /**
   * Remove the current sound entry from the data source. `this` is the sheet.
   * Uses `unsetFlag` with the nested key path: a read-modify-write via `setFlag`
   * would be merged back onto the existing map (Foundry updates are recursive by
   * default), leaving the entry in place. `unsetFlag` is the canonical deletion
   * API, so core applies the build-correct deletion mechanism without emitting
   * the legacy `-=key` deprecation warning.
   */
  static async #onRemove() {
    await this.dataSource.unsetFlag(MODULE_ID, `sounds.${this.soundId}`);
    this.close();
  }

  /**
   * Open a FilePicker for the icon image. `this` is the sheet.
   */
  static async #onPickImage() {
    const FPCls = foundry.applications.apps.FilePicker.implementation ?? foundry.applications.apps.FilePicker;
    new FPCls({
      type: "image",
      callback: (path) => {
        const el = this.element.querySelector('[name="img"]');
        if (!el) return;
        el.value = path;
        el.dispatchEvent(new Event("change"));
      },
    }).render();
  }

  /**
   * Open a FilePicker for the sound source. Type is "audio" for single mode or repeat,
   * and "folder" for non-repeat folder mode. `this` is the sheet.
   * @param {Event} event
   * @param {HTMLElement} target
   */
  static async #onPickSource(event, target) {
    const type = target.dataset.pickType ?? "audio";
    const FPCls = foundry.applications.apps.FilePicker.implementation ?? foundry.applications.apps.FilePicker;
    new FPCls({
      type,
      callback: (path) => {
        const el = this.element.querySelector('[name="path"]');
        if (!el) return;
        el.value = path;
        el.dispatchEvent(new Event("change"));
      },
    }).render();
  }
}
