import { MODULE_ID } from "./constants.js";

/**
 * Entry point invoked from the soundboard "add" / right-click handlers.
 * @param {object} data Initial sound payload, possibly empty.
 * @param {Actor|TokenDocument} dataSource Holds the `sounds` flag the sheet writes back to.
 * @param {boolean} [create=true]
 * @returns {Promise<foundry.applications.api.ApplicationV2>}
 */
export async function openCustomConfig(data, dataSource, create = true) {
  return new AmbientSoundCustomConfig(data, dataSource, create).render(true);
}

/**
 * Custom AppV2 sound configuration sheet. We reuse the core AmbientSoundConfig and inject
 * three extra fields (icon, description, repeat) plus our own submit/remove actions, so the
 * data persists onto the actor's `flags.<MODULE_ID>.sounds` map rather than as a scene-level
 * AmbientSound document.
 */
class AmbientSoundCustomConfig extends foundry.applications.sheets.AmbientSoundConfig {
  static DEFAULT_OPTIONS = {
    classes: [MODULE_ID],
    actions: {
      sotSubmit: AmbientSoundCustomConfig.submit,
      sotRemove: AmbientSoundCustomConfig.remove,
    },
  };

  constructor(data, dataSource, create = true) {
    const AmbientSoundDocCls = foundry.documents.AmbientSoundDocument;
    const sound = new AmbientSoundDocCls(foundry.utils.deepClone(data), { parent: canvas.scene });
    super({ document: sound });
    this.create = create;
    this.soundData = data;
    this.dataSource = dataSource;
  }

  /** @override */
  get isEditable() {
    // The core sheet would deny player edits; the module gates this through `allowPlayerEdit`
    // on the actor itself, so we always allow editing once the sheet is open.
    return true;
  }

  /**
   * Persist the form payload onto the actor's sounds map.
   * Action handler — `this` is the application instance.
   */
  static async submit() {
    const formData = this._getSubmitData();
    const update = { [`flags.${MODULE_ID}.sounds.${formData.soundId}`]: foundry.utils.expandObject(formData) };
    this.dataSource.update(update);
  }

  /**
   * Delete the sound from the actor's sounds map.
   * Action handler — `this` is the application instance.
   */
  static async remove() {
    const formData = this._getSubmitData();
    const update = { [`flags.${MODULE_ID}.sounds.${formData.soundId}`]: foundry.data.operators.ForcedDeletion };
    this.dataSource.update(update);
  }

  get isVisible() {
    return true;
  }

  get title() {
    return this.create ? "Create New Sound" : "Update Sound";
  }

  get id() {
    return `ambient-sound-custom-config-${this.document.id}`;
  }

  /** @override */
  _onRender(...args) {
    // The sheet is repurposed: x/y are positional fields the actor-level flag does not need.
    this.element.querySelectorAll('[name="x"], [name="y"]').forEach((el) => el.closest(".form-group").remove());

    this.insertAdditionalControls();

    this.element.querySelector('.file-picker[data-target="img"]').addEventListener("click", () => {
      const FilePickerClass = foundry.applications.apps.FilePicker.implementation ?? foundry.applications.apps.FilePicker;
      new FilePickerClass({
        type: "image",
        callback: (path) => {
          const el = this.element.querySelector('[name="img"]');
          el.value = path;
          el.dispatchEvent(new Event("change"));
        },
      }).render();
    });

    return super._onRender(...args);
  }

  /** @override */
  async _onSubmitForm(formConfig, event) {
    // Suppress the default submit path: the sotSubmit / sotRemove actions are the real entry points.
    event.preventDefault();
    await this.close({ submitted: true });
  }

  /**
   * Read the current form values as an expanded object.
   * @returns {object}
   */
  _getSubmitData() {
    const form = this.element;
    const formData = new foundry.applications.ux.FormDataExtended(form);
    return foundry.utils.expandObject(formData.object);
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    const buttons = [];
    if (this.create) {
      buttons.push({ type: "submit", icon: "far fa-save", label: "Create", action: "sotSubmit" });
    } else {
      buttons.push({ type: "submit", icon: "far fa-save", label: "Update", action: "sotSubmit" });
      buttons.push({ type: "submit", icon: "far fa-trash", label: "Remove", action: "sotRemove" });
    }

    context.buttons = buttons;
    return context;
  }

  /**
   * Inject the icon / description / repeat fields above the core form. Runs once per render.
   */
  insertAdditionalControls() {
    const icon = this.soundData.img ?? "icons/svg/sound.svg";
    const soundId = this.soundData.soundId ?? foundry.utils.randomID();
    const description = this.soundData.description ?? "";
    const repeat = this.soundData.repeat;

    const standardForm = this.element.querySelector(".standard-form");
    standardForm.insertAdjacentHTML(
      "afterbegin",
      `
      <fieldset>
        <legend>Sound of Token</legend>
        <input type="text" name="soundId" value="${soundId}" hidden>
        <div class="form-group">
          <label>Icon</label>
          <div class="form-fields">
            <input type="text" name="img" value="${icon}">
            <button type="button" class="file-picker" data-type="image" data-target="img" title="Browse Files" tabindex="-1"><i class="fas fa-file-import fa-fw"></i></button>
          </div>
        </div>
        <div class="form-group">
          <label>Description</label>
          <div class="form-fields">
            <input type="text" name="description" value="${description}">
          </div>
        </div>
        <div class="form-group">
          <label>Repeat</label>
          <div class="form-fields">
            <input type="checkbox" name="repeat" data-dtype="Boolean" ${repeat ? "checked" : ""}>
          </div>
        </div>
      </fieldset>
    `,
    );
  }
}
