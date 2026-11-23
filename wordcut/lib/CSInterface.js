(function (global) {
  'use strict';

  function getCep() {
    return typeof window !== 'undefined' ? window.__adobe_cep__ : null;
  }

  function getHostEnvironment() {
    var cep = getCep();
    if (!cep || typeof cep.getHostEnvironment !== 'function') return null;
    try {
      return JSON.parse(cep.getHostEnvironment());
    } catch (e) {
      return null;
    }
  }

  function getOSInformation() {
    var userAgent = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
    if (/Windows/i.test(userAgent)) return 'Windows';
    if (/Mac/i.test(userAgent)) return 'Macintosh';
    if (/Linux/i.test(userAgent)) return 'Linux';
    return 'Unknown';
  }

  function normalizeSystemPath(rawPath) {
    var osInfo = getOSInformation();
    var path = decodeURI(rawPath || '');
    if (osInfo.indexOf('Windows') >= 0) {
      path = path.replace(/^file:\/\//, '');
      path = path.replace(/^\/+/, '');
      path = path.replace(/\//g, '\\');
    } else {
      path = path.replace(/^file:\/\//, '');
    }
    return path;
  }

  function CSInterface() {
    this.hostEnvironment = getHostEnvironment();
  }

  CSInterface.THEME_COLOR_CHANGED_EVENT = 'com.adobe.csxs.events.ThemeColorChanged';

  CSInterface.prototype.getHostEnvironment = function () {
    this.hostEnvironment = getHostEnvironment();
    return this.hostEnvironment;
  };

  CSInterface.prototype.getOSInformation = function () {
    return getOSInformation();
  };

  CSInterface.prototype.getSystemPath = function (pathType) {
    var cep = getCep();
    if (!cep || typeof cep.getSystemPath !== 'function') return '';
    return normalizeSystemPath(cep.getSystemPath(pathType));
  };

  CSInterface.prototype.evalScript = function (script, callback) {
    var cep = getCep();
    if (cep && typeof cep.evalScript === 'function') {
      cep.evalScript(script, typeof callback === 'function' ? callback : function () {});
      return;
    }
    if (typeof callback === 'function') {
      callback(JSON.stringify({ success: false, error: 'Not in Adobe host' }));
    }
  };

  CSInterface.prototype.addEventListener = function (eventName, handler) {
    var cep = getCep();
    if (cep && typeof cep.addEventListener === 'function') {
      cep.addEventListener(eventName, handler);
    }
  };

  CSInterface.prototype.removeEventListener = function (eventName, handler) {
    var cep = getCep();
    if (cep && typeof cep.removeEventListener === 'function') {
      cep.removeEventListener(eventName, handler);
    }
  };

  CSInterface.prototype.closeExtension = function () {
    var cep = getCep();
    if (cep && typeof cep.closeExtension === 'function') {
      cep.closeExtension();
    }
  };

  CSInterface.prototype.getCurrentApiVersion = function () {
    var cep = getCep();
    if (cep && typeof cep.getCurrentApiVersion === 'function') {
      return cep.getCurrentApiVersion();
    }
    return '0.0.0';
  };

  CSInterface.prototype.getHostCapabilities = function () {
    var env = this.getHostEnvironment();
    return env && env.appCapabilities ? env.appCapabilities : {};
  };

  CSInterface.prototype.openURLInDefaultBrowser = function (url) {
    var cep = getCep();
    if (cep && typeof cep.openURLInDefaultBrowser === 'function') {
      cep.openURLInDefaultBrowser(url);
    }
  };

  global.CSInterface = CSInterface;
  global.SystemPath = global.SystemPath || {
    USER_DATA: 'userData',
    APPLICATION: 'application',
    EXTENSION: 'extension',
    HOST_APPLICATION: 'hostApplication'
  };
})(this);
