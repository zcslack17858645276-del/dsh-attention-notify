# Attention Notifications (`@local/dsh-attention-notify`)

A DSH plugin (Host + browser client) that tells you when a session **finishes** or **needs you**
(approval request, user question, plan review) — with a **Windows system sound** and a floating
card stack in the **bottom-right corner of the Windows desktop**, so a background workspace is
never missed.

## Behavior

- The browser half watches `ctx.uiSession.sessionStatus` (all sessions, all workspaces):
  - `running: true → false` → "task complete" notice. Subagent sessions are skipped.
  - a new `pendingInteraction` → "approval / question / plan review" notice. The notice is
    removed when that interaction settles. Subagent interactions are included, because
    missing an approval is worse than a little extra noise.
- **How to notify** (`何时提醒` / when to notify, see Settings):
  - `从不` (never) — raises nothing at all.
  - `仅在未聚焦时` (only when unfocused, **default**) — raises nothing while the DSH window is
    in the foreground.
  - `始终` (always) — also raises an in-app card (and the attention sound) while focused.
  Desktop cards are always used only while the app is not focused.
- Delivery:
  - **App not focused** → the client POSTs the notice to the Host, which renders it with a
    small persistent PowerShell WinForms overlay in the bottom-right corner of the primary
    monitor (always-on-top, click-through, never steals focus). Clicking a card brings the
    DSH window to the foreground. The overlay plays a real Windows system sound
    (`C:\Windows\Media\*.wav`) for each new notice.
  - **App focused** → nothing by default; with `始终`, an in-app card stack is shown in the
    bottom-right of the app window (same colors), with "打开会话" (open) and "关闭" (dismiss)
    buttons. Completion cards auto-dismiss after 12 s; attention cards after 5 min.
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
| 何时提醒 (when to notify) | 仅在未聚焦时 (only when unfocused) |
| 卡片配色 (card colors) | 背景 `#0D1117`，文字 `#FAB5EE`，次要文字 `#C79BC0`，完成 `#7EE787`，授权 `#FFA657`，回答 `#FAB5EE` |

The **card colors** section has a color picker per role (background, text, secondary text,
completion accent, approval accent, answer accent) plus "restore default colors". Changes
apply immediately: the in-app card stack is re-themed through CSS variables, and the choice is
POSTed to the Host (`POST /attention-notify/theme`) and included in every notice payload, so
the Windows desktop overlay re-renders existing and new cards with the same colors (the
overlay script compares the theme signature and rebuilds the card stack when it changes).

Settings are persisted in `localStorage` under `dsh.attention-notify.settings.v2`
(the old `v1` values are migrated).

## Install

Install the bundle from this directory with the plugin manager, or add the bundle to the
profile through the normal bundle workflow. Host changes reload through HMR; a client
`client.js` change needs a page refresh (F5) because the browser bundle is loaded at
page load.

Requirements: Windows (PowerShell 5.1 with WinForms is used for the desktop overlay).

## Files

- `index.js` — Host half: `webServer` routes (`/notify`, `/dismiss`, `/preview`, `/theme`,
  `/clear`, `/health`), state file, theme relay, PowerShell overlay lifecycle.
- `overlay/attention-overlay.ps1` — ASCII-only WinForms desktop overlay (polling, rendering,
  dynamic theme colors, system sound playback, click-to-focus, parent-process watchdog).
- `client.js` — module-loader client plugin (status watcher, in-app cards, sound selection,
  settings row).
- `cordis.patch.yml` — mounts the Host half.
- `locale/en.json`, `locale/zh.json` — plugin manager title/description.
- `icon.svg` — bell icon.
