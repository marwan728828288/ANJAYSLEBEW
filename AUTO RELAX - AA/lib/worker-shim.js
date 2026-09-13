var _origLog = console.log;
var _origWarn = console.warn;
var _origErr = console.error;

function _isBlocked(msg) {
  if (typeof msg !== 'string') return false;
  return msg.indexOf('diacritics') >= 0
    || msg.indexOf('Image too small') >= 0
    || msg.indexOf('Line cannot be recognized') >= 0
    || msg.indexOf('readline') >= 0
    || msg.indexOf('fsync') >= 0
    || msg.indexOf('pixScaleSmooth') >= 0
    || msg.indexOf('ridiculously small') >= 0
    || msg.indexOf('Bottom=') >= 0
    || msg.indexOf('total coun') >= 0;
}

console.log = function() {};
console.warn = function() {};
console.error = function() {};

importScripts('worker.min.js');
