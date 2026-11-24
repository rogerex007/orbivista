(function () {
  "use strict";

  // Fondo, superficie, selección, texto destacado y acentos de categorías.
  var themes = [
    ["Orbivista", "#0c141f", "#131f2c", "#234052", "#73e5ce", "#a9c9ff", "#e7bbfa"],
    ["Tokyo Night", "#1a1b26", "#24283b", "#343b58", "#a9baff", "#bb9af7", "#7dcfff"],
    ["Dracula", "#21222c", "#282a36", "#44475a", "#ff92df", "#bd93f9", "#8be9fd"],
    ["Terminal", "#090e09", "#101b10", "#203422", "#9ef39f", "#74d68a", "#cced8b"],
    ["Nord", "#242933", "#2e3440", "#414b5e", "#a3d2e6", "#b0e1c7", "#dbb9e4"],
    ["Gruvbox", "#211c19", "#302820", "#49392b", "#ffbd65", "#d3d781", "#efa297"],
    ["Catppuccin Mocha", "#181825", "#232336", "#363651", "#cdb4ff", "#f5c2e7", "#a6e3a1"],
    ["Ayu Mirage", "#171d26", "#202938", "#374458", "#ffd580", "#a6ccff", "#b7df9d"],
    ["Monokai", "#1c1d17", "#292a22", "#3b3d31", "#ff86b0", "#d5ed83", "#93dce6"],
    ["Solarized Dark", "#002732", "#073642", "#15505a", "#9adaee", "#dfcf81", "#baedb0"],
    ["Everforest", "#202925", "#2b3531", "#3c4c43", "#bbd99b", "#9edecc", "#e8cc92"],
    ["Rosé Pine", "#191724", "#232136", "#3a334d", "#f1b7b9", "#c4a7e7", "#94d2de"],
    ["Océano", "#0c1927", "#11293b", "#1d4055", "#87e3f4", "#9baeff", "#8de0bc"],
    ["Ámbar", "#20170e", "#2e2115", "#493421", "#ffd088", "#e9a898", "#eae08e"],
    ["Medianoche", "#0c101d", "#161e32", "#293658", "#a6bdff", "#c4aafa", "#8ed8eb"],
    ["Alto contraste", "#090909", "#151515", "#292929", "#ffffff", "#ffe185", "#9bf8ed"]
  ];
  var storageKey = "orbivista_theme";
  var selected = 0;
  var stylesheet = document.createElement("style");
  document.head.appendChild(stylesheet);

  function style(selectors, declarations) {
    return selectors.map(function (selector) {
      return "#app " + selector;
    }).join(",") + "{" + declarations + "}";
  }

  function paint(index) {
    var theme = themes[index];
    if (!theme) return;
    selected = index;
    var background = theme[1], surface = theme[2], highlight = theme[3];
    var accent = theme[4], alternate = theme[5], third = theme[6];
    // Literal colors also work in pre-Chromium-49 versions of webOS.
    stylesheet.textContent = [
      "#app #screen-welcome,#app #screen-home,#app #screen-settings,#app #screen-search,#app #screen-section,#app #screen-detail,#app #screen-settings .settings-panel,#app #screen-settings .settings-right{background-color:" + background + "!important}",
      "#app #screen-home .home-tabs,#app #screen-settings .settings-menu,#app #screen-home .home-notify .notify-item,#app .catalog-filter-card,#app .orbivista-about-credits,#app .settings-right .sp-about-update-box,#app #screen-home .live-list,#app #screen-home .live-guide-header,#app #screen-home .live-fast .fast-btn,#app #screen-home .live-preview-standby,#app #player-categories .pcat-tile,#app #screen-search .search-keyboard .kb-key{background-color:" + surface + "!important}",
      "#app #screen-home .home-tabs .tab-item.is-selected,#app .settings-item.is-selected,#app #player-categories .pcat-tile.is-selected,#app #screen-home .live-row.is-current{background:" + highlight + "!important;box-shadow:inset 4px 0 " + accent + "!important}",
      "#app #screen-home .home-tabs .tab-item.is-focused,#app #screen-home .home-notify .notify-item.is-focused,#app .settings-item.is-focused,#app #screen-search .search-keyboard .kb-key.is-focused,#app #screen-home .live-fast .fast-btn.is-focused,#app #screen-home .live-row.is-focused,#app #player-categories .pcat-tile.is-focused,#app #player-categories .pcat-tile:hover,#app .pc-cat-pill.is-focused{background:" + highlight + "!important;border-color:" + accent + "!important;box-shadow:inset 0 0 0 2px " + accent + "!important}",
      "#app #screen-home .home-tabs .tab-item.is-selected .tab-icon,#app .live-guide-title,#app .pc-cat-badge,#app .pcat-name,#app .pc-cat-pill{color:" + accent + "!important}",
      "#app .pcat-tile:nth-child(3n+2) .pcat-name,#app .pc-cat-pill:nth-child(3n+2){color:" + alternate + "!important}",
      "#app .pcat-tile:nth-child(3n+3) .pcat-name,#app .pc-cat-pill:nth-child(3n+3){color:" + third + "!important}",
      "#app #screen-home .catalog-rail .is-focused,#app .theme-option.is-focused{outline-color:" + accent + "!important}",
      "#app .catalog-filter-refined .catalog-filter-choice.is-selected,#app .catalog-filter-refined .catalog-filter-group.is-selected,#app .catalog-filter-refined .catalog-filter-footer-btn.primary,#app .orbivista-about .sp-about-update-btn{background:" + highlight + "!important;box-shadow:inset 3px 0 " + accent + "!important}",
      "#app .catalog-filter-refined button.is-focused,#app .vod-skip.is-focused,#app .orbivista-about .sp-about-update-btn.is-focused{background:" + highlight + "!important;outline:2px solid " + accent + "!important}",
      "#app .welcome-loading span,#app .vod-seek-progress,#app .vod-seek-thumb{background:" + accent + "!important}",
      style([
        ".detail-btn:first-child", ".detail-season-btn.is-selected", ".detail-range.is-selected",
        ".detail-episode.is-playing.is-focused", ".catalog-filter-chip.is-selected"
      ], "background:" + highlight + "!important;border-color:" + accent + "!important;box-shadow:none!important"),
      style([
        "#screen-detail .detail-btn.is-focused", "#screen-detail .detail-btn:hover",
        "#screen-detail .detail-player.is-focused .detail-player-center-btn",
        "#screen-detail .detail-season-btn.is-focused", "#screen-detail .detail-episode.is-focused",
        "#screen-settings .account-action-btn.is-focused", "#screen-settings .account-action-btn:hover",
        "#screen-search .search-sug-chip.is-focused", "#screen-search .search-sug-chip:hover",
        "#screen-home .home-notify .notify-item:hover", "#screen-home .live-fast .fast-btn:hover",
        "#screen-home .live-fast .fast-btn.is-active", "#player-categories .pcat-close.is-focused",
        ".catalog-filter-chip.is-focused", ".da-exit-btn.is-focused", ".url-kb-act-btn.is-focused",
        "#da-btn-write-url.is-focused"
      ], "background:" + highlight + "!important;border-color:" + accent + "!important;box-shadow:inset 0 0 0 2px " + accent + "!important"),
      style([
        ".detail-update", ".detail-episode.is-playing", ".account-avatar", ".badge-vip",
        ".history-tab.is-selected", ".psv-season-btn.is-selected", ".psv-ep-btn.is-current",
        ".psv-ep-btn.is-selected", ".psv-range-btn.is-selected", ".section-cat-item.is-selected",
        "#player-categories .pcat-tile.is-selected", "#screen-home .live-row.is-current",
        ".player-channels .pc-row.is-current", "#da-btn-write-url"
      ], "border-color:" + accent + "!important"),
      style([
        ".detail-related", ".account-card-title", ".addons-panel .sp-title", ".catalog-filter-title",
        "#player-categories .pcat-head", ".da-title", ".url-kb-title"
      ], "border-left-color:" + accent + "!important"),
      style([
        ".detail-more", ".detail-player-icon", ".account-metric-card .am-label",
        "#screen-search .search-hot-total span", ".da-section-title"
      ], "color:" + accent + "!important"),
      style([
        ".welcome-brand .welcome-loading", ".history-rail-card .history-rail-bar"
      ], "background:" + highlight + "!important"),
      style([".history-rail-card .history-rail-fill"], "background:" + accent + "!important"),
      style([
        "#screen-player .player-playsetting-view.is-active", "#screen-player .player-episodes.is-active",
        "#screen-player .vod-skip"
      ], "background:" + surface + "!important"),
      style([
        "#screen-player .psv-row.is-row-focused .psv-title", "#screen-player .pe-col-label"
      ], "color:" + accent + "!important"),
      style([
        "#screen-player .psv-btn.is-focused", "#screen-player .psv-season-btn.is-focused",
        "#screen-player .psv-ep-btn.is-focused", "#screen-player .psv-range-btn.is-focused",
        "#screen-player .pe-season.is-focused", "#screen-player .pe-episode.is-focused",
        "#screen-player .vod-skip.is-focused"
      ], "background:" + highlight + "!important;border-color:" + accent + "!important;outline:2px solid " + accent + "!important"),
      index === 3 ? "#app #screen-home .tab-title,#app .pcat-name,#app #screen-settings .settings-label{font-family:monospace;color:" + accent + "!important}" : ""
    ].join("\n");
  }

  var savedTheme = 0;
  try {
    savedTheme = Number(localStorage.getItem(storageKey));
  } catch (err) {}
  paint(themes[savedTheme] ? savedTheme : 0);

  window.OrbivistaThemes = {
    list: themes,
    current: function () { return selected; },
    select: function (index) {
      paint(index);
      try {
        localStorage.setItem(storageKey, String(selected));
      } catch (err) {}
    }
  };
})();
