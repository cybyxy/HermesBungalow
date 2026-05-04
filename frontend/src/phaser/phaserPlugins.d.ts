import type { AStarPathfinderPlugin } from './plugins/AStarPathfinderPlugin';

declare global {
  namespace Phaser {
    interface Scene {
      /** `GameConfig.plugins.scene` 中 `mapping: 'aStar'` 注入 */
      aStar: AStarPathfinderPlugin;
    }
  }
}

export {};
