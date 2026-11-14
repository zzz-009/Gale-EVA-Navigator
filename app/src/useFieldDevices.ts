import { useState } from 'react';

export function useFieldDevices() {
  const [hudOn, setHudOn] = useState(false);
  const [healthOn, setHealthOn] = useState(false);
  return { hudOn, setHudOn, healthOn, setHealthOn };
}
