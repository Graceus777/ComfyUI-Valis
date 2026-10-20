export const basename = (p) => String(p).split(/[\\/]/).pop();
export const extname = (p) => { const b = basename(p); const i = b.lastIndexOf("."); return i > 0 ? b.slice(i) : ""; };
export default {basename, extname};
