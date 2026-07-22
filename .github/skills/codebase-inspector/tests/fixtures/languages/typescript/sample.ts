import { format } from "./format.js";
export interface Runner { run(input: string): Promise<string>; }
export class Greeter implements Runner {
  private prefix: string;
  constructor(prefix: string) { this.prefix = prefix; }
  public async run(input: string = "secret"): Promise<string> { return format(this.prefix + input); }
  static create(): Greeter { return new Greeter("hi"); }
}
export function add(left: number, right: number): number { return left + right; }
