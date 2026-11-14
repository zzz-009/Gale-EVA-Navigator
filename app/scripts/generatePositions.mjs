// 現行Appと同じ基地/目標Aのグリッド位置から、安全ルートを実計算して生成する。
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const core = await server.ssrLoadModule('../core/src/index.ts');
  const region = JSON.parse(await readFile('public/data/region.json', 'utf8'));
  const floats = async (name) => { const b = await readFile(`public/data/${name}`); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
  const grid = { ...region, elev: await floats('elev.f32'), rough: await floats('rough.f32') };
  const { slope, aspect } = core.computeSlopeAspect(grid);
  const free = (c, r) => {
    for (let rad = 0; rad < 40; rad++) for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
      const cc = c + dc, rr = r + dr;
      if (cc >= 0 && rr >= 0 && cc < grid.width && rr < grid.height && slope[core.idx(grid, cc, rr)] < 8) return { c: cc, r: rr };
    }
    throw new Error('安全な出発点/目標が見つかりません');
  };
  const route = core.planRoute(grid, slope, aspect, free(70, 80), free(546, 220), 'safe', { slopeMaxDeg: region.slope_max_deg, limitedMinDeg: region.slope_limited_deg });
  if (!route) throw new Error('安全ルートが見つかりません');
  const points = route.coords.map(([lat, lon]) => ({ lat, lon }));
  const distances = [0];
  for (let i = 1; i < points.length; i++) distances.push(distances[i - 1] + core.haversine(points[i - 1], points[i]));
  const total = distances[distances.length - 1];
  const duration = total / core.walkSpeed(0);
  const start = Date.parse('2026-11-14T10:00:00Z'); // 設計書07のテスト時刻
  let segment = 1;
  const positions = [];
  for (let seconds = 0; seconds <= Math.ceil(duration / 30) * 30; seconds += 30) {
    const d = Math.min(total, seconds * core.walkSpeed(0));
    while (segment < points.length - 1 && distances[segment] < d) segment++;
    const a = points[segment - 1], b = points[segment];
    const fraction = (d - distances[segment - 1]) / (distances[segment] - distances[segment - 1]);
    const p = { lat: a.lat + (b.lat - a.lat) * fraction, lon: a.lon + (b.lon - a.lon) * fraction };
    if (!core.latLonToCell(grid, p)) throw new Error('地域外の点が生成されました');
    positions.push({ t_utc: new Date(start + seconds * 1000).toISOString(), ...p, accuracy_m: 5, heading_deg: core.bearing(a, b) });
  }
  await writeFile('public/data/positions_test.json', JSON.stringify({ format: 'gale-eva-positions/1', description: '基地から目標Aまでの安全ルートを30秒ごとに進むテスト（将来の衛星測位を仮定）', positions }, null, 2) + '\n');
  console.log(`生成済み: ${positions.length}点、全点が活動地域内、30秒間隔`);
} finally { await server.close(); }
