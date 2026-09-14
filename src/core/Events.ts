/**
 * Типизированная событийная шина. Геймплей-системы эмитят события,
 * UI/аудио/VFX подписываются — без жёстких связок и без boolean-каши.
 */
export type GameEvent =
  | { type: 'blue_collected'; value: number; large: boolean; gold?: boolean; position: { x: number; y: number; z: number } }
  | { type: 'green_collected'; heal: number; position: { x: number; y: number; z: number } }
  | { type: 'spirit_touch'; dangerLevel: number }
  | { type: 'awaken_start' }
  | { type: 'awaken_done' }
  | { type: 'gaze_awareness'; on: boolean }
  | { type: 'gaze_lock'; on: boolean }
  | { type: 'beam_charge' }
  | { type: 'beam_fire' }
  | { type: 'beam_end'; hitPlayer: boolean }
  | { type: 'near_miss'; value: number }
  | { type: 'gaze_escape'; value: number }
  | { type: 'damage'; amount: number; hp: number; source: 'beam' | 'spirit' }
  | { type: 'heal'; amount: number; hp: number }
  | { type: 'combo'; mult: number }
  | { type: 'combo_reset' }
  | { type: 'player_died'; cause: string }
  | { type: 'run_started'; seed: number }
  | { type: 'head_rotate'; speed: number };

export type Listener = (e: GameEvent) => void;

export class EventBus {
  private map = new Map<GameEvent['type'], Set<Listener>>();
  private any = new Set<Listener>();

  on(type: GameEvent['type'], fn: Listener): () => void {
    let set = this.map.get(type);
    if (!set) this.map.set(type, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  onAny(fn: Listener): () => void {
    this.any.add(fn);
    return () => this.any.delete(fn);
  }

  emit(e: GameEvent): void {
    this.map.get(e.type)?.forEach((fn) => fn(e));
    this.any.forEach((fn) => fn(e));
  }

  clear(): void {
    this.map.clear();
    this.any.clear();
  }
}
