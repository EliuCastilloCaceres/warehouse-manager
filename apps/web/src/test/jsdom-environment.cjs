// jsdom no trae las APIs de fetch de Node (Request, Response, Headers…), y React Router 8
// crea un Request en cada navegación. Se copian las de Node al entorno de cada test.
// AbortController/AbortSignal también van de Node: el Request de Node exige su propia señal.
// FormData y Blob se quedan los de jsdom (React hace `new FormData(form)` al enviar).
const { TestEnvironment } = require('jest-environment-jsdom');

const FROM_NODE = [
  'Request',
  'Response',
  'Headers',
  'ReadableStream',
  'AbortController',
  'AbortSignal',
  'structuredClone',
];

class JsdomWithFetchApis extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    for (const name of FROM_NODE) {
      if (typeof globalThis[name] !== 'undefined') this.global[name] = globalThis[name];
    }
  }
}

module.exports = JsdomWithFetchApis;
