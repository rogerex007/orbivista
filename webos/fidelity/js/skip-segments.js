/* VOD chapter markers and public intro databases. All timestamps are seconds. */
(function (global) {
  "use strict";

  var labels = {
    "intro": "intro",
    "introduction": "intro",
    "introduccion": "intro",
    "opening": "intro",
    "opening credits": "intro",
    "recap": "recap",
    "previously on": "recap",
    "resumen": "recap",
    "credits": "credits",
    "end credits": "credits",
    "closing credits": "credits",
    "outro": "credits",
    "creditos": "credits",
    "creditos finales": "credits",
    "post credits": "postCredits",
    "post credit scene": "postCredits",
    "post credits scene": "postCredits",
    "escena poscreditos": "postCredits",
    "escena postcreditos": "postCredits"
  };

  function cueKind(text) {
    text = String(text || "").toLowerCase().replace(/[áéíóú]/g, function (accent) {
      return "aeiou".charAt("áéíóú".indexOf(accent));
    })
      .replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
    return Object.prototype.hasOwnProperty.call(labels, text) ? labels[text] : "";
  }

  function put(out, key, start, end) {
    if (key && typeof start === "number" && isFinite(start) && start >= 0 &&
        (end === Infinity || typeof end === "number" && isFinite(end)) && end > start &&
        (!out[key] || start < out[key].start)) {
      out[key] = { start: start, end: end };
    }
  }

  function chapters(video) {
    var out = {};
    var tracks = video && video.textTracks;
    for (var i = 0; tracks && i < tracks.length; i++) {
      var track = tracks[i];
      if (track.kind !== "chapters") continue;
      if (track.mode === "disabled") track.mode = "hidden";
      for (var j = 0, cues = track.cues; cues && j < cues.length; j++) {
        var cue = cues[j];
        put(out, cueKind(cue.text), cue.startTime, cue.endTime);
      }
    }
    return out;
  }

  function addRemote(out, kind, spans, openEnd) {
    for (var i = 0; spans && i < spans.length; i++) {
      var span = spans[i];
      if (!span) continue;
      var start = span.start_ms === null && (kind === "intro" || kind === "recap") ? 0 :
        typeof span.start_ms === "number" ? span.start_ms / 1000 : NaN;
      var end = span.end_ms === null && openEnd ? Infinity :
        typeof span.end_ms === "number" ? span.end_ms / 1000 : NaN;
      put(out, kind, start, end);
    }
  }

  function merge(first, second) {
    var out = {};
    ["intro", "recap", "credits", "postCredits"].forEach(function (key) {
      if (first[key] || second[key]) out[key] = first[key] || second[key];
    });
    return out;
  }

  function lookup(query, callback, request) {
    var imdb = /^tt[0-9]{1,12}$/.test(query.imdb || "");
    var tmdb = /^[1-9][0-9]{0,10}$/.test(query.tmdb || "");
    if ((!imdb && !tmdb) || (query.series && !(typeof query.season === "number" &&
        query.season >= 0 && query.season % 1 === 0 && query.episode > 0 && query.episode % 1 === 0))) {
      return callback({});
    }
    request("theintrodb", query, function (data) {
      var primary = {};
      addRemote(primary, "intro", data.intro, false);
      addRemote(primary, "recap", data.recap, false);
      addRemote(primary, "credits", data.credits, true);
      if (!imdb || (query.series && primary.intro && primary.recap && primary.credits)) {
        return callback(primary);
      }
      request("introdb", query, function (data) {
        var secondary = {};
        if (!data.no_intro) addRemote(secondary, "intro", [data.intro], false);
        if (!data.no_recap) addRemote(secondary, "recap", [data.recap], false);
        if (!data.no_outro) addRemote(secondary, "credits", [data.outro], true);
        addRemote(secondary, "postCredits", [data.post_credits], true);
        callback(merge(primary, secondary));
      });
    });
  }

  global.XuperSkipSegments = { chapters: chapters, lookup: lookup, merge: merge };
})(window);
