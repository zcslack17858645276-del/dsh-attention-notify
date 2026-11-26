# Attention Notifications (`@local/dsh-attention-notify`)

A DSH plugin (Host + browser client) that tells you when a session **finishes** or **needs you**
(approval request, user question, plan review) — with a **Windows system sound** and a floating
card stack in the **bottom-right corner of the Windows desktop**, so a background workspace is
never missed.

## Behavior

- The browser half watches `ctx.uiSession.sessionStatus` (all sessions, all workspaces):
  - `running: true → false` → "task complete" notice. Not raised for the session you are
    currently looking at with the app focused, nor for subagent sessions.
  - a new `pendingInteraction` → "approval / question / plan review" notice. The notice is
    removed when that interaction settles. Subagent interactions are included, because
    missing an approval is worse than a little extra noise.
- Delivery:
  - **App not focused** → the client POSTs the notice to the Host, which renders it with a
    small persistent PowerShell WinForms overlay in the bottom-right corner of the primary
    monitor (always-on-top, click-through, never steals focus). Clicking a card brings the
    DSH window to the foreground. The overlay plays a real Windows system sound
    (`C:\Windows\Media\*.wav`) for each new notice.
  - **App focused** → an in-app card stack is shown in the bottom-right of the app window
    (same colors), with "打开会话" (open) and "关闭" (dismiss) buttons. Completion cards
    auto-dismiss after 12 s; attention cards after 5 min.
- Sounds are selected from the Windows system WAVs; no audio assets ship with the plugin.
  Completion sound defaults to **off** because DSH profiles may already have a completion
  chime (e.g. `dsh-whale-widget`); the attention sound (approval/question) defaults to
  `notify`.
- If the Host route is unavailable (e.g. browser-only profile), the client falls back to the
  in-app card and a synthesized Web Audio chime.

## Settings

The plugin contributes one row to **Settings → General → 通知提醒**:

| Setting | Default |
| --- | --- |
| 提示音 (system sound on) | on |
| 桌面右下角卡片 (desktop card stack) | on |
| 任务完成音 (completion sound) | 无 (none) |
| 需要处理提示音 (attention sound) | notify |
| 仅窗口不在前台时响铃 (sound only when unfocused) | off |

Settings are persisted in `localStorage` under `dsh.attention-notify.settings.v2`
(the old `v1` values are migrated).

## Install

Install the bundle from this directory with the plugin manager, or add the bundle to the
profile through the normal bundle workflow. Host changes reload through HMR; a client
`client.js` change needs a page refresh (F5) because the browser bundle is loaded at
page load.

Requirements: Windows (PowerShell 5.1 with WinForms is used for the desktop overlay).

## Files

- `index.js` — Host half: `webServer` routes + state file + PowerShell overlay lifecycle.
- `overlay/attention-overlay.ps1` — ASCII-only WinForms desktop overlay (polling, rendering,
  system sound playback, click-to-focus, parent-process watchdog).
- `client.js` — module-loader client plugin (status watcher, in-app cards, sound selection,
  settings row).
- `cordis.patch.yml` — mounts the Host half.
- `locale/en.json`, `locale/zh.json` — plugin manager title/description.
- `icon.svg` — bell icon.
