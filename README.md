# Token Audio FX

A Foundry VTT module that lets you attach sounds to tokens and play them directly from the Token HUD. Assign ambient music, creature growls, or any audio effect to an Actor, then trigger it with a single click during your session.

Requires **Foundry VTT v14** or later. A GM must be online for sounds to play.

---

## How It Works

Each Actor can have a personal **soundboard** — a list of audio clips you configure in advance. When a token is on the canvas, clicking its HUD button opens that soundboard as a row of tiles. Click a tile to play the sound; click it again to stop.

Sounds come in two modes that behave very differently:

### Repeat

A **Repeat** sound loops continuously until you turn it off. When activated, the module creates an invisible AmbientSound object at the token's position and keeps it anchored there as the token moves. The sound respects wall occlusion — players on the other side of a wall may hear it muffled or not at all, just like any other ambient sound in Foundry.

Use repeat sounds for:
- Ongoing ambience tied to a creature (a dragon's rumble, a ghost's wail)
- Background music following a specific character
- Any effect that should persist until manually stopped

### Single (One-Shot)

A **Single** sound plays once from start to finish and then stops on its own. No AmbientSound object is created — the audio is played directly by every client whose tokens are within the sound's radius at the moment you click. When the clip ends, the soundboard tile resets automatically.

Use single sounds for:
- A roar, a spell cast, a door creak — anything that happens once
- Sound effects triggered by player actions

**Folder mode** is available for single sounds only: instead of picking one specific file, you point the sound at a folder and the module picks a random audio file from it each time the tile is clicked.

---

## Setting Up Sounds

1. Select a token and open its **Token HUD** (right-click the token).
2. Click the **Token Audio FX** button (speaker icon) to open the soundboard panel.
3. Click the **+** button at the bottom of the panel to add a new sound.
4. Fill in the configuration form:
   - **Description** — a label shown on the soundboard tile.
   - **Icon** — an optional image for the tile.
   - **Source** — choose *Single sound* to pick one audio file, or *Random from folder* (single mode only) to pick a folder.
   - **Audio / Folder** — path to the file or folder.
   - **Volume** — playback volume (0 – 100%).
   - **Radius** — how far the sound travels, in grid units.
   - **Walls** — whether walls block the sound (repeat mode only).
   - **Repeat** — toggle this on for a looping ambient sound, leave it off for a one-shot.
5. Save the form. The tile appears in the soundboard immediately.

Sounds configured on an **Actor** are shared across all tokens linked to that actor. Sounds configured directly on an **unlinked token** belong only to that token.

---

## Playing and Stopping Sounds

Open the Token HUD and click the Token Audio FX button to reveal the soundboard.

- **Click a tile** to start the sound.
- **Click the same tile again** to stop it (repeat sounds only — single sounds stop on their own).
- A tile with a pulsing icon indicates an active repeat sound.

---

## Player Permissions

By default, players can trigger sounds on tokens they own but cannot create or edit the sound list. A GM can grant edit access by **right-clicking** the Token Audio FX HUD button on a player's token. This toggles editing mode, allowing that player to add, configure, and remove sounds on their own tokens.

Whenever a player triggers a sound, the request is forwarded to the active GM to process. **At least one GM must be online** for sounds to work.

---

## Module Settings

| Setting | Description |
|---|---|
| **Audio Channel** | Mixer channel used for all module sounds: *Interface*, *Music*, or *Environment* (default). |

---

## API

You can control sounds from macros or other modules via the global `SoundOfToken` object.

```js
// Play the sound named "Growl" on the selected token
SoundOfToken.play(token, "Growl");

// Stop a sound by description
SoundOfToken.stop(token, "Growl");
```

The `token` argument accepts a Token placeable, a `TokenDocument`, a Token ID string, or an `Actor`.

---

## Manual Installation

In Foundry VTT, go to **Add-on Modules → Install Module** and paste the manifest URL:

```
https://raw.githubusercontent.com/brunocalado/token-sounds/main/module.json
```

---

## License

This module is released under the [LICENSE](LICENSE) included in this repository.

Based on [Sound of Token](https://github.com/Aedif/token-sounds) by Aedif.
