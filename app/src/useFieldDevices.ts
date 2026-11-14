import { useState } from 'react';

export function useFieldDevices() {
  const [hudOn, setHudOn] = useState(false);
  const [localHud, setLocalHud] = useState(false);
  const [healthOn, setHealthOn] = useState(false);
  return { hudOn, setHudOn, healthOn, setHealthOn, localHudVisible: localHud && hudOn,
    openLocalHud: () => { setLocalHud(true); setHudOn(true); }, closeLocalHud: () => setLocalHud(false) };
}
