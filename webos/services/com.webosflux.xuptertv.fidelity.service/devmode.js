"use strict";

var fs = require("fs"),
  https = require("https"),
  crypto = require("crypto"),
  querystring = require("querystring");

var DEVMODE_FILE = "/var/luna/preferences/devmode_enabled";
var API_BASE = "https://lg.pirate.vodka";
var UA_STRING = "Mozilla/5.0 (Web0S; SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Safari/537.36 WebAppManager";

var devModeState = {
  enabled: false,
  registered: false,
  checking: false,
  token: "",
  keyHash: "",
  lastCheck: 0,
  message: "Modo desarrollador no detectado",
  error: ""
};

var postForm = function (path, dataObj, cb) {
  var data = querystring.stringify(dataObj || {});
  var fullUrl = API_BASE + path;
  var req;

  var opts = {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(data),
      "Accept": "application/json",
      "User-Agent": UA_STRING,
      "Origin": API_BASE,
      "Referer": API_BASE + "/"
    },
    rejectUnauthorized: false
  };

  try {
    req = https.request(fullUrl, opts, function (res) {
      var chunks = [];
      res.on("data", function (c) {
        chunks.push(c);
      });
      res.on("error", function (e) {
        cb(e);
      });
      res.on("end", function () {
        var body = Buffer.concat(chunks).toString("utf8");
        var parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch (pe) {
          return cb(new Error("Respuesta no JSON del servidor de renovación (HTTP " + res.statusCode + ")"));
        }
        cb(null, res.statusCode, parsed);
      });
    });
  } catch (err) {
    return cb(err);
  }

  req.on("error", function (e) {
    cb(e);
  });

  req.setTimeout(12000, function () {
    try {
      req.abort();
    } catch (e) {}
    cb(new Error("Timeout en servidor de renovación"));
  });

  req.write(data);
  req.end();
};

var readDevToken = function () {
  try {
    if (fs.existsSync(DEVMODE_FILE)) {
      var content = fs.readFileSync(DEVMODE_FILE, "utf8").trim();
      if (content && content.length > 0) {
        devModeState.enabled = true;
        devModeState.token = content;
        devModeState.keyHash = crypto.createHash("sha256").update(content, "utf8").digest("hex");
        return content;
      }
    }
  } catch (e) {
    devModeState.error = e.message;
  }
  devModeState.enabled = false;
  return null;
};

var registerToken = function (token, cb) {
  postForm("", { key: token, action: "add" }, function (err, code, res) {
    if (err) {
      devModeState.error = err.message;
      return cb(err);
    }
    if (code >= 200 && code < 300) {
      devModeState.registered = true;
      devModeState.message = "Renovación automática de Modo Dev activa (24/7)";
      devModeState.error = "";
      console.log("[devmode] Token registrado exitosamente en lg.pirate.vodka");
      return cb(null, devModeState);
    }
    var errText = (res && res.error) || ("HTTP " + code);
    devModeState.error = errText;
    cb(new Error("Error al registrar: " + errText));
  });
};

var checkAndRenew = function (cb) {
  cb = cb || function () {};
  var token = readDevToken();
  if (!token) {
    devModeState.message = "Modo desarrollador no activo en esta TV";
    return cb(null, devModeState);
  }

  devModeState.checking = true;
  postForm("/api/key-status", { key_hash: devModeState.keyHash }, function (err, code, res) {
    devModeState.checking = false;
    devModeState.lastCheck = Date.now();

    if (err) {
      devModeState.error = err.message;
      return cb(err);
    }

    if (res && res.registered) {
      devModeState.registered = true;
      devModeState.message = "Renovación automática de Modo Dev activa (24/7)";
      devModeState.error = "";
      console.log("[devmode] Token ya se encuentra registrado y activo para renovación");
      return cb(null, devModeState);
    }

    console.log("[devmode] Token no registrado aún, enviando registro...");
    registerToken(token, cb);
  });
};

var init = function () {
  // Comprobación inicial diferida para no retrasar el ping del servicio Luna
  setTimeout(function () {
    checkAndRenew(function (err) {
      if (err) {
        console.log("[devmode] Aviso inicial de renovación devmode: " + (err.message || err));
      }
    });
  }, 10000);

  // Verificación periódica cada 12 horas
  setInterval(function () {
    checkAndRenew();
  }, 12 * 3600 * 1000);
};

module.exports = {
  init: init,
  checkAndRenew: checkAndRenew,
  status: function () {
    if (!devModeState.token) {
      readDevToken();
    }
    return {
      enabled: devModeState.enabled,
      registered: devModeState.registered,
      checking: devModeState.checking,
      message: devModeState.message,
      lastCheck: devModeState.lastCheck,
      error: devModeState.error
    };
  }
};
