/**
 * Attention Notifications — host half.
 *
 * The browser half detects session events (turn finished / waiting for an approval,
 * an answer, or a plan review) and POSTs them here. This host half relays them to a
 * small always-on-top PowerShell/WinForms overlay that draws them at the bottom-right
 * corner of the Windows desktop, outside the DSH window, and plays a real Windows
 * system sound for new cards.
 *
 * Routes (all same-origin, localhost only):
 *   POST /attention-notify/notify   { id, kind, title, session, workspace, detail, sound, ttlMs, card }
 *   POST /attention-notify/dismiss  { id }
 *   POST /attention-notify/preview  { sound }
 *   POST /attention-notify/clear    {}
 *   GET  /attention-notify/health
 *
 * The overlay never receives user text through a command line: it polls a UTF-8 JSON
 * state file written here, so titles may contain any language.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const OVERLAY_SCRIPT = path.join(PACKAGE_ROOT, "overlay", "attention-overlay.ps1");
const STATE_DIR = path.join(os.tmpdir(), "dsh-attention-notify");
const STATE_FILE = path.join(STATE_DIR, "state.json");
const LOG_FILE = path.join(STATE_DIR, "overlay.log");

const MAX_CARDS = 4;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_SOUND_KEYS = 12;
const TTL_BY_KIND = {
  complete: 12000,
  approval: 300000,
  question: 300000,
  planReview: 300000,
  generic: 300000,
};
const SOUND_KEYS = new Set([
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
]);

function log(message) {
  try {
    fs.appendFileSync(LOG_FILE, "[" + new Date().toISOString() + "] " + message + "\n", "utf8");
  } catch (error) {
    /* logging is best-effort */
  }
}

function clip(value, max) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  return text.length > max ? text.slice(0, max) : text;
}

function clampTtl(value, kind) {
  const fallback = TTL_BY_KIND[kind] ?? TTL_BY_KIND.generic;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(600000, Math.max(1500, Math.round(number)));
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-length", Buffer.byteLength(payload));
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        const parsed = text === "" ? {} : JSON.parse(text);
        resolve(parsed !== null && typeof parsed === "object" ? parsed : null);
      } catch (error) {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

class DesktopBridge {
  constructor() {
    this.cards = [];
    this.child = null;
    this.previewSeq = 0;
    this.previewSound = "none";
    this.shuttingDown = false;
    this.sweepTimer = null;
    this.killTimer = null;
    this.disposed = false;
  }

  start() {
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
    } catch (error) {
      log("mkdir failed: " + String(error));
    }
    this.writeState();
    this.sweepTimer = setInterval(() => this.sweep(), 1000);
    if (typeof this.sweepTimer.unref === "function") this.sweepTimer.unref();
    log("bridge started; state=" + STATE_FILE);
  }

  statePayload() {
    return {
      version: 1,
      updatedAt: Date.now(),
      shutdown: this.shuttingDown === true,
      preview: { seq: this.previewSeq, sound: this.previewSound },
      cards: this.cards.map((card) => ({
        id: card.id,
        kind: card.kind,
        title: card.title,
        session: card.session,
        workspace: card.workspace,
        detail: card.detail,
        sound: card.sound,
        at: card.at,
      })),
    };
  }

  writeState() {
    const payload = JSON.stringify(this.statePayload());
    const temporary = STATE_FILE + ".tmp";
    try {
      fs.writeFileSync(temporary, payload, "utf8");
      fs.renameSync(temporary, STATE_FILE);
    } catch (error) {
      log("write state failed: " + String(error));
      try {
        fs.unlinkSync(temporary);
      } catch (ignored) {
        /* ignore */
      }
    }
  }

  ensureOverlay() {
    if (this.shuttingDown) return false;
    if (this.child !== null) return true;
    if (!fs.existsSync(OVERLAY_SCRIPT)) {
      log("overlay script missing: " + OVERLAY_SCRIPT);
      return false;
    }
    try {
      const child = spawn(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-WindowStyle",
          "Hidden",
          "-File",
          OVERLAY_SCRIPT,
          "-StateFile",
          STATE_FILE,
          "-ParentPid",
          String(process.pid),
          "-LogFile",
          LOG_FILE,
        ],
        { windowsHide: true, stdio: "ignore", detached: false },
      );
      this.child = child;
      log("overlay spawned pid=" + String(child.pid));
      child.on("exit", (code) => {
        log("overlay exited code=" + String(code));
        if (this.child === child) this.child = null;
        if (!this.shuttingDown && !this.disposed && this.cards.length > 0) {
          const timer = setTimeout(() => {
            try {
              this.ensureOverlay();
            } catch (error) {
              /* ignore */
            }
          }, 800);
          if (typeof timer.unref === "function") timer.unref();
        }
      });
      child.on("error", (error) => {
        log("overlay spawn error: " + String(error));
        if (this.child === child) this.child = null;
      });
      return true;
    } catch (error) {
      log("overlay spawn threw: " + String(error));
      this.child = null;
      return false;
    }
  }

  upsert(card) {
    const now = Date.now();
    const existing = this.cards.findIndex((item) => item.id === card.id);
    const next = { ...card, at: now, expiresAt: now + clampTtl(card.ttlMs, card.kind) };
    if (existing >= 0) {
      this.cards = this.cards.slice();
      this.cards[existing] = next;
    } else {
      this.cards = this.cards.concat([next]).slice(-MAX_CARDS);
    }
    const alive = this.ensureOverlay();
    this.writeState();
    return alive;
  }

  dismiss(id) {
    const before = this.cards.length;
    this.cards = this.cards.filter((item) => item.id !== id);
    if (this.cards.length !== before) this.writeState();
  }

  clear() {
    if (this.cards.length === 0) return;
    this.cards = [];
    this.writeState();
  }

  preview(sound) {
    this.previewSeq += 1;
    this.previewSound = sound;
    const alive = this.ensureOverlay();
    this.writeState();
    return alive;
  }

  sweep() {
    if (this.disposed) return;
    const now = Date.now();
    const kept = this.cards.filter((card) => card.expiresAt > now);
    if (kept.length !== this.cards.length) {
      this.cards = kept;
      this.writeState();
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.shuttingDown = true;
    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.cards = [];
    this.writeState();
    const child = this.child;
    this.child = null;
    if (child !== null && !child.killed) {
      this.killTimer = setTimeout(() => {
        try {
          child.kill();
        } catch (error) {
          /* ignore */
        }
        try {
          fs.unlinkSync(STATE_FILE);
        } catch (error) {
          /* ignore */
        }
      }, 600);
      if (typeof this.killTimer.unref === "function") this.killTimer.unref();
    }
  }
}

function normalizeCard(body) {
  const kind = typeof body.kind === "string" && Object.prototype.hasOwnProperty.call(TTL_BY_KIND, body.kind) ? body.kind : "generic";
  const sound = typeof body.sound === "string" && SOUND_KEYS.has(body.sound) ? body.sound : "none";
  const id = clip(body.id, 160) || kind + ":" + Date.now();
  return {
    id,
    kind,
    sound,
    title: clip(body.title, 80),
    session: clip(body.session, 120),
    workspace: clip(body.workspace, 80),
    detail: clip(body.detail, 120),
    ttlMs: body.ttlMs,
  };
}

export default {
  name: "attention-notify",
  apply(ctx) {
    const bridge = new DesktopBridge();
    bridge.start();

    ctx.effect(() => () => bridge.dispose(), "attention-notify: desktop bridge");

    ctx.inject(["webServer"], (scope) => {
      const register = (routePath, handler) => {
        const route = {
          kind: "exact",
          path: routePath,
          handler: async (req, res) => {
            try {
              await handler(req, res);
            } catch (error) {
              log("route " + routePath + " failed: " + String(error));
              try {
                json(res, 500, { ok: false, error: "internal" });
              } catch (ignored) {
                /* response already gone */
              }
            }
          },
        };
        const disposer = scope.webServer.register(route);
        scope.effect(() => () => {
          try {
            disposer();
          } catch (error) {
            /* ignore */
          }
        }, "attention-notify: route " + routePath);
        return route;
      };

      register("/attention-notify/notify", async (req, res) => {
        if (req.method !== "POST") return json(res, 405, { ok: false, error: "method" });
        const body = await readBody(req);
        if (body === null) return json(res, 400, { ok: false, error: "body" });
        if (body.card === false) {
          const sound = typeof body.sound === "string" && SOUND_KEYS.has(body.sound) ? body.sound : "none";
          const overlay = sound !== "none" ? bridge.preview(sound) : bridge.ensureOverlay();
          return json(res, 200, { ok: true, card: false, sound, overlay });
        }
        const card = normalizeCard(body);
        const overlay = bridge.upsert(card);
        return json(res, 200, { ok: true, card: true, id: card.id, overlay });
      });

      register("/attention-notify/dismiss", async (req, res) => {
        if (req.method !== "POST") return json(res, 405, { ok: false, error: "method" });
        const body = await readBody(req);
        if (body === null) return json(res, 400, { ok: false, error: "body" });
        const id = clip(body.id, 160);
        if (id !== "") bridge.dismiss(id);
        return json(res, 200, { ok: true });
      });

      register("/attention-notify/preview", async (req, res) => {
        if (req.method !== "POST") return json(res, 405, { ok: false, error: "method" });
        const body = await readBody(req);
        if (body === null) return json(res, 400, { ok: false, error: "body" });
        const sound = typeof body.sound === "string" && SOUND_KEYS.has(body.sound) ? body.sound : "notify";
        const overlay = bridge.preview(sound);
        return json(res, 200, { ok: true, sound, overlay });
      });

      register("/attention-notify/clear", async (req, res) => {
        if (req.method !== "POST") return json(res, 405, { ok: false, error: "method" });
        bridge.clear();
        return json(res, 200, { ok: true });
      });

      register("/attention-notify/health", async (req, res) => {
        json(res, 200, {
          ok: true,
          cards: bridge.cards.length,
          overlay: bridge.child !== null,
          soundKeys: Array.from(SOUND_KEYS),
          stateFile: STATE_FILE,
          platform: process.platform,
        });
      });
    });
  },
};
