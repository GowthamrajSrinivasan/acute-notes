// The narrow, validated renderer -> main storage boundary. The renderer can only name a (service, method) pair that
// exists in contract.json, with arguments of the declared kinds; it can never send SQL.
const { StorageError } = require("./db.cjs");
const contract = require("./contract.json");

const CHANNEL = "acute:storage";
const TRUSTED_PREFIX = "acute://app/";
const MAX_ID = 1024;
const MAX_LIST = 100_000;
const MAX_BYTES = 256 * 1024 * 1024;

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && !ArrayBuffer.isView(v);
const isId = (v) => typeof v === "string" && v.length > 0 && v.length <= MAX_ID;
const isInt = (v) => Number.isSafeInteger(v);
const isBytes = (v) => v instanceof Uint8Array && v.byteLength <= MAX_BYTES;

const KINDS = {
  id: isId,
  optId: (v) => v === undefined || isId(v),
  ids: (v) => Array.isArray(v) && v.length <= MAX_LIST && v.every(isId),
  int: isInt,
  ints: (v) => Array.isArray(v) && v.length <= MAX_LIST && v.every(isInt),
  bytes: isBytes,
  record: isPlainObject,
  records: (v) => Array.isArray(v) && v.length <= MAX_LIST && v.every(isPlainObject),
  asset: (v) => isPlainObject(v) && isId(v.id) && typeof v.mimeType === "string" && typeof v.createdAt === "number" && isBytes(v.data),
  any: () => true,
};

function badRequest(message) {
  return new StorageError("BAD_REQUEST", message);
}

/** The (service, method) -> arg-kinds table, without the `_doc` entry. */
function methodTable() {
  return Object.fromEntries(Object.entries(contract).filter(([k]) => !k.startsWith("_")));
}

/**
 * Builds `invoke(service, method, args)`; it never throws: it resolves to `{ ok: true, value }` or
 * `{ ok: false, error: { name, code, message } }` so the renderer can rethrow a faithful Error.
 */
function createDispatcher(services) {
  const table = methodTable();
  return async function invoke(service, method, args) {
    try {
      if (typeof service !== "string" || typeof method !== "string" || !Array.isArray(args)) throw badRequest("Malformed storage request.");
      if (!Object.hasOwn(table, service) || !Object.hasOwn(table[service], method)) throw badRequest(`Unknown storage method ${service}.${method}.`);
      const kinds = table[service][method];
      if (args.length > kinds.length) throw badRequest(`${service}.${method}: too many arguments.`);
      kinds.forEach((kind, i) => {
        if (!KINDS[kind](args[i])) throw badRequest(`${service}.${method}: argument ${i + 1} is not a valid ${kind}.`);
      });
      const value = await services[service][method](...args);
      return { ok: true, value };
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      return { ok: false, error: { name: e.name, code: e.code, message: e.message } };
    }
  };
}

/** Only the app's own frame (acute://app/…) may use storage; other frames/origins are refused. */
function isTrustedSender(event) {
  const frame = event.senderFrame;
  return !!frame && typeof frame.url === "string" && frame.url.startsWith(TRUSTED_PREFIX) && frame === event.sender.mainFrame;
}

function registerStorageIpc(ipcMain, invoke, trusted = isTrustedSender) {
  ipcMain.handle(CHANNEL, (event, service, method, args) => {
    if (!trusted(event)) return { ok: false, error: { name: "StorageError", code: "FORBIDDEN", message: "Storage is not available to this page." } };
    return invoke(service, method, args);
  });
}

module.exports = { CHANNEL, createDispatcher, isTrustedSender, methodTable, registerStorageIpc };
