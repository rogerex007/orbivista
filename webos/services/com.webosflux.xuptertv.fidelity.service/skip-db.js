"use strict";

var https = require("https");
var retryAfter = {};

function lookup(query, callback) {
  var provider = query.provider;
  var imdb = /^tt[0-9]{1,12}$/.test(query.imdb || "") ? query.imdb : "";
  var tmdb = /^[1-9][0-9]{0,10}$/.test(query.tmdb || "") ? query.tmdb : "";
  var series = query.series === true || query.series === "true";
  var season = String(query.season == null ? "" : query.season);
  var episode = String(query.episode == null ? "" : query.episode);
  if ((provider !== "theintrodb" && provider !== "introdb") ||
      (!imdb && !tmdb) || (provider === "introdb" && !imdb) ||
      (series && (!/^[0-9]{1,4}$/.test(season) || !/^[1-9][0-9]{0,4}$/.test(episode))) ||
      retryAfter[provider] > Date.now()) return callback(null, { segments: {} });

  var tv = series ? "&season=" + season + "&episode=" + episode : "";
  var host, path;
  if (provider === "theintrodb") {
    host = "api.theintrodb.org";
    var id = tmdb && series ? "tmdb_id=" + tmdb : imdb ? "imdb_id=" + imdb : "tmdb_id=" + tmdb;
    var duration = Math.round(Number(query.duration) * 1000);
    path = "/v4/media?" + id + tv;
    if (duration > 0 && duration <= 86400000) path += "&duration_ms=" + duration;
  } else {
    host = "api.introdb.app";
    path = "/segments?imdb_id=" + imdb + (tv || "&is_movie=true");
  }

  var settled = false, request;
  var timer = setTimeout(function () {
    finish(null);
    if (request) request.abort();
  }, 4500);
  function finish(data) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    callback(null, { segments: data && typeof data === "object" ? data : {} });
  }
  try {
    request = https.get({ hostname: host, path: path, headers: { Accept: "application/json" } }, function (res) {
      if (res.statusCode !== 200) {
        if (res.statusCode === 429) {
          var wait = Number(res.headers["retry-after"]) || 60;
          retryAfter[provider] = Date.now() + Math.max(60, Math.min(wait, 3600)) * 1000;
        }
        res.resume();
        return finish(null);
      }
      var data = "";
      res.setEncoding("utf8");
      res.on("data", function (chunk) {
        data += chunk;
        if (data.length > 65536) {
          finish(null);
          request.abort();
        }
      });
      res.on("error", function () { finish(null); });
      res.on("end", function () {
        if (settled) return;
        var result;
        try { result = JSON.parse(data); } catch (error) { }
        finish(result);
      });
    });
    request.on("error", function () { finish(null); });
  } catch (error) {
    finish(null);
  }
}

module.exports = { lookup: lookup };
