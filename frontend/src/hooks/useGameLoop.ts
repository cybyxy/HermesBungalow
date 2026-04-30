import { useEffect } from 'react';
import { useGameState } from '../store/gameState';

export function useGameLoop() {
  useEffect(() => {
    const id = window.setInterval(() => {
      useGameState.getState().tick();
    }, 1000);
    return () => window.clearInterval(id);
  }, []);
}
