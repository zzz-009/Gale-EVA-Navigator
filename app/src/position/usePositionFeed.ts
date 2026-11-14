import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Grid, LatLon, Route, TrackPoint } from '@core';
import type { RegionMeta } from '../mapController';
import { JsonFeedSource, parsePositionFeed, type PositionFeed } from './jsonFeedSource';
import { SimulationSource } from './simulationSource';
import { fixToTrack, type PositionFix, type ReplaySource } from './source';

type World = { grid: Grid; region: RegionMeta; base: LatLon };
type Options = { world: World | null; mode: string; playing: boolean; speed: number; online: boolean; setPlaying: Dispatch<SetStateAction<boolean>>; setTrack: Dispatch<SetStateAction<TrackPoint[]>> };
export function usePositionFeed(options: Options) {
  const [kind, setKind] = useState<'simulation' | 'json'>('simulation');
  const [feed, setFeed] = useState<PositionFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [fix, setFix] = useState<PositionFix | null>(null);
  const source = useRef<ReplaySource | null>(null);
  const latest = useRef(options); latest.current = options;
  const importVersion = useRef(0);
  useEffect(() => {
    if (!options.world) return;
    const controller = new AbortController();
    const region = options.world.region;
    const version = importVersion.current;
    fetch('/data/positions_test.json', { signal: controller.signal }).then((r) => {
      if (!r.ok) throw new Error(`位置サンプルを読み込めません（${r.status}）`);
      return r.json();
    }).then((data) => { if (version === importVersion.current) setFeed(parsePositionFeed(data, region)); })
      .catch((e: unknown) => { if (!controller.signal.aborted && version === importVersion.current) setError(String(e)); });
    return () => controller.abort();
  }, [options.world]);
  useEffect(() => { source.current?.setOnline(options.online); }, [options.online]);
  useEffect(() => {
    const current = source.current;
    if (!current) return;
    current.setSpeed(options.speed);
    current.setOnline(options.online);
    if (options.mode !== 'traverse' || !options.playing) { current.stop(); return; }
    current.start((next) => {
      const state = latest.current;
      if (!state.world) return;
      setFix(next);
      state.setTrack((track) => [...track, fixToTrack(next, state.world!.grid, state.online, `feed-${track.length}`)]);
    });
    return () => current.stop();
  }, [options.mode, options.playing, options.speed]);
  useEffect(() => () => source.current?.stop(), []);
  const prepare = (route: Route, now: number): number | null => {
    if (!options.world) return null;
    if (kind === 'json' && !feed) { setError('有効な位置情報ファイルを読み込んでください。'); return null; }
    source.current?.stop();
    const finish = (): void => { setEnded(true); latest.current.setPlaying(false); };
    const replay = kind === 'json' ? new JsonFeedSource(feed!, options.world.base, finish) : new SimulationSource(route, options.world.grid, now, finish);
    replay.setOnline(options.online); replay.setSpeed(options.speed);
    source.current = replay; setEnded(false); setFix(null);
    return replay instanceof JsonFeedSource ? replay.startMs : now;
  };
  const loadFile = async (file: File): Promise<void> => {
    if (!options.world || options.mode !== 'plan') return;
    const version = ++importVersion.current;
    try {
      const parsed = parsePositionFeed(JSON.parse(await file.text()), options.world.region);
      if (version !== importVersion.current) return;
      setFeed(parsed); setError(null); setKind('json');
    } catch (e) { if (version === importVersion.current) setError(e instanceof Error ? e.message : String(e)); }
  };
  return { kind, setKind, feed, error, ended, fix, prepare, loadFile };
}
