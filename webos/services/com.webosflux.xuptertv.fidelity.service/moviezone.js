"use strict";

var https = require("https"),
  http = require("http"),
  url = require("url");

var dnsx;
try {
  dnsx = require("./dnsx");
} catch (e) {
  dnsx = null;
}

var BASE_API = "https://lamovie.org/wp-api/v1",
  UPLOADS_BASE = "https://lamovie.org/wp-content/uploads",
  USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

var cache = {},
  CACHE_TTL = 300000; // 5 min

var getCache = function (key) {
  var entry = cache[key];
  if (entry && Date.now() - entry.at < CACHE_TTL) {
    return entry.val;
  }
  return null;
};

var setCache = function (key, val) {
  cache[key] = { at: Date.now(), val: val };
};

var fetchText = function (targetUrl, headers, cb) {
  var parsed = url.parse(targetUrl);
  var isHttps = "https:" === parsed.protocol;
  var mod = isHttps ? https : http;

  var doReq = function (reqOpts) {
    var req;
    try {
      req = mod.request(reqOpts, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          var redirectUrl = url.resolve(targetUrl, res.headers.location);
          return fetchText(redirectUrl, headers, cb);
        }
        var chunks = [];
        res.on("data", function (c) {
          chunks.push(c);
        });
        res.on("error", function (err) {
          cb(err);
        });
        res.on("end", function () {
          var body = Buffer.concat(chunks).toString("utf8");
          cb(null, res.statusCode, body);
        });
      });
    } catch (e) {
      return cb(e);
    }

    req.on("error", function (e) {
      cb(e);
    });
    req.setTimeout(12000, function () {
      try {
        req.abort();
      } catch (e) {}
      cb(new Error("timeout en " + targetUrl));
    });
    req.end();
  };

  var defaultHeaders = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/json,*/*",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
  };
  var k;
  if (headers) {
    for (k in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, k)) {
        defaultHeaders[k] = headers[k];
      }
    }
  }

  var baseOpts = {
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.path,
    method: "GET",
    headers: defaultHeaders,
    rejectUnauthorized: false
  };

  if (dnsx && "function" == typeof dnsx.prepare) {
    dnsx.prepare(baseOpts, function (err, preparedOpts) {
      if (err || !preparedOpts) {
        doReq(baseOpts);
      } else {
        preparedOpts.rejectUnauthorized = false;
        doReq(preparedOpts);
      }
    });
  } else {
    doReq(baseOpts);
  }
};

var fetchJson = function (targetUrl, headers, cb) {
  fetchText(targetUrl, headers, function (err, code, body) {
    if (err) return cb(err);
    if (code < 200 || code >= 400) {
      return cb(new Error("HTTP " + code + " en " + targetUrl));
    }
    var parsed;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      return cb(new Error("JSON inválido de " + targetUrl));
    }
    cb(null, parsed);
  });
};

var unpackDeanEdwards = function (html) {
  if (!html) return null;
  var m = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]+?\.split\('\|'\)\)\)/);
  if (!m) return null;
  try {
    var fnBody = m[0].replace(/^eval/, "return ");
    return new Function(fnBody)();
  } catch (e) {
    return null;
  }
};

var extractSubtitles = function (code) {
  var subs = [];
  if (!code) return subs;
  var regex = /file:\s*["'](https?:\/\/[^"']+\.vtt[^"']*)["'][^}]*label:\s*["']([^"']+)["']/g;
  var m;
  while ((m = regex.exec(code)) !== null) {
    var label = m[2] || "Español";
    var lang = (label.toLowerCase().indexOf("span") !== -1 || label.toLowerCase().indexOf("es") !== -1) ? "es" : "en";
    subs.push({
      url: m[1],
      lang: lang,
      format: "vtt"
    });
  }
  return subs.slice(0, 10);
};

var resolveImageUrl = function (img) {
  if (!img || typeof img !== "string") return "";
  var trimmed = img.trim();
  if (0 === trimmed.indexOf("http://") || 0 === trimmed.indexOf("https://")) {
    return trimmed;
  }
  if (0 === trimmed.indexOf("/")) {
    return UPLOADS_BASE + trimmed;
  }
  return UPLOADS_BASE + "/" + trimmed;
};

var toCatalogItem = function (post, fallbackCategory, fallbackRow) {
  if (!post || typeof post !== "object") return null;

  var postType = post.type || "";
  var isSeries = "tvshows" === postType || "animes" === postType || "novels" === postType || "wwe" === postType;
  var isCollection = "collections" === postType;

  var kind = (isSeries || isCollection) ? "serie" : "película";
  var type = (isSeries || isCollection) ? "teleplay" : "movie";
  var id = "mz_" + (postType || (isSeries ? "tvshows" : "movies")) + "_" + post._id;

  var year = "—";
  if (post.release_date && typeof post.release_date === "string") {
    var y = parseInt(post.release_date.slice(0, 4), 10);
    if (!isNaN(y) && y > 1900 && y < 2100) year = String(y);
  }
  if ("—" === year && post.title) {
    var ym = String(post.title).match(/\((\d{4})\)/);
    if (ym) year = ym[1];
  }

  var poster = "";
  var backdrop = "";

  if (Array.isArray(post.images) && post.images.length > 0) {
    var firstImg = post.images[0];
    if (firstImg && typeof firstImg === "object") {
      poster = resolveImageUrl(firstImg.poster);
      backdrop = resolveImageUrl(firstImg.backdrop);
    }
  } else if (post.images && typeof post.images === "object") {
    poster = resolveImageUrl(post.images.poster);
    backdrop = resolveImageUrl(post.images.backdrop);
  }

  if (!poster && Array.isArray(post.galleries) && post.galleries.length > 0) {
    var firstGallery = post.galleries[0];
    if (typeof firstGallery === "string") {
      var matchPath = firstGallery.trim().split("\n")[0];
      if (matchPath) {
        poster = matchPath.indexOf("http") === 0 ? matchPath : "https://image.tmdb.org/t/p/w500" + matchPath.trim();
      }
    }
  }

  var score = "—";
  if (post.rating) {
    score = String(post.rating);
  } else if (post.community_rating) {
    score = String(post.community_rating);
  }

  var duration = "";
  if (post.runtime) {
    var rFloat = parseFloat(post.runtime);
    if (!isNaN(rFloat) && rFloat > 0) {
      duration = Math.round(rFloat) + " min";
    }
  }

  return {
    id: id,
    imdbId: String(post.imdb_id || post.imdbId || ""),
    tmdbId: String(post.tmdb_id || post.tmdbId || ""),
    title: String(post.title || post.original_title || ""),
    name: String(post.title || post.original_title || ""),
    category: fallbackCategory || (isSeries ? "series" : "movies"),
    kind: kind,
    score: score,
    year: year,
    duration: duration,
    genres: [],
    director: "",
    actors: "",
    synopsis: String(post.overview || ""),
    poster: poster,
    landscape: backdrop || poster,
    backdrop: backdrop || poster,
    type: type,
    alias: String(post.original_title || ""),
    country: "",
    releaseDate: String(post.release_date || ""),
    tagline: String(post.tagline || ""),
    volumeCount: isSeries ? 1 : 0,
    updateCount: 0,
    moreAudio: 0,
    moreSubtitle: 0,
    row: fallbackRow || (isSeries ? "MovieZone · Series" : "MovieZone · Películas"),
    streamUrl: "",
    source: "moviezone",
    portal: false
  };
};

var home = function (root, pageNum, cb) {
  var cat = String(root || "movies").toLowerCase();
  var page = Math.max(1, parseInt(pageNum, 10) || 1);

  var postType = "movies";
  var rowTitle = "Películas";
  if ("series" === cat) {
    postType = "tvshows";
    rowTitle = "Series de TV";
  } else if ("anime" === cat) {
    postType = "animes";
    rowTitle = "Anime";
  } else if ("kids" === cat) {
    postType = "movies";
    rowTitle = "Animación y Familia";
  } else if ("featured" === cat) {
    postType = "movies";
    rowTitle = "Novedades y Estrenos";
  }

  var cacheKey = "home:" + cat + ":" + page;
  var cached = getCache(cacheKey);
  if (cached) {
    return cb(null, { root: cat, pageNum: page, items: cached, cached: true });
  }

  var u = BASE_API + "/listing/movies?page=" + page + "&orderBy=ID&order=desc&postType=" + postType + "&postsPerPage=40";
  fetchJson(u, {}, function (err, res) {
    if (err) return cb(err);
    var posts = (res && res.data && Array.isArray(res.data.posts)) ? res.data.posts : [];
    var items = [];
    var i;
    for (i = 0; i < posts.length; i++) {
      var item = toCatalogItem(posts[i], cat, rowTitle);
      if (item && item.id) {
        items.push(item);
      }
    }
    setCache(cacheKey, items);
    cb(null, { root: cat, pageNum: page, items: items, cached: false });
  });
};

var search = function (query, pageNum, cb) {
  var q = String(query || "").trim();
  if (!q) return cb(null, { items: [] });
  var page = Math.max(1, parseInt(pageNum, 10) || 1);

  var cacheKey = "search:" + q.toLowerCase() + ":" + page;
  var cached = getCache(cacheKey);
  if (cached) {
    return cb(null, { items: cached, cached: true });
  }

  var movieUrl = BASE_API + "/search?q=" + encodeURIComponent(q) + "&postType=movies";
  var seriesUrl = BASE_API + "/search?q=" + encodeURIComponent(q) + "&postType=tvshows";

  fetchJson(movieUrl, {}, function (err1, res1) {
    var posts1 = (res1 && res1.data && Array.isArray(res1.data.posts)) ? res1.data.posts : [];
    fetchJson(seriesUrl, {}, function (err2, res2) {
      var posts2 = (res2 && res2.data && Array.isArray(res2.data.posts)) ? res2.data.posts : [];
      var allPosts = posts1.concat(posts2);
      var items = [];
      var seen = {};
      var i;
      for (i = 0; i < allPosts.length; i++) {
        var p = allPosts[i];
        if (p && p._id && !seen[p._id]) {
          seen[p._id] = true;
          var item = toCatalogItem(p, p.type === "tvshows" ? "series" : "movies", "Resultados de búsqueda");
          if (item) items.push(item);
        }
      }
      setCache(cacheKey, items);
      cb(null, { items: items, total: items.length, cached: false });
    });
  });
};

var parseId = function (idStr) {
  var s = String(idStr || "");
  if (0 === s.indexOf("mz_")) s = s.slice(3);
  var parts = s.split("_");
  var type = "movies";
  var id = s;
  if (parts.length >= 2) {
    type = parts[0];
    id = parts.slice(1).join("_");
  }
  return { type: type, id: id };
};

var detail = function (contentId, cb) {
  var parsed = parseId(contentId);
  var postId = parsed.id;
  var postType = parsed.type;
  var isSeries = "tvshows" === postType || "animes" === postType || "novels" === postType || "ep" === postType;

  if (isSeries) {
    var epUrl = BASE_API + "/single/episodes/list?_id=" + encodeURIComponent(postId) + "&season=1&page=1&postsPerPage=100";
    fetchJson(epUrl, {}, function (err, res) {
      var episodes = [];
      var seasons = [];
      var data = res && res.data;
      var posts = (data && Array.isArray(data.posts)) ? data.posts : [];
      var rawSeasons = (data && Array.isArray(data.seasons)) ? data.seasons : [1];

      var sIdx;
      for (sIdx = 0; sIdx < rawSeasons.length; sIdx++) {
        var sn = parseInt(rawSeasons[sIdx], 10);
        if (!isNaN(sn)) seasons.push(sn);
      }
      if (0 === seasons.length) seasons.push(1);

      var epIdx;
      for (epIdx = 0; epIdx < posts.length; epIdx++) {
        var ep = posts[epIdx];
        if (ep && ep._id) {
          var epNum = ep.episode_number || (epIdx + 1);
          var epStill = "";
          if (ep.images && ep.images.still) {
            epStill = resolveImageUrl(ep.images.still);
          }
          episodes.push({
            id: "mz_ep_" + ep._id,
            title: ep.title || ("Episodio " + epNum),
            name: ep.title || ("Episodio " + epNum),
            number: epNum,
            duration: ep.runtime ? String(ep.runtime) + " min" : "",
            quality: "HD",
            picture: epStill,
            seriesId: contentId
          });
        }
      }

      var item = {
        id: contentId,
        title: (posts[0] && posts[0].title) || "Serie MovieZone",
        name: (posts[0] && posts[0].title) || "Serie MovieZone",
        kind: "serie",
        type: "teleplay",
        category: "series",
        episodes: episodes,
        seasons: seasons,
        source: "moviezone",
        portal: false
      };

      cb(null, { item: item, episodes: episodes, seasons: seasons });
    });
  } else {
    var itemMovie = {
      id: contentId,
      title: "Película MovieZone",
      name: "Película MovieZone",
      kind: "película",
      type: "movie",
      category: "movies",
      episodes: [],
      seasons: [],
      source: "moviezone",
      portal: false
    };
    cb(null, { item: itemMovie, episodes: [], seasons: [] });
  }
};

var resolve = function (contentId, seriesContentId, opts, cb) {
  var idToResolve = contentId;
  if (seriesContentId && (!contentId || contentId === seriesContentId)) {
    idToResolve = seriesContentId;
  }
  var parsed = parseId(idToResolve);
  var postId = parsed.id;
  var isSeries = "tvshows" === parsed.type || "animes" === parsed.type || "novels" === parsed.type;

  var proceedWithPostId = function (actualPostId) {
    var playerUrl = BASE_API + "/player?postId=" + encodeURIComponent(actualPostId) + "&demo=0";
    fetchJson(playerUrl, {}, function (err, res) {
      if (err) return cb(err);
      var embeds = (res && res.data && Array.isArray(res.data.embeds)) ? res.data.embeds : [];
      if (0 === embeds.length) {
        return cb(new Error("MovieZone: no hay servidores de video disponibles"));
      }

      var validEmbeds = [];
      var i;
      for (i = 0; i < embeds.length; i++) {
        var e = embeds[i];
        if (e && e.url && e.url.indexOf("embed.html?v=1") === -1) {
          validEmbeds.push(e);
        }
      }
      if (0 === validEmbeds.length) {
        return cb(new Error("MovieZone: video aún no disponible"));
      }

      validEmbeds.sort(function (a, b) {
        var aIsV = (a.url || "").indexOf("vimeos.net") !== -1 || (a.url || "").indexOf("videoapp.zip") !== -1;
        var bIsV = (b.url || "").indexOf("vimeos.net") !== -1 || (b.url || "").indexOf("videoapp.zip") !== -1;
        if (aIsV && !bIsV) return -1;
        if (!aIsV && bIsV) return 1;
        return 0;
      });

      var processEmbed = function (idx) {
        if (idx >= validEmbeds.length) {
          return cb(new Error("MovieZone: no se pudo extraer stream compatible"));
        }
        var targetEmbed = validEmbeds[idx];
        var embedUrl = targetEmbed.url || "";

        var handleVimeos = function (vUrl) {
          fetchText(vUrl, { "Referer": "https://lamovie.org/" }, function (err, code, html) {
            if (err || !html) return processEmbed(idx + 1);
            var unpacked = unpackDeanEdwards(html);
            if (!unpacked) return processEmbed(idx + 1);
            var m3u8Match = unpacked.match(/file:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
            if (m3u8Match && m3u8Match[1]) {
              var m3u8Url = m3u8Match[1];
              var subs = extractSubtitles(unpacked);
              return cb(null, {
                url: m3u8Url,
                mime: "application/vnd.apple.mpegurl",
                headers: {
                  "Referer": "https://vimeos.net/",
                  "User-Agent": USER_AGENT
                },
                subtitles: subs,
                duration: 0,
                isHls: true,
                source: "moviezone"
              });
            }
            processEmbed(idx + 1);
          });
        };

        if (embedUrl.indexOf("videoapp.zip") !== -1) {
          fetchText(embedUrl, { "Referer": "https://lamovie.org/" }, function (err, code, html) {
            if (err || !html) return processEmbed(idx + 1);
            var ifr = html.match(/<iframe[^>]+src=["'](https?:\/\/[^"']+)["']/i);
            if (ifr && ifr[1]) {
              handleVimeos(ifr[1]);
            } else {
              processEmbed(idx + 1);
            }
          });
        } else if (embedUrl.indexOf("vimeos.net") !== -1) {
          handleVimeos(embedUrl);
        } else {
          processEmbed(idx + 1);
        }
      };

      processEmbed(0);
    });
  };

  if (isSeries) {
    var epListUrl = BASE_API + "/single/episodes/list?_id=" + encodeURIComponent(postId) + "&season=1&page=1&postsPerPage=1";
    fetchJson(epListUrl, {}, function (err, res) {
      if (!err && res && res.data && Array.isArray(res.data.posts) && res.data.posts[0] && res.data.posts[0]._id) {
        proceedWithPostId(res.data.posts[0]._id);
      } else {
        proceedWithPostId(postId);
      }
    });
  } else {
    proceedWithPostId(postId);
  }
};

module.exports = {
  home: home,
  search: search,
  detail: detail,
  resolve: resolve,
  isMovieZoneId: function (id) {
    return typeof id === "string" && 0 === id.indexOf("mz_");
  }
};
