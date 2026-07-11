const Module = require('node:module');
const path = require('node:path');

const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.endsWith('.js')) {
    const tsRequest = request.replace(/\.js$/, '.ts');

    try {
      return originalResolveFilename.call(
        this,
        tsRequest,
        parent,
        isMain,
        options,
      );
    } catch {
      // fall through to default resolution
    }
  }

  return originalResolveFilename.call(this, request, parent, isMain, options);
};
