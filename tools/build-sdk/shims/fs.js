// node:fs for the browser: file-path helpers (fromFile / toFile) are Node-only; the studio uses fromBytes and URLs.
const nope = (n) => () => { throw new Error(`${n} is not available in the browser; use assets.fromBytes / output URLs`); };
export const createReadStream = nope("createReadStream");
export const createWriteStream = nope("createWriteStream");
export const openAsBlob = nope("openAsBlob");
export const readFile = nope("readFile");
export default {createReadStream, createWriteStream, openAsBlob, readFile};
