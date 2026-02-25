# Asset Provenance and Redistribution Notes

Audit scope: files under `client/public/` for public repository release.

Audit date: 2026-02-25

## Third-Party Assets (Redistribution Confirmed)

### `fonts/Inter_Bold.json`

- Source: Inter font project (`https://github.com/rsms/inter`)
- Embedded metadata includes:
  - Designer: Rasmus Andersson
  - License: SIL Open Font License 1.1 (`http://scripts.sil.org/OFL`)
- Attribution fulfillment: this file + embedded metadata.

### `models/sillyNubCat.glb`

- Source: Sketchfab (`https://sketchfab.com/3d-models/silly-nub-cat-meme-ab10748f81b64e658585da67fd3c1b00`)
- Creator page: `https://sketchfab.com/sillynub`
- Embedded license URL: `http://creativecommons.org/licenses/by/4.0/`
- License: CC-BY-4.0
- Attribution fulfillment: this file.

## Removed Assets (Redistribution Unclear)

### `animations/nubcat_walking.fbx`

- Reason removed: embedded `mixamo.com` markers with no clear redistributable-source grant for shipping raw FBX in this public repo.
- Removed from repository on 2026-02-25.

## Project-Maintained Assets (Repository Copyright Holder)

The following groups are treated as project-maintained assets and distributed under the repository license:

- `animations/M_*.glb`
- `audio/**/*.ogg`
- `models/{Apartment,BackgroundBuilding,Shop,Skyscraper,SmallBuilding,Tablet,TownHall}.glb`
- `models/items/*.glb`
- `models/Textures/colormap.png`
- `textures/venice_sunset_1k.hdr`
- `favicon.ico`

Audit evidence used:

- All current files under `client/public/` were first added in commit `80a7806` (see repository history for authorship metadata).
- Binary string scan found third-party URLs only in `fonts/Inter_Bold.json` and `models/sillyNubCat.glb`.

## Release Gate Status

- Third-party assets with identifiable upstream metadata are documented above.
- Unclear-redistribution asset (`nubcat_walking.fbx`) was removed.
- No additional third-party URL metadata detected in remaining `client/public/` assets.
