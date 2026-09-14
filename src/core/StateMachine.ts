/**
 * Явная конечная автомат состояний — вместо хаотичных boolean.
 * Разрешённые переходы задаются декларативно, незаконные — ошибка в дев-режиме.
 */
export class StateMachine<S extends string> {
  private handlers = new Map<S, { enter?: () => void; exit?: () => void }>();
  private allowed = new Map<S, ReadonlySet<S>>();
  public current!: S;

  constructor(initial: S, transitions: Record<S, readonly S[]>) {
    this.current = initial;
    for (const from of Object.keys(transitions) as S[]) {
      this.allowed.set(from, new Set<S>(transitions[from]));
    }
  }

  register(state: S, h: { enter?: () => void; exit?: () => void }): void {
    this.handlers.set(state, h);
  }

  can(next: S): boolean {
    return this.allowed.get(this.current)?.has(next) ?? next === this.current;
  }

  /** Возвращает true, если переход выполнен */
  to(next: S, strict = false): boolean {
    if (next === this.current) return false;
    if (!this.can(next)) {
      if (strict) throw new Error(`FSM: переход ${this.current} -> ${next} запрещён`);
      return false;
    }
    this.handlers.get(this.current)?.exit?.();
    const prev = this.current;
    this.current = next;
    this.handlers.get(next)?.enter?.();
    void prev;
    return true;
  }

  is(...states: S[]): boolean {
    return states.includes(this.current);
  }
}
