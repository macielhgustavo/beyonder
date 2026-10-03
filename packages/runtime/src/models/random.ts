export interface RandomSource {
  next(): number;
}

export class MathRandomSource implements RandomSource {
  next(): number {
    return Math.random();
  }
}

export class SeededRandomSource implements RandomSource {
  private state: number;

  constructor(seed = 0x9e3779b9) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }
}
