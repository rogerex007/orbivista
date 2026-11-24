// Local HTTP harness for the webOS service modules (desktop verification only).
// Mirrors the Luna methods so the web app can be exercised in Chromium / TV browser.
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const svcDir = path.resolve(__dirname, "..", "webos", "services", "com.webosflux.xuptertv.fidelity.service");
const magis = require(path.join(svcDir, "magis.js"));
const proxy = require(path.join(svcDir, "proxy.js"));
const dnsx = require(path.join(svcDir, "dnsx.js"));
const netdiag = require(path.join(svcDir, "netdiag.js"));
const tvplus = require(path.join(svcDir, "tvplus.js"));
const skipDb = require(path.join(svcDir, "skip-db.js"));

const PORT = Number(process.argv[2] || 8910);

const json = (res, status, data) => {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json;charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  });
  res.end(body);
};

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
    });
    res.end();
    return;
  }
  const done = (err, data) => (err ? json(res, 502, { returnValue: false, errorText: String(err.message || err), errorCode: err.portalCode || 1 }) : json(res, 200, { returnValue: true, ...data }));

  if (u.pathname === "/ping") return json(res, 200, { returnValue: true, port: PORT, proxy: proxy.port() });
  if (u.pathname === "/home") return magis.home(u.searchParams.get("root") || "movies", done);
  if (u.pathname === "/search") return magis.search(u.searchParams.get("value") || "", done);
  if (u.pathname === "/skipSegments") return skipDb.lookup(Object.fromEntries(u.searchParams), done);
  if (u.pathname === "/detail") {
    return magis.detail(u.searchParams.get("contentId") || u.searchParams.get("id") || "", done);
  }
  if (u.pathname === "/resolve") {
    const contentId = u.searchParams.get("contentId") || u.searchParams.get("id") || "";
    const seriesId = u.searchParams.get("seriesContentId") || u.searchParams.get("series") || "";
    return magis.resolve(contentId, seriesId, (err, stream) => {
      if (err) return done(err);
      proxy.start((perr) => {
        if (perr) return done(perr);
        const isTs = (stream.mime === 'video/mp2t' || /\.ts(?:\?|$)/i.test(stream.url));
        const token = proxy.add(stream.url, stream.headers, stream.duration);
        if (isTs) {
          stream.proxyPath = proxy.baseUrl() + '/media/' + token + '/stream.m3u8';
          stream.mime = 'application/vnd.apple.mpegurl';
          stream.isHls = true;
        } else {
          stream.proxyPath = proxy.baseUrl() + '/media/' + token + '/stream.mp4';
        }
        done(null, stream);
      });
    });
  }
  if (u.pathname === "/liveCategories") {
    return magis.getLiveCategories((err, categories) => done(err, { categories }));
  }
  if (u.pathname === "/liveChannels") {
    return magis.getLiveChannels(u.searchParams.get("columnId") || null, (err, channels) => done(err, { channels }));
  }
  if (u.pathname === "/resolveLive") {
    const streamUrl = u.searchParams.get("streamUrl") || "";
    const channelCode = u.searchParams.get("channelCode") || "";
    // Igual que index.js: los canales "tvplus:" se resuelven por tvplus.js y se
    // sirven a través del proxy con IP fijada por DoH (no con el DNS del equipo).
    const tvCode = /^tvplus:/i.test(streamUrl)
      ? streamUrl.replace(/^tvplus:/i, "")
      : /^tvplus:/i.test(channelCode)
        ? channelCode.replace(/^tvplus:/i, "")
        : "";
    const serveLive = (stream) => {
      proxy.start((perr) => {
        if (perr) return done(perr);
        const host = String(stream.url || "").replace(/^https?:\/\//i, "").split("/")[0].split(":")[0];
        const is247 = /24[\s\/-]?7/i.test(String(stream.name || channelCode || ""));
        const startWithIp = (ip) => {
          const token = proxy.add(stream.url, stream.headers || {}, 0, ip, null, true, is247);
          done(null, {
            url: stream.url,
            headers: stream.headers || {},
            proxyPath: proxy.baseUrl() + "/media/" + token + "/stream.m3u8",
            isHls: true,
          });
        };
        if (!host) return startWithIp("");
        dnsx.resolve(host, (der, dr) => startWithIp((dr && dr.ips && dr.ips[0]) || ""));
      });
    };
    if (tvCode) {
      return tvplus.resolve(tvCode, (err, tvRes) => {
        if (err || !tvRes || !tvRes.url) {
          if (channelCode && !/^tvplus:/i.test(channelCode)) {
            return magis.resolveLive(channelCode, (e2, s2) => (e2 ? done(e2) : serveLive(s2)));
          }
          return done(err || new Error("Señal TvPlus no disponible: " + tvCode));
        }
        serveLive(tvRes);
      }, { force: u.searchParams.get("force") === "1" });
    }
    if (streamUrl) {
      // La URL directa del portal se deja tal cual en el arnés de escritorio
      // (Chrome no reproduce MPEG-TS a través del proxy, la TV sí).
      return done(null, { url: streamUrl, proxyPath: streamUrl, isHls: true });
    }
    return magis.resolveLive(channelCode, (err, stream) => (err ? done(err) : serveLive(stream)));
  }
  if (u.pathname === "/netdiag") {
    const hosts = (magis.constants.HOSTS || []).slice(0);
    dnsx.summary().forEach((entry) => {
      if (entry && entry.host && hosts.indexOf(entry.host) === -1) hosts.push(entry.host);
    });
    const screenW = Number(u.searchParams.get("screenW") || 0);
    const screenH = Number(u.searchParams.get("screenH") || 0);
    const screen = (screenW > 0 && screenH > 0)
      ? {
          w: screenW,
          h: screenH,
          scale: Number(u.searchParams.get("screenScale") || 0),
          panelW: Number(u.searchParams.get("panelW") || 0),
          panelH: Number(u.searchParams.get("panelH") || 0)
        }
      : null;
    // Mirrors the Luna route in index.js so the desktop harness exercises the
    // same layer probes (portal/session/live/VOD) and codec rows.
    const jsonParam = (name) => {
      try { return JSON.parse(u.searchParams.get(name) || "{}") || {}; } catch { return {}; }
    };
    const portalHost = (magis.constants.HOSTS || [])[0] || "";
    const sess = magis.session || {};
    const layerOpts = {
      portalUrl: portalHost ? `https://${portalHost}/api/portalCore/v8/active` : "",
      session: { userId: sess.userId || "", userToken: sess.userToken || "", ready: !!sess.ready },
      liveUrl: u.searchParams.get("liveUrl") || "",
      liveHeaders: jsonParam("liveHeaders"),
      vodUrl: u.searchParams.get("vodUrl") || "",
      vodHeaders: jsonParam("vodHeaders"),
    };
    return netdiag.run({ hosts, screen }, (err, report) => {
      if (err) return done(err);
      netdiag.runLayers(layerOpts, (lerr, layers) => {
        report.layers = layers || {};
        report.codec = {
          h264: u.searchParams.get("codecH264") || "",
          hevc: u.searchParams.get("codecHEVC") || "",
          hls: u.searchParams.get("codecHLS") || "",
        };
        done(null, report);
      });
    });
  }
  json(res, 404, { returnValue: false, errorText: "not found" });
});

proxy.start((err, p) => {
  if (err) { console.error("proxy error", err); process.exit(1); }
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`dev service running on http://127.0.0.1:${PORT} (media proxy on ${p})`);
  });
});
