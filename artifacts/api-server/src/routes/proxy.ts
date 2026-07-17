import { Router } from "express";
import { requireAuth, requireApproved } from "../middlewares/auth";

const router = Router();

// Only proxy from these known embed domains
const ALLOWED_HOSTS = new Set([
  "vidsrc.to",
  "vidsrc.me",
  "autoembed.cc",
  "multiembed.mov",
  "embed.su",
  "vidsrc.icu",
  "2embed.cc",
  "rive.stream",
  "embed.smashystream.com",
]);

// Ad-network script patterns to strip from HTML
const AD_SCRIPT_PATTERNS = [
  /googlesyndication/i,
  /doubleclick\.net/i,
  /adnxs\.com/i,
  /popads\.net/i,
  /popcash\.net/i,
  /adsterra\.com/i,
  /mgid\.com/i,
  /taboola\.com/i,
  /outbrain\.com/i,
  /propellerads/i,
  /trafficjunky/i,
  /exoclick/i,
  /juicyads/i,
  /hilltopads/i,
  /clickadu/i,
  /adcash/i,
  /richpush/i,
  /push\.zucks/i,
  /moonad\.org/i,
  /erovertise/i,
  /sexad/i,
  /xxxads/i,
];

// Script that runs inside the proxied page to block residual popup ads
const POPUP_BLOCKER = `
<script>
(function () {
  // Block window.open popup ads
  var _open = window.open.bind(window);
  window.open = function (url, name, features) {
    // Allow blank-named opens that look like player internals (no url = player UI)
    if (!url || url === 'about:blank' || url.startsWith('blob:')) {
      return _open(url, name, features);
    }
    return null;
  };

  // Block top/parent navigation used for redirect ads
  try {
    Object.defineProperty(window, 'top', { get: function () { return window; }, configurable: true });
    Object.defineProperty(window, 'parent', { get: function () { return window; }, configurable: true });
  } catch (_) {}

  // Block document.write-based ad injection
  var _write = document.write.bind(document);
  document.write = function (markup) {
    var lower = (markup || '').toLowerCase();
    var isAd = ${JSON.stringify(AD_SCRIPT_PATTERNS.map((p) => p.source))}.some(function (pat) {
      return new RegExp(pat, 'i').test(lower);
    });
    if (!isAd) _write(markup);
  };
})();
</script>
`;

router.get(
  "/embed",
  requireAuth,
  requireApproved,
  async (req, res) => {
    const rawUrl = String(req.query.url ?? "");
    if (!rawUrl) {
      res.status(400).json({ error: "url param required" });
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      res.status(400).json({ error: "Invalid URL" });
      return;
    }

    const host = parsed.hostname.replace(/^www\./, "");
    if (!ALLOWED_HOSTS.has(host)) {
      res.status(403).json({ error: "Domain not allowed" });
      return;
    }

    // Helper: return a styled HTML error page that postMessages "server-unavailable"
    // to the parent so VideoPlayer can auto-advance to the next server
    const sendErrorPage = (msg: string) => {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0a0a;color:#fff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px;text-align:center;padding:24px}</style>
</head><body>
<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#facc15" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
<p style="font-size:1rem;font-weight:600;color:#fff">${msg}</p>
<p style="font-size:.8rem;color:#666">Trying next server automatically…</p>
<script>
try { window.parent.postMessage({ __sv_error: true, event: 'server-unavailable' }, '*'); } catch(e){}
setTimeout(function(){ try { window.parent.postMessage({ __sv_error: true, event: 'server-unavailable' }, '*'); } catch(e){} }, 1500);
</script></body></html>`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Security-Policy", "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;");
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      res.status(200).send(html);
    };

    // 5-second timeout so DNS failures don't hang the browser
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    let upstream: Response;
    try {
      upstream = await fetch(rawUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: parsed.origin + "/",
        },
        redirect: "follow",
      });
      clearTimeout(timeout);
    } catch (err: any) {
      clearTimeout(timeout);
      console.error("Proxy fetch failed:", err?.message ?? err);
      sendErrorPage("Server unreachable");
      return;
    }

    try {

      let html = await upstream.text();
      const baseOrigin = parsed.origin;

      // 1. Strip ad <script src="..."> tags
      html = html.replace(
        /<script[^>]+src=["'][^"']*["'][^>]*>(\s*<\/script>)?/gi,
        (match) => {
          const isAd = AD_SCRIPT_PATTERNS.some((pat) => pat.test(match));
          return isAd ? "<!-- ad removed -->" : match;
        },
      );

      // 2. Strip ad <iframe src="..."> tags
      html = html.replace(/<iframe[^>]+src=["'][^"']*["'][^>]*>[\s\S]*?<\/iframe>/gi, (match) => {
        const isAd = AD_SCRIPT_PATTERNS.some((pat) => pat.test(match));
        return isAd ? "<!-- ad iframe removed -->" : match;
      });

      // 3. Inject base href + popup blocker right after <head>
      const injection = `<base href="${baseOrigin}/" />${POPUP_BLOCKER}`;
      if (html.includes("<head>")) {
        html = html.replace("<head>", "<head>" + injection);
      } else if (html.includes("<head ")) {
        html = html.replace(/<head [^>]*>/, (m) => m + injection);
      } else {
        html = injection + html;
      }

      // Strip security headers that would block the proxied page
      res.removeHeader("X-Frame-Options");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader(
        "Content-Security-Policy",
        "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;",
      );
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      res.send(html);
    } catch (err) {
      console.error("Proxy processing failed:", err);
      sendErrorPage("Server error");
    }
  },
);

export default router;
