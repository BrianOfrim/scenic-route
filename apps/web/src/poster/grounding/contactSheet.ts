export type GroundingLayer = {
  role: string;
  legend: string;
  dataUrl: string;
};

export type ContactSheet = {
  items: GroundingLayer[];
  cols: number;
  rows: number;
  role: string;
  legend: string;
};

export function gridFor(count: number): { cols: number; rows: number } {
  if (count <= 1) return { cols: 1, rows: 1 };
  if (count === 2) return { cols: 2, rows: 1 };
  if (count <= 4) return { cols: 2, rows: 2 };
  if (count <= 6) return { cols: 3, rows: 2 };
  const cols = Math.ceil(Math.sqrt(count));
  return { cols, rows: Math.ceil(count / cols) };
}

export function planContactSheets(items: GroundingLayer[], maxRefs: number): ContactSheet[] {
  const limit = Math.max(1, Math.floor(maxRefs) || 1);
  if (items.length === 0) return [];
  if (items.length <= limit) {
    return items.map((item) => ({
      items: [item],
      cols: 1,
      rows: 1,
      role: item.role,
      legend: item.legend,
    }));
  }
  const perSheet = Math.ceil(items.length / limit);
  const sheets: ContactSheet[] = [];
  for (let i = 0; i < items.length; i += perSheet) {
    const chunk = items.slice(i, i + perSheet);
    const grid = gridFor(chunk.length);
    sheets.push({
      items: chunk,
      ...grid,
      role: chunk.length === 1 ? chunk[0].role : `contact-sheet:${chunk.map((item) => item.role).join("+")}`,
      legend: chunk.map((item) => `${item.role}: ${item.legend}`).join(" | "),
    });
  }
  return sheets;
}

export async function renderContactSheets(
  items: GroundingLayer[],
  maxRefs: number,
  aspectRatio: string,
): Promise<{ dataUrl: string; role: string; legend: string }[]> {
  const sheets = planContactSheets(items, maxRefs);
  const results: { dataUrl: string; role: string; legend: string }[] = [];
  for (const sheet of sheets) {
    if (sheet.items.length === 1) {
      results.push({ dataUrl: sheet.items[0].dataUrl, role: sheet.role, legend: sheet.legend });
      continue;
    }
    results.push({
      dataUrl: await drawSheet(sheet, aspectRatio),
      role: sheet.role,
      legend: sheet.legend,
    });
  }
  return results;
}

function parseAspect(aspectRatio: string): [number, number] {
  const [w, h] = aspectRatio.split(":").map(Number);
  return [w > 0 ? w : 2, h > 0 ? h : 3];
}

async function drawSheet(sheet: ContactSheet, aspectRatio: string): Promise<string> {
  const short = 1024;
  const [aw, ah] = parseAspect(aspectRatio);
  const width = aw <= ah ? short : Math.round((short * aw) / ah);
  const height = aw <= ah ? Math.round((short * ah) / aw) : short;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create a 2D canvas context");
  ctx.fillStyle = "#111318";
  ctx.fillRect(0, 0, width, height);
  const gutter = 10;
  const labelH = 28;
  const cellW = (width - gutter * (sheet.cols + 1)) / sheet.cols;
  const cellH = (height - gutter * (sheet.rows + 1)) / sheet.rows;
  await Promise.all(
    sheet.items.map(async (item, index) => {
      const col = index % sheet.cols;
      const row = Math.floor(index / sheet.cols);
      const x = gutter + col * (cellW + gutter);
      const y = gutter + row * (cellH + gutter);
      const img = await loadImage(item.dataUrl);
      const innerH = cellH - labelH;
      ctx.fillStyle = "#1c1f27";
      ctx.fillRect(x, y, cellW, cellH);
      drawContained(ctx, img, x, y, cellW, innerH);
      ctx.fillStyle = "#f4efe4";
      ctx.font = "13px IBM Plex Sans, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(item.role, x + 8, y + innerH + labelH / 2, cellW - 16);
    }),
  );
  return canvas.toDataURL("image/png");
}

function drawContained(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const scale = Math.min(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load grounding image"));
    img.src = url;
  });
}
