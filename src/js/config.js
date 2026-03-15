(function registerLiterateGogglesConfig() {
  const defaults = {
    chessDailyGameLimit: 5,
  };

  if (!globalThis.LiterateGogglesConfig) {
    globalThis.LiterateGogglesConfig = {};
  }

  if (!globalThis.LiterateGogglesDefaultConfig) {
    globalThis.LiterateGogglesDefaultConfig = {};
  }

  Object.entries(defaults).forEach(([key, value]) => {
    if (!(key in globalThis.LiterateGogglesConfig)) {
      globalThis.LiterateGogglesConfig[key] = value;
    }
    if (!(key in globalThis.LiterateGogglesDefaultConfig)) {
      globalThis.LiterateGogglesDefaultConfig[key] = value;
    }
  });
})();
