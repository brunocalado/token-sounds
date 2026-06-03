import { MODULE_ID } from "./constants.js";

/**
 * Typed schema for a single soundboard entry. Stored as a plain object on
 * `actor.flags.<MODULE_ID>.sounds.<soundId>` — the DataModel is used to clean and
 * default form input (via `cleanData`) rather than as a Document, so its instances
 * are not persisted directly.
 */
export class SoundEntry extends foundry.abstract.DataModel {
  static defineSchema() {
    const f = foundry.data.fields;
    return {
      soundId:     new f.StringField({ required: true, blank: false }),
      img:         new f.StringField({ required: false, blank: true, initial: "icons/svg/sound.svg" }),
      name:        new f.StringField({ required: false, blank: true, initial: "", max: 200 }),
      path:        new f.StringField({ required: true, blank: true, initial: "" }),
      sourceMode:  new f.StringField({ required: true, blank: false, choices: ["single", "folder"], initial: "single" }),
      radius:      new f.NumberField({ required: true, min: 0, initial: 30 }),
      volume:      new f.NumberField({ required: true, min: 0, max: 1, initial: 0.5 }),
      repeat:      new f.BooleanField({ initial: false }),
      walls:       new f.BooleanField({ initial: false }),
      sort:        new f.NumberField({ required: false, integer: true, initial: 0 }),
    };
  }

  static LOCALIZATION_PREFIXES = [`${MODULE_ID.toUpperCase().replace(/-/g, "_")}.SoundEntry`];
}
