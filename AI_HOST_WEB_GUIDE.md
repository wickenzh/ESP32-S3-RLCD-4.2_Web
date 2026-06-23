# WeatherClock Host Web AI Guide

This document is for future AI agents or developers taking over `host_web/`.

## Scope

Work in this branch is limited to `host_web/`.

Do not modify firmware, root docs, release scripts, or project README unless the user explicitly changes the scope. Publish `host_web/` contents to the dedicated GitHub Pages repository `wickenzh/ESP32-S3-RLCD-4.2_Web`.

## Product Focus

The host web app is mainly a browser-based resource tool for WeatherClock:

- Convert a user GIF into the device main-page GIF resource.
- Convert user still images into gallery-page image resources.
- Preview converted 1-bit results before writing.
- Build `custom_assets.bin`.
- Write `custom_assets.bin` to the ESP32-S3 `assets` flash partition.

Firmware flashing and serial logs exist only as auxiliary tools.

## Device Resource Format

The firmware reads a custom asset package from the `assets` partition:

- Partition name: `assets`
- Offset: `0xC20000`
- Size: `2M`
- Package filename used by the app: `custom_assets.bin`

Package magic/version:

- Magic: `WCA1`, little-endian `0x31414357`
- Version: `1`

Supported entry types:

- `1`: `main_gif`
  - Fixed size: `84 x 84`
  - Fixed frames: `60`
  - Continuous full-frame 1-bit bitstream. Do not pad each row.
  - Frame size: `84 * 84 / 8 = 882` bytes.
  - Total payload size: `882 * 60 = 52920` bytes.
  - `bytes_per_row` should be `0`; firmware does not use row stride for GIF.
- `2`: `gallery_image`
  - Fixed size: `220 x 208`
  - Up to `24` images.
  - Packed 1-bit rows.
  - Row stride: `ceil(220 / 8) = 28` bytes.
  - Payload size per image: `28 * 208 = 5824` bytes.

The browser app builds the header, entry table, payload, header CRC32, payload CRC32, and per-entry CRC32 in `host_web/app.js`.

## Current UI

The app has four tabs:

- `资源制作`: Primary tab and default view. Handles GIF and still-image conversion.
- `资源写入`: Selects a Web Serial device, reads the ESP-IDF partition table from `0x8000`, verifies the `assets` partition, then writes generated `custom_assets.bin` to `0xC20000` over Web Serial / esptool-js.
- `固件烧录`: Auxiliary full merged-bin flashing from `0x0`; defaults to Cloudflare Worker `versions.json`, uses each item's `merged.url` for serial full flashing, keeps `app.url` available for OTA upgrade flows, and verifies SHA-256 before any follow-up action.
- `串口日志`: Auxiliary serial log and manual command console.

Do not reintroduce Wi-Fi provisioning, default AP/IP panels, device info sidebars, OTA manifest reading, or notes pages unless the user asks.

All baud-rate selectors currently default to `115200`.

Update the footer version in `index.html` on every user-visible development change.

## GitHub Pages Preview

Use the deployed GitHub Pages URL for preview and testing:

```text
https://wickenzh.github.io/ESP32-S3-RLCD-4.2_Web/
```

Do not add local HTTP/HTTPS preview servers back into `host_web/` unless the user explicitly asks.

## Important Files

- `index.html`: Static UI structure.
- `styles.css`: Layout and visual styling.
- `app.js`: All client-side conversion, package building, serial writing, and flashing logic.
- `firmware/manifest.example.json`: Example ESP Web Tools manifest for dedicated Pages deployment.
- `README.md`: User-facing usage/deployment summary.

## Known Constraints

- GIF decoding first uses the local parser in `app.js`, including global/local palettes, transparency, interlaced frames, and GIF disposal modes. Keep this local path so conversion preview works on intranet Gitea/GitHub Pages without a runtime CDN dependency.
- If local GIF decoding fails, the app tries the browser `ImageDecoder` API, then falls back to a single-frame image preview repeated across 60 frames.
- GIF conversion must output exactly 60 frames. The local decoder samples those frames evenly across the full GIF playback timeline using frame delays, so long animations are represented from start to end instead of only taking the first 60 source frames.
- Converted GIF preview is animated by replaying the 60 converted 1-bit frames on the preview canvas.
- Original GIF preview uses a normal `<img>` element with an object URL, so the uploaded GIF should animate before conversion.
- File selection immediately draws the uploaded GIF first frame or the currently selected still image on the source canvas so users can see what was loaded before conversion.
- Still images support selecting up to 24 files and converting them together. The preview selector shows one chosen image at a time; the converted preview is reconstructed from that image's packed 1-bit data.
- Still image conversion applies a configurable edge fade before 1-bit packing. The default is 18 px and blends the four edges toward white so non-transparent image backgrounds do not leave a hard rectangle on the device screen.
- The resource writer's erase action writes an erased 4 KB sector header (`0xFF`) at `0xC20000`, invalidating the custom asset package so firmware falls back to built-in resources after reset.
- Web Serial and browser flashing need Chrome/Edge or another Chromium browser with serial support.
- The serial writing path relies on loading `esptool-js` from a CDN. Dedicated offline support would require vendoring the dependency in `host_web/`. `esptool-js` expects file data as a binary string, so `Uint8Array` payloads are converted before calling `writeFlash`.
- After `writeFlash`, the app explicitly pulses serial RTS/DTR signals to reset the ESP32-S3. Keep this behavior unless hardware reset wiring changes.
- The resource writer must keep the partition-table preflight: read flash `0x8000..0x8FFF`, parse 32-byte ESP-IDF partition entries, and only enable resource write/erase after finding `assets` at `0xC20000` with at least `2M`.
- Firmware flashing must not read GitHub Release, scan GitHub repository files, or directly access the private R2 Bucket. It prioritizes `https://rlcd-update.wickenzh.workers.dev/firmware/versions.json`, displays the recent `items`, validates that each fully usable item has both `app` and `merged` entries with `url`, `sha256`, and `size`, downloads `merged.url` for serial full flashing, and verifies SHA-256 with Web Crypto before enabling flashing. If size or SHA-256 verification fails, clear the downloaded in-memory data and require the user to download again. If `versions.json` is temporarily unavailable, the app may fall back to `latest.json` only to display the latest OTA app package; do not enable serial full flashing from that fallback unless merged metadata is present and verified.
