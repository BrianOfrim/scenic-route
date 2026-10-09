import { SaxesParser } from "saxes";
import { ImportError } from "./gpx";
import { MAX_EXPANDED_TRACK_BYTES } from "./importLimits";
export const MAX_XML_POINTS = 250_000;
export function validateActivityXml(xml: string, root: string): string {
  if (Buffer.byteLength(xml) > MAX_EXPANDED_TRACK_BYTES) throw new ImportError("Activity XML is too large");
  const parser = new SaxesParser({ xmlns: true });
  let depth = 0;
  let points = 0;
  parser.on("doctype", () => { throw new ImportError("Activity XML must not contain a DOCTYPE"); });
  parser.on("error", () => { throw new ImportError("Activity XML is malformed"); });
  parser.on("opentag", tag => {
    if (depth++ === 0 && tag.local.toLowerCase() !== root.toLowerCase()) throw new ImportError(`This file is not a ${root} activity`);
    if (depth > 128) throw new ImportError("Activity XML is nested too deeply");
    if (["trkpt", "rtept", "Trackpoint"].includes(tag.local) && ++points > MAX_XML_POINTS) throw new ImportError("Activity contains too many GPS points");
  });
  parser.on("closetag", () => { depth--; });
  parser.write(xml).close();
  return xml
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
    .replace(/<!--[\s\S]*?-->/g, "");
}
