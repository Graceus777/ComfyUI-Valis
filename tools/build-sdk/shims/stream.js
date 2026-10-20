export const Readable = {fromWeb() { throw new Error("streams to disk are not available in the browser"); }};
export const pipeline = () => { throw new Error("pipeline is not available in the browser"); };
export default {Readable, pipeline};
