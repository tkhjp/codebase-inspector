/* global require */
"use strict";

const childProcess = require("node:child_process");
const dgram = require("node:dgram");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const path = require("node:path");
const tls = require("node:tls");
const { promisify } = require("node:util");
const { syncBuiltinESMExports } = require("node:module");

const config = JSON.parse(process.env.CODEBASE_INSPECTOR_GUARD_CONFIG);
const isPrimary = process.env.CODEBASE_INSPECTOR_GUARD_PRIMARY === "1";
delete process.env.CODEBASE_INSPECTOR_GUARD_PRIMARY;

function guardError(kind) {
  const error = new Error(`guard blocked ${kind}`);
  error.code = "CODEBASE_INSPECTOR_GUARD";
  return error;
}

function reject(kind) {
  return () => {
    throw guardError(kind);
  };
}

const original = {
  exec: childProcess.exec,
  execFile: childProcess.execFile,
  execFileSync: childProcess.execFileSync,
  execSync: childProcess.execSync,
  fork: childProcess.fork,
  spawn: childProcess.spawn,
  spawnSync: childProcess.spawnSync
};
const gitOperations = new Set([
  ["rev-parse", "--show-toplevel"],
  ["rev-parse", "--absolute-git-dir"],
  ["ls-files", "-z"],
  ["rev-parse", "HEAD"],
  ["show", "-s", "--format=%cI", "HEAD"],
  ["status", "--porcelain=v1", "-z"],
  ["rev-parse", "--git-path", "info/exclude"]
].map((args) => JSON.stringify(args)));
const npmOperations = new Set([
  ["ls", "--omit=dev", "--silent"],
  ["ci", "--omit=dev"]
].map((args) => JSON.stringify(args)));

function allowed(command, args = [], options = {}) {
  if (command === "git"
    && args[0] === "-C"
    && path.resolve(args[1]) === path.resolve(config.root)
    && gitOperations.has(JSON.stringify(args.slice(2)))) return true;
  const executable = path.basename(String(command)).toLowerCase();
  return (executable === "npm" || executable === "npm.cmd")
    && path.resolve(options.cwd ?? "") === path.resolve(config.skillDir)
    && npmOperations.has(JSON.stringify(args));
}

function guarded(name) {
  return function guardProcess(command, args, options) {
    if (!allowed(command, args, options)) throw guardError(`child_process.${name}`);
    return original[name].apply(this, arguments);
  };
}

childProcess.spawn = guarded("spawn");
childProcess.execFile = guarded("execFile");
childProcess.execFile[promisify.custom] = function guardedExecFilePromise(command, args, options) {
  if (!allowed(command, args, options)) return Promise.reject(guardError("child_process.execFile"));
  return original.execFile[promisify.custom](command, args, options);
};
childProcess.spawnSync = guarded("spawnSync");
childProcess.execFileSync = guarded("execFileSync");
childProcess.exec = reject("child_process.exec");
childProcess.execSync = reject("child_process.execSync");
childProcess.fork = reject("child_process.fork");

net.connect = reject("net.connect");
net.createConnection = reject("net.createConnection");
net.Socket.prototype.connect = reject("net.Socket.prototype.connect");
tls.connect = reject("tls.connect");
dgram.createSocket = reject("dgram.createSocket");
dgram.Socket.prototype.send = reject("dgram.Socket.prototype.send");
dgram.Socket.prototype.connect = reject("dgram.Socket.prototype.connect");
http.request = reject("http.request");
http.get = reject("http.get");
https.request = reject("https.request");
https.get = reject("https.get");
if (typeof globalThis.fetch === "function") globalThis.fetch = reject("global.fetch");
if (typeof globalThis.WebSocket === "function") {
  globalThis.WebSocket = class GuardedWebSocket {
    constructor() {
      throw guardError("global.WebSocket");
    }
  };
}
syncBuiltinESMExports();

if (isPrimary) {
  const triggered = [];
  const prove = (name, action) => {
    try {
      action();
    } catch (error) {
      if (error?.code === "CODEBASE_INSPECTOR_GUARD") {
        triggered.push(name);
        return;
      }
      throw error;
    }
    throw new Error(`guard self-test did not block ${name}`);
  };

  prove("child_process.exec", () => childProcess.exec("unexpected-codebase-inspector-process"));
  prove("child_process.execFile", () => childProcess.execFile(process.execPath, [config.processProbe]));
  prove("child_process.execFileSync", () => childProcess.execFileSync(process.execPath, [config.processProbe]));
  prove("child_process.execSync", () => childProcess.execSync("unexpected-codebase-inspector-process"));
  prove("child_process.fork", () => childProcess.fork(config.processProbe));
  prove("child_process.spawn", () => childProcess.spawn(process.execPath, [config.processProbe]));
  prove("child_process.spawnSync", () => childProcess.spawnSync(process.execPath, [config.processProbe]));
  prove("net.connect", () => net.connect(1));
  prove("net.createConnection", () => net.createConnection(1));
  prove("net.Socket.prototype.connect", () => net.Socket.prototype.connect.call({}, 1));
  prove("tls.connect", () => tls.connect(1));
  prove("dgram.createSocket", () => dgram.createSocket("udp4"));
  prove("dgram.Socket.prototype.send", () => dgram.Socket.prototype.send.call({}, "x", 1, "127.0.0.1"));
  prove("dgram.Socket.prototype.connect", () => dgram.Socket.prototype.connect.call({}, 1, "127.0.0.1"));
  prove("http.request", () => http.request("http://127.0.0.1"));
  prove("http.get", () => http.get("http://127.0.0.1"));
  prove("https.request", () => https.request("https://127.0.0.1"));
  prove("https.get", () => https.get("https://127.0.0.1"));
  if (typeof globalThis.fetch === "function") prove("global.fetch", () => globalThis.fetch("http://127.0.0.1"));
  if (typeof globalThis.WebSocket === "function") prove("global.WebSocket", () => new globalThis.WebSocket("ws://127.0.0.1"));
  fs.writeFileSync(config.proofPath, `${JSON.stringify(triggered, null, 2)}\n`);
}
