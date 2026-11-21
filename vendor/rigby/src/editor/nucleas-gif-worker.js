import { encodeGif } from './gif.js';
self.onmessage = ({ data }) => {
  try { const bytes = encodeGif(data); self.postMessage({ bytes }, [bytes.buffer]); }
  catch (error) { self.postMessage({ error: error.message }); }
  finally { self.close(); }
};
