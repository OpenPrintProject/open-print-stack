# Elegoo Centauri Carbon 2 (+ CANVAS)

Driver notes for the Elegoo Centauri Carbon 2 (CC2) and its CANVAS multi-colour unit, based on research in October 2026. Firmware versions matter: behaviour differs between releases, so the driver should record the printer's firmware version. Anything marked **untested** must be confirmed on a real printer.

## Sources

- **Elegoo's official SDK** (C++, used by ElegooSlicer): https://github.com/ELEGOO-3D/elegoo-link. The CC2 code is in `src/lan/adapters/elegoo_fdm_cc2/`.
- **Firmware method list:** https://github.com/elegooofficial/CentauriCarbon2/blob/main/elegoo/common/method.h
- **Home Assistant integration protocol doc:** https://github.com/danielcherubini/elegoo-homeassistant/blob/main/docs/CC2_PROTOCOL.md (includes a full example status payload)
- **pycentauri protocol doc** (tested on firmware 01.03.02.51 and 02.01.00.00): https://github.com/bjan/pycentauri/blob/main/docs/PROTOCOL.md
- **TypeScript client:** https://github.com/nyakaspeter/elegoo-cc2-webui/blob/main/server/src/cc2/cc2Client.ts
- **elegoo-web:** https://github.com/runnane/elegoo-web
- **Firmware history:** https://docs.opencentauri.cc/software/updates-cc2/
- **Elegoo RFID tag spec:** https://github.com/elegooofficial/ELEGOO-RFID-Tag-Guide

Use these as protocol references. Write our own driver; don't copy code from them without checking its licence.

**The CC2 does not use SDCP.** SDCP (WebSocket on port 3030, UDP discovery on port 3000) is the protocol of the original Centauri Carbon and Elegoo's resin printers.

## Connection

- **Protocol:** MQTT 3.1.1 over TCP port **1883**, using a broker that runs on the printer itself. ElegooSlicer's device page uses MQTT over WebSocket on port 9001.
- **Login:** username `elegoo`. The password is the access code shown on the printer's touchscreen, or `123456` if none is set.
- **LAN Only mode must be on** (printer Settings → Network). In cloud mode the printer talks through Elegoo's cloud instead.
- **No encryption:** all MQTT and HTTP traffic is plain text.

### Registering a session

1. Pick a client ID, e.g. `1_PC_<1000-9999>` (the SDK's format).
2. Subscribe to `elegoo/<sn>/<request_id>/register_response`.
3. Publish `{"client_id": ..., "request_id": ...}` to `elegoo/<sn>/api_register`.
4. Wait for `{"error": "ok"}`. Other replies: `"fail"`, `"too many clients"`.

After registering:

| Topic | Use |
|---|---|
| `elegoo/<sn>/<client_id>/api_request` | Send requests: `{"id": n, "method": <code>, "params": {...}}` |
| `elegoo/<sn>/<client_id>/api_response` | Responses to our requests |
| `elegoo/<sn>/api_status` | Status pushes |

### Heartbeat (required)

- Publish `{"type": "PING"}` to the request topic and expect `{"type": "PONG"}`. Sources suggest every 10–30 seconds, with about a 65-second timeout.
- **Without a heartbeat, the printer quietly drops the registration after a few minutes.** The MQTT connection stays up, but requests stop being answered.

## Discovery (untested)

- **The SDK's method:** send UDP `{"id": 0, "method": 7000}` to port **52700**, as a broadcast or directly to an address.
- **Reply format:** `{"id": 0, "result": {"host_name", "machine_model", "sn", "token_status", "lan_status"}}`. `token_status` 1 means an access code is set; `lan_status` 1 means LAN Only mode is on.
- **Sources disagree:** pycentauri reports that the CC2 ignores broadcast probes.
- **Fallback:** the user enters the printer's IP address. The serial number then comes from method 1001.

## Status

- Status pushes (method 6000) contain **only what changed**. Deep-merge each push into the last full state. Ask for a full refresh with method 1002 when push IDs skip.
- Method 6008 pushes attribute changes.

| Field | Contents |
|---|---|
| `machine_status.status` | 0 init, 1 idle, 2 printing, 3/4 filament operation, 5 leveling, 9 firmware update, 11 file transfer, 14 emergency stop, 15 power-loss recovery |
| `machine_status.sub_status` | e.g. 2075 printing, 2502 paused, 2504 stopped, 2077 complete |
| `machine_status.exception_status[]` | e.g. 109 filament runout |
| `print_status` | `filename`, `uuid`, `current_layer`, `total_layer`, `print_duration`, `remaining_time_sec`, `progress` |
| Temperatures | `extruder` and `heater_bed` (current and target), `ztemperature_sensor` (chamber) |
| `fans` | `fan`, `aux_fan`, `box_fan`, `heater_fan`, `controller_fan`. Each has `speed` as **0–255** plus `rpm`; convert to our 0–1 scale. |
| `gcode_move_inf` / `gcode_move` | x/y/z/e, `speed`, `speed_mode` 0–3 |
| Other | `led.status`, `toolhead.homed_axes`, `external_device.camera` |

`total_layer` is often missing from status pushes; fetch it with method 1046.

## Commands

| Command | Method | Params |
|---|---|---|
| Start print | 1020 | `{storage_media: "local", filename, config: {delay_video, printer_check, print_layout: "A"/"B", bedlevel_force, slot_map: []}}` |
| Pause | 1021 | none |
| Stop / cancel | 1022 | none |
| Resume | 1023 | none (commented out in the SDK, but the printer responds) |
| Set temperatures | 1028 | `{extruder, heater_bed}` |
| Light | 1029 | `{power: 0/1}` |
| Fans | 1030 | `{fan, aux_fan, box_fan}`, values 0–255 |
| Speed mode | 1031 | `{mode: 0–3}`, only during a print |
| Home | 1026 | `{homed_axes: "xyz"}` |
| Move | 1027 | **untested:** the SDK uses `{axes, distance}`, pycentauri uses `{axis, step}` |
| Load / unload filament (external spool) | 1024 / 1025 | none |
| Load / unload a CANVAS slot | 2001 / 2002 | `{canvas_id, tray_id}` |
| Emergency stop | 1007 | |
| Auto-level, PID tuning, self-check | 1032–1035 | |
| Printer attributes (incl. serial number) | 1001 | |
| Full status refresh | 1002 | |
| File list, thumbnail, file detail, delete, disk info | 1044–1048 | Delete: the verified form is `{file_path: [...]}` |
| Camera URL | 1042 | Responds on 02.01.00.00, not on 01.03.02.51 |

**Never send method 1039. It starts a firmware flash.** The driver must block it outright.

**Not available on stock firmware:**
- **Raw G-code:** no method found. Set `canGcodeConsole` to false.
- **Skip objects:** no method found; only community firmware exposes it. Set `canSkipObjects` to false.

**Rate limit:** if three or more requests are sent back to back, the printer silently stops replying for a few seconds. Send one command at a time and wait for each reply.

## File upload

- Send `PUT http://<ip>:80/upload` with body type `application/octet-stream`.
- Headers:
  - `Content-Range: bytes <start>-<end>/<total>`
  - `X-File-Name`
  - `X-File-MD5`: the MD5 of the whole file
  - `X-Token`: the access code
- Send chunks of at most 1 MB.
- Success is a JSON reply with `{"error_code": 0, ...}`. Error code 9004 means the MD5 check failed.
- Afterwards, confirm the file with method 1046 and start it with method 1020.
- **File format:** `.gcode` from ElegooSlicer, with a `; HEADER_BLOCK_START` header and thumbnail, is confirmed. **Whether it can print `.3mf` is untested.**
- Files can't be downloaded back off the printer on stock firmware.

## Camera

- MJPEG on port **8080**. Stock firmware serves it on any path (e.g. `/?action=stream`), with no login.
- **Viewer limit:** printer attributes (method 1001) include `max_video_connections` (seen as 1) and `video_connections`.
- **Approach:** the agent (via go2rtc) is the only viewer, and re-streams to browsers. Watching in ElegooSlicer at the same time may cut one of them off. **The real limit is untested.**
- No RTSP or WebRTC on stock firmware.

## CANVAS

- **Read slots** with method 2005. It returns `canvas_info`:

  ```
  canvas_info {
    active_canvas_id
    active_tray_id                 // -1 = none
    auto_refill
    canvas_list[] {
      canvas_id
      connected
      tray_list[] {
        tray_id
        brand
        filament_type
        filament_name
        filament_code
        filament_color             // "#RRGGBB"
        min_nozzle_temp
        max_nozzle_temp
        status                     // 0 empty, 1 loaded, 2 active
      }
    }
  }
  ```
- **Remaining filament and raw RFID data aren't exposed.** Remaining weight comes from our own filament tracking.
- **Edit slots:** method 2003 edits a slot's filament info; 2004 `{auto_refill: bool}` toggles auto-refill.
- **Slot mapping at print start is supported:** `config.slot_map: [{t, canvas_id, tray_id}]` maps each G-code tool to a tray. The file's `color_map[].t` (from methods 1044/1046) lists the slicer's tools. An empty `slot_map` lets the printer choose. Set `canSlotMapping` to true.
- Filament used per slot isn't reported over MQTT; it's only in the G-code comments.

## Limits and gotchas

- **Only 2–4 MQTT clients at once.** Sources disagree on the number, and ElegooSlicer and the Elegoo app also use connections. The agent should hold one long-lived connection and show a clear error on `"too many clients"`. **The real limit is untested.**
- **Speed mode resets** to Balanced after every CANVAS filament swap.
- **Undocumented codes:** error code 1100 and sub-status 1066 have no official description.
- **Firmware history:**
  - 01.03.01.89 added slicer and app binding.
  - 02.00.02.00 (May 2026) removed SSH and blocks downgrades.
  - 02.01.00.00 (July 2026) made methods 1042, 1044 and 1047 respond.

## Capability flags

| Flag | Value |
|---|---|
| `canSkipObjects` | false |
| `canGcodeConsole` | false |
| `canBedMesh` | true (auto-level via 1032–1035; whether the mesh can be read back is untested) |
| `canFilamentLoadUnload` | true |
| `canSlotMapping` | true |
| `hasCamera` | true |

## To test on the real printer

- UDP discovery on port 52700
- the real MQTT client limit, and the camera viewer limit
- whether `.3mf` files print
- the parameter names for move (1027)
- whether the bed mesh can be read back
- behaviour on firmware newer than 02.01.00.00
- ElegooSlicer still working alongside the agent with LAN Only mode on
