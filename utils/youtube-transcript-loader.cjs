// Wrapper to load youtube-transcript CJS bundle in a Node.js project
// The youtube-transcript package has "type": "module" in its package.json,
// which prevents Node.js from loading its CJS exports via require().
// This wrapper reads and evaluates the CJS bundle directly.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const cjsPath = path.join(__dirname, '..', 'node_modules', 'youtube-transcript', 'dist', 'youtube-transcript.common.js');
const code = fs.readFileSync(cjsPath, 'utf8');

const moduleExports = {};
const moduleObj = { exports: moduleExports };

const context = {
  exports: moduleExports,
  module: moduleObj,
  require,
  console,
  fetch: globalThis.fetch,
  URL,
  Symbol,
  Object,
  String,
  Array,
  parseInt,
  parseFloat,
  Error,
  RegExp,
  Promise,
  setTimeout,
  clearTimeout,
};

vm.runInNewContext(code, context);

module.exports = moduleObj.exports;
