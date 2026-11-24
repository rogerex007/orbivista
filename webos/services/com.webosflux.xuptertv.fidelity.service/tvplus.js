"use strict";
/* Resolución de las señales deportivas de TvPlus (DSports, ESPN, TyC, TUDN...).
 *
 * Reglas que este módulo NO puede saltarse (AGENTS.md, sección 2):
 *   1. Toda conexión hacia la red de emisión abre el socket contra la IP IPv4
 *      literal obtenida por DoH (nunca contra el resolver del operador, que en
 *      Chile/claro/movistar inyecta respuestas envenenadas en el puerto 53).
 *   2. El hostname real viaja en el SNI (`servername`) y en la cabecera Host,
 *      para que el CDN entregue la misma señal que a un navegador.
 *   3. Si DoH no responde se cae al DNS del televisor, pero solo como rescate:
 *      jamás se usa como primer camino.
 */
var http = require("http"),
  https = require("https"),
  urlmod = require("url"),
  dnsx = null;
try {
  dnsx = require("./dnsx");
} catch (e) {
  dnsx = null;
}

var MAX_BODY = 4e6,
  REQUEST_TIMEOUT = 3500,
  /* Al re-entrar a un canal se pide token nuevo solo si el cacheado ya tiene
     más de 10 minutos (los tokens duran ~6 h). */
  FORCE_KEEP_MS = 6e5;

var CHANNELS = [
  { name: "DSports / DirecTV Sports", code: "directvsports", page: "https://www.tvplusgratis.org/directv-sports-en-vivo.php" },
  { name: "DSports 2", code: "directvsports2", page: "https://www.tvplusgratis.org/directv-sports-2-en-vivo.php" },
  { name: "DSports +", code: "directvsportsplus", page: "https://www.tvplusgratis.org/directv-sports-plus-en-vivo.php" },
  { name: "ESPN", code: "espn", page: "https://www.tvplusgratis.org/espn-en-vivo.php" },
  { name: "ESPN 2", code: "espn2", page: "https://www.tvplusgratis.org/espn-2-en-vivo.php" },
  { name: "ESPN 3", code: "espn3", page: "https://www.tvplusgratis.org/espn-3-en-vivo.php" },
  { name: "ESPN 4", code: "espn4", page: "https://www.tvplusgratis.org/espn-4-en-vivo.php" },
  { name: "ESPN 5", code: "espn5", page: "https://www.tvplusgratis.org/espn-5-en-vivo.php" },
  { name: "ESPN 6", code: "espn6", page: "https://www.tvplusgratis.org/espn-6-en-vivo.php" },
  { name: "ESPN 7", code: "espn7", page: "https://www.tvplusgratis.org/espn-7-en-vivo.php" },
  { name: "ESPN Premium", code: "espnpremiumlat", page: "https://www.tvplusgratis.org/espn-premium-en-vivo.php" },
  { name: "ESPN México", code: "espnmexico", page: "https://www.tvplusgratis.org/espn-mexico-en-vivo.php" },
  { name: "ESPN 2 México", code: "espn2mexico", page: "https://www.tvplusgratis.org/espn-2-mexico-en-vivo.php" },
  { name: "ESPN 3 México", code: "espn3mexico", page: "https://www.tvplusgratis.org/espn-3-mexico-en-vivo.php" },
  { name: "ESPN 4 México", code: "espn4mexico", page: "https://www.tvplusgratis.org/espn-4-mexico-en-vivo.php" },
  { name: "ESPN 5 México", code: "espn5mexico", page: "https://www.tvplusgratis.org/espn-5-mexico-en-vivo.php" },
  { name: "TyC Sports", code: "tycsports", page: "https://www.tvplusgratis.org/tyc-sports-en-vivo.php" },
  { name: "TUDN", code: "tudn", page: "https://www.tvplusgratis.org/tudn-en-vivo.php" },
  { name: "Sky Sports La Liga", code: "skysportslaliga", page: "https://www.tvplusgratis.org/sky-sports-la-liga-en-vivo.php" },
  { name: "Movistar Liga de Campeones", code: "movistarligadecampeones", page: "https://www.tvplusgratis.org/movistar-liga-campeones-en-vivo.php" },
  { name: "Fox Sports", code: "foxsports", page: "https://www.tvplusgratis.org/fox-sports-en-vivo.php" },
  { name: "Liga 1", code: "liga1", page: "https://www.tvplusgratis.org/liga-1-en-vivo.php" },
  { name: "Liga 1 Max", code: "liga1max", page: "https://www.tvplusgratis.org/liga-1-max-en-vivo.php" },
  { name: "Azteca Deportes", code: "aztecadeportes", page: "https://www.tvplusgratis.org/azteca-deportes-en-vivo.php" },
  { name: "Bein Sports Xtra", code: "beinsportsxtra", page: "https://www.tvplusgratis.org/bein-sports-xtra-en-vivo.php" }
];

var cache = {},
  deadUntil = {},
  hostDeadUntil = 0,
  lastError = "";

function now() {
  return Date.now();
}

function decodeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/\\x2F/g, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/* Petición con IP fijada por DoH cuando el destino es un nombre. */
function requestOnce(targetUrl, headers, timeoutMs, cb) {
  var u = urlmod.parse(targetUrl),
    secure = u.protocol === "https:",
    host = u.hostname || "",
    mod = secure ? https : http,
    port = u.port || (secure ? 443 : 80),
    done = !1;

  var finish = function (err, body, status) {
    if (done) return;
    done = !0;
    cb(err, body, status);
  };

  var send = function (pinnedIp) {
    var opts = {
      hostname: pinnedIp || host,
      port: port,
      path: u.path || "/",
      method: "GET",
      headers: {},
      rejectUnauthorized: !1
    };
    if (pinnedIp) {
      /* SNI y Host reales: el CDN responde igual que a un navegador aunque el
         socket vaya a una IP literal. */
      opts.servername = host;
    }
    var h = {},
      k;
    for (k in headers || {})
      Object.prototype.hasOwnProperty.call(headers, k) && (h[k] = headers[k]);
    h.Host = u.host || host;
    opts.headers = h;

    var req = mod.request(opts, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        var next = urlmod.resolve(targetUrl, res.headers.location);
        res.resume();
        return httpGet(next, headers, timeoutMs, cb);
      }
      var chunks = [],
        size = 0;
      res.on("data", function (chunk) {
        size += chunk.length;
        if (size <= MAX_BODY) chunks.push(chunk);
        else res.destroy();
      });
      res.on("end", function () {
        finish(null, Buffer.concat(chunks).toString("utf8"), res.statusCode);
      });
      res.on("error", function (e) {
        finish(e);
      });
    });
    req.setTimeout(timeoutMs || REQUEST_TIMEOUT, function () {
      try {
        req.abort();
      } catch (e) {}
      finish(new Error("tiempo agotado en " + host));
    });
    req.on("error", function (e) {
      finish(e);
    });
    req.end();
  };

  if (secure && dnsx && host && !dnsx.isIpv4(host))
    return dnsx.resolve(host, function (err, res) {
      var ip = (res && res.ips && res.ips[0]) || "";
      if (!err && ip) return send(ip);
      /* Sin DoH se intenta el camino directo, pero nunca se abandona la
         petición: es mejor un intento con DNS del televisor que un fallo seco. */
      send("");
    });
  send("");
}

function httpGet(targetUrl, headers, timeoutMs, cb) {
  requestOnce(targetUrl, headers, timeoutMs, cb);
}

/* Extrae la lista m3u8 de una respuesta del emisor. */
function findPlaylist(text) {
  var re = /https?:\/\/[^\s'"<>`\\]*\/playlist\/[0-9]+\/index\.m3u8\?token=[a-zA-Z0-9_-]+/;
  var m = re.exec(text || "");
  return m ? m[0] : "";
}

function findStreamBridge(text) {
  var re = /https?:\/\/[^\s'"<>`\\]*\/stream\.php\?[^\s'"<>`\\]+/;
  var m = re.exec(text || "");
  return m ? m[0] : "";
}

function expiryFromToken(manifestUrl) {
  var t = /token=([^&]+)/.exec(manifestUrl || "");
  if (!t) return 0;
  var parts = String(t[1]).split("-"),
    i,
    n;
  for (i = 0; i < parts.length; i++) {
    n = parseInt(parts[i], 10);
    if (n && n > 1e9 && n < 4e9) return n * 1000;
  }
  return 0;
}

function cacheGet(code) {
  var c = cache[code];
  if (c && now() < c.expiresAt) return c;
  return null;
}

function store(code, manifestUrl, referer) {
  var exp = expiryFromToken(manifestUrl);
  var expiresAt = exp && exp > now() ? exp - 60e3 : now() + 45 * 60e3;
  cache[code] = {
    url: manifestUrl,
    headers: { "User-Agent": "Mozilla/5.0", Referer: referer || "" },
    expiresAt: expiresAt,
    at: now()
  };
  return cache[code];
}

function resolve(canalCode, cb, opts) {
  var normCode = String(canalCode || "").replace(/^tvplus:/i, "").toLowerCase(),
    force = !!(opts && opts.force),
    hit = cacheGet(normCode);
  /* Un token de TvPlus vive ~6 h. "force" solo debe saltarse el caché cuando
     el token ya lleva un rato: re-resolver cada zap costaba 2-4 s de
     "Conectando" por canal sin ninguna ganancia (era la causa de que la
     parrilla deportiva tardara en entrar). */
  if (hit && (!force || now() - (hit.at || 0) < FORCE_KEEP_MS)) {
    return cb(null, { url: hit.url, headers: hit.headers, isHls: !0 });
  }
  if (!force && hostDeadUntil && now() < hostDeadUntil) {
    return cb(new Error("Fuente TvPlus temporalmente fuera de línea"));
  }
  if (!force && deadUntil[normCode] && now() < deadUntil[normCode]) {
    return cb(
      new Error(
        "Señal TvPlus no disponible en la fuente (" + normCode + "); se reintenta en 1 minuto"
      )
    );
  }

  var pageUrl = "https://www.tvplusgratis.org/" + normCode + "-en-vivo.php",
    i;
  for (i = 0; i < CHANNELS.length; i++) {
    if (CHANNELS[i].code === normCode) {
      pageUrl = CHANNELS[i].page;
      break;
    }
  }

  var prefixes = ["live", "live2", "live3", "live4"],
    lastText = "";

  var fail = function (msg) {
    lastError = String(msg || "").slice(0, 160);
    deadUntil[normCode] = now() + 60e3;
    cb(new Error(lastError || "No se pudo resolver señal TvPlus (" + normCode + ")"));
  };

  var acceptPlaylist = function (manifestUrl, referer) {
    var entry = store(normCode, manifestUrl, referer);
    cb(null, { url: entry.url, headers: entry.headers, isHls: !0 });
  };

  var tryPrefix = function (prefixIndex) {
    if (prefixIndex >= prefixes.length) {
      return fail(
        "Señal TvPlus no disponible en la fuente (" +
          normCode +
          ")" +
          (lastText ? " [" + lastText + "]" : "")
      );
    }

    var bridgeUrl =
      "https://www.tvplusgratis.org/" +
      prefixes[prefixIndex] +
      "/core.php?canal=" +
      normCode;

    httpGet(
      bridgeUrl,
      { "User-Agent": "Mozilla/5.0", Referer: pageUrl, Accept: "text/html,*/*" },
      3500,
      function (err, bridgeBody, bridgeStatus) {
        if (err || 200 !== bridgeStatus || !bridgeBody) {
          lastText = err ? err.message : "bridge HTTP " + bridgeStatus;
          if (err && (/tiempo agotado|timed out|ECONNREFUSED|ETIMEDOUT/i.test(err.message))) {
            hostDeadUntil = now() + 60e3;
            return fail("Servidor TvPlus no responde (" + err.message + ")");
          }
          return tryPrefix(prefixIndex + 1);
        }

        var decodedBridge = decodeHtml(bridgeBody);
        /* A veces la lista viene ya en el puente. */
        var directPlaylist = findPlaylist(decodedBridge);
        if (directPlaylist) return acceptPlaylist(directPlaylist, bridgeUrl);

        var streamUrl = findStreamBridge(decodedBridge);
        if (!streamUrl) {
          lastText = "sin stream.php";
          return tryPrefix(prefixIndex + 1);
        }

        httpGet(
          streamUrl,
          { "User-Agent": "Mozilla/5.0", Referer: pageUrl, Accept: "text/html,*/*" },
          6e3,
          function (err2, streamBody, streamStatus) {
            if (err2 || 200 !== streamStatus || !streamBody) {
              lastText = err2 ? err2.message : "stream.php HTTP " + streamStatus;
              return tryPrefix(prefixIndex + 1);
            }
            var manifestUrl = findPlaylist(decodeHtml(streamBody));
            if (!manifestUrl) {
              lastText = "sin playlist";
              return tryPrefix(prefixIndex + 1);
            }
            /* Verifica que el manifiesto exista antes de entregarlo: un 404
               aquí es la causa de "el canal no reproduce" en la TV. */
            httpGet(
              manifestUrl,
              { "User-Agent": "Mozilla/5.0", Referer: streamUrl },
              6e3,
              function (err3, mBody, mStatus) {
                if (!err3 && 200 === mStatus && mBody && /#EXTM3U/i.test(mBody))
                  return acceptPlaylist(manifestUrl, streamUrl);
                lastText = "manifiesto HTTP " + (err3 ? "error" : mStatus);
                tryPrefix(prefixIndex + 1);
              }
            );
          }
        );
      }
    );
  };

  tryPrefix(0);
}

function diag() {
  var out = [],
    k,
    c;
  for (k in cache)
    if (Object.prototype.hasOwnProperty.call(cache, k)) {
      c = cache[k];
      out.push({
        code: k,
        url: String(c.url || "").slice(0, 60),
        leftMs: Math.max(0, c.expiresAt - now())
      });
    }
  return { cached: out, lastError: lastError };
}

module.exports = {
  resolve: resolve,
  channels: CHANNELS,
  diag: diag
};
