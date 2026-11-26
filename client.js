/**
 * Attention Notifications — client half.
 *
 * Watches the Client session-status store (`ctx.uiSession.sessionStatus`) for every
 * session in the profile and raises an attention signal when a session finishes or
 * starts waiting for the user (approval / question / plan review):
 *
 *  - a real Windows system sound, played through a small desktop overlay process that
 *    this plug-in's host half keeps alive (no audio asset files in the bundle), and
 *  - a system-level card at the bottom-right corner of the Windows desktop, outside
 *    the DSH window, so background workspaces are noticed even when DSH is not focused.
 *
 * When the DSH window is focused the card is rendered in `shell.overlay` instead, where
 * it can be clicked to open the session. The desktop overlay itself is click-through
 * (a click focuses the DSH window).
 *
 * Settings live in one `settings.general.item` row. This module deliberately uses only
 * public Client services; it imports no Harness Client package.
 */
window.__ModuleLoader__.load({
  id: "@local/dsh-attention-notify",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;

    const NS = "attention-notify";
    const STORAGE_KEY = "dsh.attention-notify.settings.v2";
    const STYLE_ID = "@local/dsh-attention-notify/client.css";
    const OVERLAY_ID = "attention-notify.overlay";
    const SETTINGS_ROW_ID = "attention-notify.settings";
    const NOTIFY_ROUTE = "/attention-notify/notify";
    const DISMISS_ROUTE = "/attention-notify/dismiss";
    const PREVIEW_ROUTE = "/attention-notify/preview";
    const THEME_ROUTE = "/attention-notify/theme";
    const MAX_NOTICES = 4;
    const COMPLETE_DISMISS_MS = 12000;
    const ATTENTION_DISMISS_MS = 300000;
    const SOUND_THROTTLE_MS = 350;

    const DEFAULT_COLORS = {
      bg: "#0d1117",
      text: "#fab5ee",
      secondary: "#c79bc0",
      complete: "#7ee787",
      attention: "#ffa657",
      question: "#fab5ee",
    };
    const COLOR_KEYS = ["bg", "text", "secondary", "complete", "attention", "question"];

    const inject = ["sessions", "slots", "locale", "uiSession"];

    const SOUND_KEYS = [
      "none",
      "notify",
      "notify2",
      "generic",
      "ding",
      "chimes",
      "tada",
      "message",
      "exclamation",
      "default",
      "error",
      "critical",
    ];
    const SOUND_LABELS = {
      none: "sound.none",
      notify: "sound.notify",
      notify2: "sound.notify2",
      generic: "sound.generic",
      ding: "sound.ding",
      chimes: "sound.chimes",
      tada: "sound.tada",
      message: "sound.message",
      exclamation: "sound.exclamation",
      default: "sound.default",
      error: "sound.error",
      critical: "sound.critical",
    };

    // "何时提醒" 只在这一层判断：never 完全不打扰，unfocused 是默认值（窗口在前台就当你在看着），
    // always 连前台也提醒（前台用应用内卡片，桌面卡片仍然只在未聚焦时出现）。
    const NOTIFY_MODES = ["never", "unfocused", "always"];
    const NOTIFY_MODE_LABELS = {
      never: "mode.never",
      unfocused: "mode.unfocused",
      always: "mode.always",
    };

    const zh = {
      "settings.title": "通知提醒",
      "settings.pluginTag": "跨工作区提醒插件",
      "settings.groupBehavior": "提醒方式",
      "settings.groupSounds": "提示音",
      "settings.groupColors": "卡片配色",
      "settings.description":
        "会话完成或需要你处理（授权、回答、确认计划）时，用 Windows 系统提示音和桌面右下角卡片提醒你，同时开着多个工作区、DSH 不在前台也不会错过。",
      "settings.soundOn": "系统提示音",
      "settings.soundOnHint": "使用 Windows 自带的提示音，无需额外音频文件。",
      "settings.desktopOn": "桌面卡片",
      "settings.desktopOnHint": "DSH 窗口不在前台时，在 Windows 桌面右下角显示提醒卡片；窗口在前台时是否提醒由「何时提醒」决定。",
      "settings.completeSound": "任务完成音",
      "settings.completeSoundHint": "默认关闭：DSH 自带的完成提示音可能已经在响，避免重复。",
      "settings.attentionSound": "需要处理提示音",
      "settings.attentionSoundHint": "授权、提问、计划确认等需要你操作时播放。",
      "settings.notifyMode": "何时提醒",
      "settings.notifyModeHint": "设置 DSH 在任务完成或需要你处理时，何时提醒你。",
      "settings.mode.never": "从不",
      "settings.mode.unfocused": "仅在未聚焦时",
      "settings.mode.always": "始终",
      "settings.testComplete": "试听完成音",
      "settings.testAttention": "试听提醒音",
      "settings.colors": "卡片配色",
      "settings.colorsHint": "修改后立即生效，并同步到应用内卡片与 Windows 桌面卡片。",
      "settings.color.bg": "背景",
      "settings.color.text": "文字",
      "settings.color.secondary": "次要文字",
      "settings.color.complete": "完成强调色",
      "settings.color.attention": "需要授权强调色",
      "settings.color.question": "需要回答强调色",
      "settings.colorsReset": "恢复默认配色",
      "notice.complete": "任务完成",
      "notice.approval": "需要授权",
      "notice.question": "需要你回答",
      "notice.planReview": "计划待确认",
      "notice.generic": "需要你处理",
      "notice.open": "打开会话",
      "notice.dismiss": "关闭",
      "region.label": "通知提醒",
      "session.untitled": "未命名会话",
      "sound.none": "无",
      "sound.notify": "Windows 通知",
      "sound.notify2": "Windows 通知（经典）",
      "sound.generic": "Windows 通知（通用）",
      "sound.ding": "叮",
      "sound.chimes": "风铃",
      "sound.tada": "嗒哒",
      "sound.message": "消息提示",
      "sound.exclamation": "感叹提示",
      "sound.default": "Windows 默认",
      "sound.error": "错误提示",
      "sound.critical": "严重提示",
    };

    const en = {
      "settings.title": "Attention notifications",
      "settings.pluginTag": "cross-workspace alerts",
      "settings.groupBehavior": "How to notify",
      "settings.groupSounds": "Sounds",
      "settings.groupColors": "Card colors",
      "settings.description":
        "A real Windows system sound plus a card at the bottom-right corner of the desktop when a session finishes or needs you (approval, answer, plan review), so background workspaces are never missed even when DSH is not focused.",
      "settings.soundOn": "System sounds",
      "settings.soundOnHint": "Uses the Windows sound scheme; the bundle ships no audio files.",
      "settings.desktopOn": "Desktop cards",
      "settings.desktopOnHint":
        "When the DSH window is not focused, show the card at the bottom-right of the Windows desktop; whether to notify while focused is up to “When to notify”.",
      "settings.completeSound": "Completion sound",
      "settings.completeSoundHint": "Off by default because the built-in DSH completion chime may already play.",
      "settings.attentionSound": "Needs-you sound",
      "settings.attentionSoundHint": "Plays when an approval, question, or plan review needs you.",
      "settings.notifyMode": "When to notify",
      "settings.notifyModeHint": "Choose when DSH should notify you about finished tasks or pending requests.",
      "settings.mode.never": "Never",
      "settings.mode.unfocused": "Only when unfocused",
      "settings.mode.always": "Always",
      "settings.testComplete": "Test completion sound",
      "settings.testAttention": "Test attention sound",
      "settings.colors": "Card colors",
      "settings.colorsHint": "Changes apply immediately to both the in-app cards and the Windows desktop cards.",
      "settings.color.bg": "Background",
      "settings.color.text": "Text",
      "settings.color.secondary": "Secondary text",
      "settings.color.complete": "Completion accent",
      "settings.color.attention": "Approval accent",
      "settings.color.question": "Answer accent",
      "settings.colorsReset": "Restore default colors",
      "notice.complete": "Task finished",
      "notice.approval": "Approval needed",
      "notice.question": "Answer needed",
      "notice.planReview": "Plan needs review",
      "notice.generic": "Needs you",
      "notice.open": "Open session",
      "notice.dismiss": "Dismiss",
      "region.label": "Attention notifications",
      "session.untitled": "Untitled session",
      "sound.none": "None",
      "sound.notify": "Windows Notify",
      "sound.notify2": "Windows Notify (classic)",
      "sound.generic": "Windows Notify (generic)",
      "sound.ding": "Ding",
      "sound.chimes": "Chimes",
      "sound.tada": "Tada",
      "sound.message": "Message nudge",
      "sound.exclamation": "Exclamation",
      "sound.default": "Windows default",
      "sound.error": "Error",
      "sound.critical": "Critical stop",
    };

    const CSS = `
.dan-stack{position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;flex-direction:column-reverse;gap:8px;width:min(380px,calc(100vw - 32px));pointer-events:none}
.dan-card{pointer-events:auto;display:flex;gap:10px;padding:12px 14px;border-radius:10px;background:var(--dan-bg,#0D1117);border:1px solid var(--dan-border,rgba(250,181,238,.28));box-shadow:0 10px 30px rgba(0,0,0,.45);color:var(--dan-text,#FAB5EE);animation:dan-in .18s ease-out}
@keyframes dan-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.dan-card[data-kind="complete"]{border-left:3px solid var(--dan-complete,#7EE787)}
.dan-card[data-kind="approval"],.dan-card[data-kind="planReview"]{border-left:3px solid var(--dan-attention,#FFA657)}
.dan-card[data-kind="question"],.dan-card[data-kind="generic"]{border-left:3px solid var(--dan-question,#FAB5EE)}
.dan-card-icon{flex:0 0 auto;width:18px;height:18px;margin-top:1px;color:var(--dan-text,#FAB5EE)}
.dan-card[data-kind="complete"] .dan-card-icon{color:var(--dan-complete,#7EE787)}
.dan-card[data-kind="approval"] .dan-card-icon,.dan-card[data-kind="planReview"] .dan-card-icon{color:var(--dan-attention,#FFA657)}
.dan-card-body{min-width:0;flex:1 1 auto;display:flex;flex-direction:column;gap:2px}
.dan-card-title{font-size:13px;font-weight:600;line-height:18px;color:var(--dan-text,#FAB5EE)}
.dan-card-sub{font-size:13px;line-height:18px;color:var(--dan-text,#FAB5EE);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dan-card-meta{font-size:12px;line-height:16px;color:var(--dan-secondary,#C79BC0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dan-card-detail{font-size:12px;line-height:16px;color:var(--dan-secondary,#C79BC0);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dan-card-actions{display:flex;gap:8px;margin-top:8px}
.dan-btn{pointer-events:auto;appearance:none;border:1px solid var(--dan-border-strong,rgba(250,181,238,.35));background:transparent;color:var(--dan-text,#FAB5EE);border-radius:6px;padding:4px 10px;font-size:12px;line-height:16px;cursor:pointer}
.dan-btn:hover{background:var(--dan-hover,rgba(250,181,238,.12))}
.dan-btn-primary{border-color:transparent;background:var(--dan-text,#FAB5EE);color:var(--dan-bg,#0D1117)}
.dan-btn-primary:hover{background:var(--dan-text,#FAB5EE);opacity:.9}
.dan-settings{display:flex;flex-direction:column;gap:14px;padding:16px 18px;margin:4px 0;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.dan-settings-head{display:flex;flex-direction:column;gap:6px}
.dan-title-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dan-settings-title{font-size:14px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dan-plugin-tag{font-size:11px;line-height:18px;padding:0 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dan-settings-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dan-settings-group{display:flex;flex-direction:column;gap:10px}
.dan-settings-group+.dan-settings-group{border-top:1px solid var(--dsw-alias-border-l1);padding-top:12px}
.dan-settings-subhead{font-size:12px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.dan-row{display:flex;align-items:center;justify-content:space-between;gap:16px}
.dan-row-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.dan-row-label{font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}
.dan-row-label-strong{font-weight:600}
.dan-row-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dan-control{display:flex;align-items:center;gap:8px;flex:0 0 auto}
.dan-select{max-width:200px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 8px;font-size:13px}
.dan-check{width:16px;height:16px;accent-color:var(--dsw-alias-brand-primary)}
.dan-colors{display:flex;align-items:center;gap:8px}
.dan-color{width:44px;height:28px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;cursor:pointer}
.dan-color-hex{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.dan-test{display:flex;gap:8px;flex-wrap:wrap}
`;

    function injectStyle() {
      if (typeof document === "undefined") return () => {};
      const existing = document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]');
      if (existing !== null) return () => {};
      const tag = document.createElement("style");
      tag.dataset.pluginCss = STYLE_ID;
      tag.textContent = CSS;
      const host = document.head !== null && document.head !== undefined ? document.head : document.documentElement;
      host.appendChild(tag);
      return () => tag.remove();
    }

    function basename(path) {
      if (typeof path !== "string" || path === "") return "";
      const parts = path.split(/[\\/]+/).filter((part) => part !== "");
      return parts.length === 0 ? "" : parts[parts.length - 1];
    }

    const DEFAULT_SETTINGS = {
      soundOn: true,
      desktopOn: true,
      notifyMode: "unfocused",
      completeSoundKey: "none",
      attentionSoundKey: "notify",
      colors: { ...DEFAULT_COLORS },
    };

    function normalizeSoundKey(value, fallback) {
      return typeof value === "string" && SOUND_KEYS.includes(value) ? value : fallback;
    }

    function normalizeNotifyMode(value) {
      return typeof value === "string" && NOTIFY_MODES.includes(value) ? value : DEFAULT_SETTINGS.notifyMode;
    }

    function normalizeColor(value, fallback) {
      if (typeof value !== "string") return fallback;
      let text = value.trim();
      if (/^#[0-9a-fA-F]{3}$/.test(text)) {
        text = "#" + text[1] + text[1] + text[2] + text[2] + text[3] + text[3];
      }
      return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : fallback;
    }

    function normalizeColors(value) {
      const source = value !== null && typeof value === "object" ? value : {};
      const colors = {};
      for (const key of COLOR_KEYS) colors[key] = normalizeColor(source[key], DEFAULT_COLORS[key]);
      return colors;
    }

    function rgba(hex, alpha) {
      const color = normalizeColor(hex, "#fab5ee");
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
    }

    function themeStyle(value) {
      const colors = normalizeColors(value);
      return {
        "--dan-bg": colors.bg,
        "--dan-text": colors.text,
        "--dan-secondary": colors.secondary,
        "--dan-complete": colors.complete,
        "--dan-attention": colors.attention,
        "--dan-question": colors.question,
        "--dan-border": rgba(colors.text, 0.28),
        "--dan-border-strong": rgba(colors.text, 0.38),
        "--dan-hover": rgba(colors.text, 0.12),
      };
    }

    function readStoredSettings() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const legacy = window.localStorage.getItem("dsh.attention-notify.settings.v1");
        const parsed = raw !== null ? JSON.parse(raw) : legacy !== null ? JSON.parse(legacy) : null;
        if (parsed === null || typeof parsed !== "object") return { ...DEFAULT_SETTINGS, colors: { ...DEFAULT_COLORS } };
        return {
          soundOn: typeof parsed.soundOn === "boolean" ? parsed.soundOn : DEFAULT_SETTINGS.soundOn,
          desktopOn: typeof parsed.desktopOn === "boolean" ? parsed.desktopOn : DEFAULT_SETTINGS.desktopOn,
          completeSoundKey: normalizeSoundKey(
            parsed.completeSoundKey,
            parsed.completeSound === true ? "notify" : DEFAULT_SETTINGS.completeSoundKey,
          ),
          attentionSoundKey: normalizeSoundKey(
            parsed.attentionSoundKey,
            parsed.attentionSound === false ? "none" : DEFAULT_SETTINGS.attentionSoundKey,
          ),
          notifyMode: normalizeNotifyMode(
            parsed.notifyMode !== undefined
              ? parsed.notifyMode
              : parsed.onlyWhenUnfocused === true
                ? "unfocused"
                : DEFAULT_SETTINGS.notifyMode,
          ),
          colors: normalizeColors(parsed.colors),
        };
      } catch (error) {
        return { ...DEFAULT_SETTINGS, colors: { ...DEFAULT_COLORS } };
      }
    }

    function createSettings() {
      let state = readStoredSettings();
      const listeners = new Set();
      const notify = () => {
        for (const listener of listeners) listener();
      };
      return {
        getSnapshot: () => state,
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        update(patch) {
          state = { ...state, ...patch };
          try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          } catch (error) {
            /* persistence is best-effort */
          }
          notify();
        },
      };
    }

    // Synthesized fallback sounds: used only when the host route is unreachable.
    function createAudio() {
      let context = null;
      let lastPlayedAt = 0;

      function ensureContext() {
        if (context !== null) return context;
        const Ctor =
          typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : undefined;
        if (typeof Ctor !== "function") return null;
        try {
          context = new Ctor();
        } catch (error) {
          context = null;
        }
        return context;
      }

      function unlock() {
        const audio = ensureContext();
        if (audio === null) return;
        if (audio.state === "suspended") {
          audio.resume().catch(() => {});
        }
      }

      function tone(audio, frequency, startAt, duration, peak) {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, startAt);
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), startAt + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start(startAt);
        oscillator.stop(startAt + duration + 0.05);
      }

      function play(kind) {
        try {
          const audio = ensureContext();
          if (audio === null) return;
          if (audio.state !== "running") {
            audio.resume().catch(() => {});
            return;
          }
          const now = Date.now();
          if (now - lastPlayedAt < SOUND_THROTTLE_MS) return;
          lastPlayedAt = now;
          const startAt = audio.currentTime + 0.02;
          if (kind === "complete") {
            tone(audio, 659.25, startAt, 0.18, 0.11);
            tone(audio, 987.77, startAt + 0.16, 0.32, 0.11);
          } else {
            tone(audio, 880, startAt, 0.12, 0.11);
            tone(audio, 880, startAt + 0.16, 0.12, 0.11);
            tone(audio, 1174.66, startAt + 0.32, 0.36, 0.11);
          }
        } catch (error) {
          /* audio is best-effort */
        }
      }

      return { unlock, play };
    }

    function createDesktop() {
      async function post(route, body, timeoutMs) {
        if (typeof fetch !== "function") return null;
        const controller = typeof AbortController === "function" ? new AbortController() : null;
        const timer =
          controller !== null
            ? setTimeout(() => {
                try {
                  controller.abort();
                } catch (error) {
                  /* ignore */
                }
              }, timeoutMs)
            : null;
        try {
          const response = await fetch(route, {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: controller !== null ? controller.signal : undefined,
          });
          if (!response.ok) return null;
          const data = await response.json().catch(() => null);
          return data !== null && typeof data === "object" && data.ok === true ? data : null;
        } catch (error) {
          return null;
        } finally {
          if (timer !== null) clearTimeout(timer);
        }
      }

      return {
        async notify(payload) {
          return (await post(NOTIFY_ROUTE, payload, 900)) !== null;
        },
        async dismiss(id) {
          return (await post(DISMISS_ROUTE, { id }, 500)) !== null;
        },
        async preview(sound) {
          return (await post(PREVIEW_ROUTE, { sound }, 900)) !== null;
        },
        async setTheme(colors) {
          return (await post(THEME_ROUTE, { colors: normalizeColors(colors) }, 900)) !== null;
        },
      };
    }

    function createNoticeStore() {
      let items = [];
      const listeners = new Set();
      const timers = new Map();
      const notify = () => {
        for (const listener of listeners) listener();
      };

      function clearTimer(id) {
        const timer = timers.get(id);
        if (timer !== undefined) {
          clearTimeout(timer);
          timers.delete(id);
        }
      }

      function dismiss(id) {
        clearTimer(id);
        if (!items.some((item) => item.id === id)) return;
        items = items.filter((item) => item.id !== id);
        notify();
      }

      function push(notice, options) {
        const next = { ...notice, at: Date.now() };
        const index = items.findIndex((item) => item.id === notice.id);
        if (index >= 0) {
          items = items.slice();
          items[index] = next;
        } else {
          items = [next, ...items].slice(0, MAX_NOTICES);
        }
        clearTimer(next.id);
        const dismissAfter = options && Number.isFinite(options.autoDismissMs) ? options.autoDismissMs : 0;
        if (dismissAfter > 0) {
          timers.set(
            next.id,
            setTimeout(() => {
              timers.delete(next.id);
              dismiss(next.id);
            }, dismissAfter),
          );
        }
        notify();
      }

      return {
        getSnapshot: () => items,
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        push,
        dismiss,
        dispose() {
          for (const id of Array.from(timers.keys())) clearTimer(id);
          listeners.clear();
          items = [];
        },
      };
    }

    function openSession(ctx, sessionId) {
      if (typeof sessionId !== "string" || sessionId === "") return;
      try {
        const uiWorkspace = ctx.get("uiWorkspace");
        if (uiWorkspace !== undefined && uiWorkspace !== null && typeof uiWorkspace.openSession === "function") {
          uiWorkspace.openSession(sessionId);
          return;
        }
      } catch (error) {
        /* fall through to the direct context read */
      }
      try {
        if (ctx.uiWorkspace !== undefined && typeof ctx.uiWorkspace.openSession === "function") {
          ctx.uiWorkspace.openSession(sessionId);
        }
      } catch (error) {
        /* the session simply will not open */
      }
    }

    function createEngine({ ctx, settings, audio, notices, desktop }) {
      const service = ctx.uiSession;
      const status = service !== undefined && service !== null ? service.sessionStatus : undefined;
      if (status === undefined || status === null || typeof status.subscribe !== "function") {
        return { dispose() {} };
      }

      const runningSeen = new Map();
      const pendingSeen = new Map();
      const desktopCards = new Set();
      const cancelledCards = new Set();
      let knownIds = new Set();
      let disposed = false;
      let unsubscribe = () => {};

      const focused = () => {
        try {
          return typeof document !== "undefined" && document.hasFocus();
        } catch (error) {
          return true;
        }
      };

      const sessionsSnapshot = () => {
        try {
          const snapshot = ctx.sessions.list.getSnapshot();
          if (snapshot !== undefined && snapshot !== null && snapshot.byId !== undefined) return snapshot;
        } catch (error) {
          /* fall through */
        }
        return { ids: [], byId: {} };
      };

      const titleOf = (list, row, id) => {
        const own = row !== undefined && row.blank !== true && typeof row.title === "string" ? row.title.trim() : "";
        if (own !== "") return own;
        const parentId = row !== undefined && typeof row.parentId === "string" ? row.parentId : "";
        const parent = parentId !== "" ? list.byId[parentId] : undefined;
        if (parent !== undefined && parent !== null && typeof parent.title === "string" && parent.title.trim() !== "") {
          return parent.title.trim();
        }
        return "";
      };

      const workspaceOf = (list, row, id) => {
        try {
          const workspaces = ctx.get("workspaces");
          const listService = workspaces !== undefined && workspaces !== null ? workspaces.list : undefined;
          const snapshot =
            listService !== undefined && typeof listService.getSnapshot === "function" ? listService.getSnapshot() : undefined;
          const items = snapshot !== undefined && snapshot !== null && Array.isArray(snapshot.items) ? snapshot.items : [];
          const hit = items.find(
            (item) => item !== undefined && item !== null && Array.isArray(item.sessionIds) && item.sessionIds.includes(id),
          );
          if (hit !== undefined) {
            if (typeof hit.title === "string" && hit.title.trim() !== "") return hit.title.trim();
            if (typeof hit.path === "string" && hit.path !== "") return basename(hit.path);
          }
        } catch (error) {
          /* fall back to the session cwd */
        }
        if (row !== undefined && row !== null && typeof row.cwd === "string" && row.cwd !== "") return basename(row.cwd);
        return "";
      };

      function soundAllowed(kind) {
        const current = settings.getSnapshot();
        if (current.soundOn !== true) return null;
        if (current.notifyMode === "never") return null;
        if (current.notifyMode === "unfocused" && focused()) return null;
        const key = kind === "complete" ? current.completeSoundKey : current.attentionSoundKey;
        return key === "none" ? null : key;
      }

      function localized(key) {
        let localeId = "en";
        try {
          const service = ctx.locale;
          if (service !== undefined && service !== null && typeof service.getLocale === "function") {
            localeId = String(service.getLocale() || "en");
          }
        } catch (error) {
          localeId = "en";
        }
        const dict = localeId.toLowerCase().indexOf("zh") === 0 ? zh : en;
        return dict[key] || en[key] || "";
      }

      function dropCard(key) {
        cancelledCards.add(key);
        notices.dismiss(key);
        if (desktopCards.has(key)) {
          desktopCards.delete(key);
          desktop.dismiss(key).catch(() => {});
        }
      }

      function raise(key, type, kind, list, row, sessionId, detail) {
        const current = settings.getSnapshot();
        if (current.notifyMode === "never") return;
        const appFocused = focused();
        if (current.notifyMode === "unfocused" && appFocused) return;
        const soundKey = soundAllowed(kind);
        const wantDesktopCard = current.desktopOn === true && !appFocused;
        const title = titleOf(list, row, sessionId) || localized("session.untitled");
        const workspace = workspaceOf(list, row, sessionId) || "";
        const autoDismissMs = type === "complete" ? COMPLETE_DISMISS_MS : ATTENTION_DISMISS_MS;
        const notice = { id: key, type, sessionId, title, workspace, detail: detail || "" };

        if (!wantDesktopCard) notices.push(notice, { autoDismissMs });

        if (wantDesktopCard) {
          desktop
            .notify({
              id: key,
              kind: type,
              title: localized("notice." + type),
              session: title,
              workspace,
              detail: detail || "",
              sound: soundKey === null ? "none" : soundKey,
              ttlMs: autoDismissMs,
              card: true,
              theme: current.colors,
            })
            .then((ok) => {
              if (!ok) {
                notices.push(notice, { autoDismissMs });
                if (soundKey !== null) audio.play(kind);
                return;
              }
              if (cancelledCards.has(key)) {
                desktop.dismiss(key).catch(() => {});
                return;
              }
              desktopCards.add(key);
            })
            .catch(() => {});
        } else if (soundKey !== null) {
          desktop
            .notify({
              id: key,
              kind: type,
              session: title,
              workspace,
              detail: detail || "",
              sound: soundKey,
              card: false,
              theme: current.colors,
            })
            .then((ok) => {
              if (!ok) audio.play(kind);
            })
            .catch(() => {});
        }
      }

      function raiseCompletion(list, id, row) {
        if (row === undefined || row === null) return;
        if (row.blank === true) return;
        raise("complete:" + id, "complete", "complete", list, row, id, "");
      }

      function raiseAttention(list, id, row, pending) {
        const rawKind = pending.kind;
        const type =
          rawKind === "approval"
            ? "approval"
            : rawKind === "question"
              ? "question"
              : rawKind === "plan-review"
                ? "planReview"
                : "generic";
        raise(
          "attention:" + id,
          type,
          "attention",
          list,
          row,
          id,
          typeof pending.toolName === "string" ? pending.toolName : "",
        );
      }

      function onStatus() {
        if (disposed) return;
        let snapshot;
        try {
          snapshot = status.getSnapshot();
        } catch (error) {
          return;
        }
        if (snapshot === undefined || snapshot === null || typeof snapshot.forEach !== "function") return;

        const list = sessionsSnapshot();
        const seen = new Set();

        snapshot.forEach((entry, id) => {
          if (entry === undefined || entry === null) return;
          seen.add(id);
          const row = list.byId[id];
          const isSubagent =
            row !== undefined &&
            row !== null &&
            (row.origin === "subagent" || typeof row.parentId === "string");

          const runningKnown =
            entry.running !== undefined || (row !== undefined && row !== null && row.running !== undefined);
          const running =
            entry.running !== undefined ? entry.running === true : !!(row !== undefined && row !== null && row.running === true);
          const previousRunning = runningSeen.get(id);
          if (runningKnown) {
            if (previousRunning === undefined) {
              runningSeen.set(id, running);
            } else if (previousRunning !== running) {
              runningSeen.set(id, running);
              if (previousRunning === true && running === false && !isSubagent) {
                raiseCompletion(list, id, row);
              }
            }
          }

          const pending = entry.pendingInteraction;
          const pendingKey =
            pending === undefined || pending === null
              ? ""
              : [pending.kind, pending.key, pending.callId, pending.toolName].join("|");
          const previousPending = pendingSeen.get(id);
          if (previousPending === undefined) {
            pendingSeen.set(id, pendingKey);
          } else if (previousPending !== pendingKey) {
            pendingSeen.set(id, pendingKey);
            if (pendingKey !== "" && pending !== undefined && pending !== null) {
              raiseAttention(list, id, row, pending);
            } else {
              dropCard("attention:" + id);
            }
          }
        });

        for (const id of knownIds) {
          if (seen.has(id)) continue;
          dropCard("complete:" + id);
          dropCard("attention:" + id);
          runningSeen.delete(id);
          pendingSeen.delete(id);
        }
        knownIds = seen;
      }

      try {
        unsubscribe = status.subscribe(onStatus) || (() => {});
      } catch (error) {
        return { dispose() {} };
      }

      onStatus();

      return {
        dispose() {
          disposed = true;
          try {
            unsubscribe();
          } catch (error) {
            /* ignore */
          }
          runningSeen.clear();
          pendingSeen.clear();
          desktopCards.clear();
          cancelledCards.clear();
          knownIds = new Set();
        },
      };
    }

    function noticeIcon(kind) {
      if (kind === "complete") {
        return h(
          "svg",
          { viewBox: "0 0 16 16", width: 18, height: 18, "aria-hidden": "true" },
          h("path", {
            d: "M3 8.4 6.2 11.6 13 4.8",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 2,
            strokeLinecap: "round",
            strokeLinejoin: "round",
          }),
        );
      }
      if (kind === "approval" || kind === "planReview") {
        return h(
          "svg",
          { viewBox: "0 0 16 16", width: 18, height: 18, "aria-hidden": "true" },
          h("path", {
            d: "M8 1.9 14.4 13H1.6L8 1.9Z",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1.6,
            strokeLinejoin: "round",
          }),
          h("path", { d: "M8 6v4", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" }),
          h("circle", { cx: 8, cy: 11.5, r: 0.9, fill: "currentColor" }),
        );
      }
      return h(
        "svg",
        { viewBox: "0 0 16 16", width: 18, height: 18, "aria-hidden": "true" },
        h("path", {
          d: "M8 1.6a4.4 4.4 0 0 0-4.4 4.4v3l-1.1 1.8c-.3.5 0 1.2.6 1.2h9.8c.6 0 .9-.7.6-1.2l-1.1-1.8V6A4.4 4.4 0 0 0 8 1.6Z",
          fill: "currentColor",
        }),
        h("circle", { cx: 8, cy: 13.4, r: 1.2, fill: "currentColor" }),
      );
    }

    function NoticeCard(props) {
      const { notice, t, onOpen, onDismiss } = props;
      return h(
        "div",
        { className: "dan-card", "data-kind": notice.type, role: "status" },
        h("div", { className: "dan-card-icon" }, noticeIcon(notice.type)),
        h(
          "div",
          { className: "dan-card-body" },
          h("div", { className: "dan-card-title" }, t("notice." + notice.type)),
          h(
            "div",
            { className: "dan-card-sub", title: notice.title || t("session.untitled") },
            notice.title || t("session.untitled"),
          ),
          notice.workspace ? h("div", { className: "dan-card-meta" }, notice.workspace) : null,
          notice.detail ? h("div", { className: "dan-card-detail", title: notice.detail }, notice.detail) : null,
          h(
            "div",
            { className: "dan-card-actions" },
            h(
              "button",
              {
                type: "button",
                className: "dan-btn dan-btn-primary",
                onClick: () => {
                  onOpen(notice.sessionId);
                  onDismiss(notice.id);
                },
              },
              t("notice.open"),
            ),
            h("button", { type: "button", className: "dan-btn", onClick: () => onDismiss(notice.id) }, t("notice.dismiss")),
          ),
        ),
      );
    }

    function Overlay(props) {
      const { t, store, settings, openSession: openSessionButton, dismiss } = props;
      const [items, setItems] = React.useState(() => store.getSnapshot());
      const [colors, setColors] = React.useState(() => settings.getSnapshot().colors);
      React.useEffect(() => store.subscribe(() => setItems(store.getSnapshot())), [store]);
      React.useEffect(() => settings.subscribe(() => setColors(settings.getSnapshot().colors)), [settings]);
      if (items === undefined || items === null || items.length === 0) return null;
      return h(
        "div",
        {
          className: "dan-stack",
          style: themeStyle(colors),
          role: "region",
          "aria-live": "polite",
          "aria-label": t("region.label"),
        },
        items.map((notice) =>
          h(NoticeCard, {
            key: notice.id,
            notice,
            t,
            onOpen: openSessionButton,
            onDismiss: dismiss,
          }),
        ),
      );
    }

    function SettingsGroupRow(props) {
      const { label, hint, control, strong } = props;
      return h(
        "div",
        { className: "dan-row" },
        h(
          "div",
          { className: "dan-row-text" },
          h("div", { className: "dan-row-label" + (strong === true ? " dan-row-label-strong" : "") }, label),
          hint ? h("div", { className: "dan-row-hint" }, hint) : null,
        ),
        h("div", { className: "dan-control" }, control),
      );
    }

    function SettingsRow(props) {
      const { t, settings, audio, desktop } = props;
      const [state, setState] = React.useState(() => settings.getSnapshot());
      React.useEffect(() => settings.subscribe(() => setState(settings.getSnapshot())), [settings]);
      const update = (patch) => settings.update(patch);
      const checkbox = (key) =>
        h("input", {
          className: "dan-check",
          type: "checkbox",
          checked: state[key] === true,
          onChange: (event) => update({ [key]: event.target.checked }),
        });
      const select = (key) =>
        h(
          "select",
          {
            className: "dan-select",
            value: state[key],
            onChange: (event) => update({ [key]: event.target.value }),
          },
          SOUND_KEYS.map((soundKey) => h("option", { key: soundKey, value: soundKey }, t(SOUND_LABELS[soundKey]))),
        );
      const notifyModeSelect = () =>
        h(
          "select",
          {
            className: "dan-select",
            value: state.notifyMode,
            onChange: (event) => update({ notifyMode: event.target.value }),
          },
          NOTIFY_MODES.map((mode) => h("option", { key: mode, value: mode }, t(NOTIFY_MODE_LABELS[mode]))),
        );
      const preview = (kind) => {
        const soundKey = kind === "complete" ? state.completeSoundKey : state.attentionSoundKey;
        if (soundKey === "none") return;
        desktop
          .preview(soundKey)
          .then((ok) => {
            if (!ok) audio.play(kind);
          })
          .catch(() => audio.play(kind));
      };
      const updateColor = (key, value) => {
        update({ colors: { ...state.colors, [key]: normalizeColor(value, DEFAULT_COLORS[key]) } });
      };
      const colorControl = (key) =>
        h(
          "div",
          { className: "dan-colors" },
          h("span", { className: "dan-color-hex" }, state.colors[key]),
          h("input", {
            className: "dan-color",
            type: "color",
            value: state.colors[key],
            "aria-label": t("settings.color." + key),
            onChange: (event) => updateColor(key, event.target.value),
          }),
        );
      return h(
        "div",
        { className: "dan-settings" },
        h(
          "div",
          { className: "dan-settings-head" },
          h(
            "div",
            { className: "dan-title-line" },
            h("span", { className: "dan-settings-title" }, t("settings.title")),
            h("span", { className: "dan-plugin-tag" }, t("settings.pluginTag")),
          ),
          h("div", { className: "dan-settings-desc" }, t("settings.description")),
        ),
        h(
          "div",
          { className: "dan-settings-group" },
          h("div", { className: "dan-settings-subhead" }, t("settings.groupBehavior")),
          h(SettingsGroupRow, {
            label: t("settings.notifyMode"),
            hint: t("settings.notifyModeHint"),
            control: notifyModeSelect(),
            strong: true,
          }),
          h(SettingsGroupRow, {
            label: t("settings.soundOn"),
            hint: t("settings.soundOnHint"),
            control: checkbox("soundOn"),
          }),
          h(SettingsGroupRow, {
            label: t("settings.desktopOn"),
            hint: t("settings.desktopOnHint"),
            control: checkbox("desktopOn"),
          }),
        ),
        h(
          "div",
          { className: "dan-settings-group" },
          h("div", { className: "dan-settings-subhead" }, t("settings.groupSounds")),
          h(SettingsGroupRow, {
            label: t("settings.completeSound"),
            hint: t("settings.completeSoundHint"),
            control: select("completeSoundKey"),
          }),
          h(SettingsGroupRow, {
            label: t("settings.attentionSound"),
            hint: t("settings.attentionSoundHint"),
            control: select("attentionSoundKey"),
          }),
          h(
            "div",
            { className: "dan-test" },
            h("button", { type: "button", className: "dan-btn", onClick: () => preview("complete") }, t("settings.testComplete")),
            h("button", { type: "button", className: "dan-btn", onClick: () => preview("attention") }, t("settings.testAttention")),
          ),
        ),
        h(
          "div",
          { className: "dan-settings-group" },
          h("div", { className: "dan-settings-subhead" }, t("settings.groupColors")),
          COLOR_KEYS.map((key) =>
            h(SettingsGroupRow, { key, label: t("settings.color." + key), control: colorControl(key) }),
          ),
          h(
            "div",
            { className: "dan-test" },
            h(
              "button",
              {
                type: "button",
                className: "dan-btn",
                onClick: () => update({ colors: { ...DEFAULT_COLORS } }),
              },
              t("settings.colorsReset"),
            ),
          ),
        ),
      );
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "attention-notify: dictionaries");
      ctx.effect(() => injectStyle(), "attention-notify: styles");

      const settings = createSettings();
      const audio = createAudio();
      const desktop = createDesktop();
      const notices = createNoticeStore();

      ctx.effect(() => {
        const pushTheme = () => {
          desktop.setTheme(settings.getSnapshot().colors).catch(() => {});
        };
        pushTheme();
        return settings.subscribe(pushTheme);
      }, "attention-notify: theme sync");

      ctx.effect(() => {
        const unlock = () => audio.unlock();
        window.addEventListener("pointerdown", unlock, { capture: true, passive: true });
        window.addEventListener("keydown", unlock, { capture: true });
        return () => {
          window.removeEventListener("pointerdown", unlock, { capture: true });
          window.removeEventListener("keydown", unlock, { capture: true });
        };
      }, "attention-notify: audio unlock");

      ctx.slots.inject("shell.overlay", () =>
        ctx.slots.register(
          {
            name: "shell.overlay",
            id: OVERLAY_ID,
            order: 45,
            locale: NS,
            inject: () => ({
              store: notices,
              settings,
              openSession: (sessionId) => openSession(ctx, sessionId),
              dismiss: (id) => notices.dismiss(id),
            }),
          },
          Overlay,
        ),
      );

      ctx.slots.inject("settings.general.item", () =>
        ctx.slots.register(
          {
            name: "settings.general.item",
            id: SETTINGS_ROW_ID,
            order: 40,
            locale: NS,
            inject: () => ({ settings, audio, desktop }),
          },
          SettingsRow,
        ),
      );

      const engine = createEngine({ ctx, settings, audio, notices, desktop });
      ctx.effect(() => () => engine.dispose(), "attention-notify: engine");
    }

    return { inject, apply };
  },
});
